import { runClaude } from "./utils/claudeUtils";
import { parseJsonObject } from "./utils/parseJson";
import {
  extractSearchTerms,
  extractICAOCodes,
  rephraseMultipleQueries,
  findEffortNeeded,
  deduplicateChunksByPage,
  buildDecisionPrompt,
} from "./agentTools";
import { DECISION_PROMPT } from "./prompts";
import { vectorSearch } from "./vectorSearch";
import { visionSearch } from "./visionSearch";
import { runEvaluationGate } from "./evaluator";
import type { AgentResult, EmitFn, Turn, VectorChunk } from "./types";

const MAX_HISTORY_TURNS = 10;

type ToolType = "vector" | "vision";
type Decision = { action: string; text?: string; pages?: number[] };

const truncateHistory = (history: Turn[]): Turn[] => history.slice(-MAX_HISTORY_TURNS);

const parseDecision = (raw: string): Decision => {
  const decision = parseJsonObject<Decision>(raw);
  if (!decision) {
    console.warn("Decision parse failed, escalating to vision:", raw.slice(0, 200));
    return { action: "vision" };
  }
  return decision;
};

const runVisionDirectPath = async (
  question: string,
  emit: EmitFn,
  signal?: AbortSignal,
): Promise<{
  answer: string;
  sourcePages: number[];
  searchTerms: string[];
  toolsCalled: ToolType[];
}> => {
  emit({ type: "high_effort", reason: "Claude detected high-effort intent" });
  const terms = await extractSearchTerms(question, signal);
  const visionResult = await visionSearch(terms, question, emit, signal);
  return {
    answer: visionResult.answer,
    sourcePages: visionResult.sourcePages,
    searchTerms: terms,
    toolsCalled: ["vision"],
  };
};

const runVectorPath = async (
  question: string,
  history: Turn[],
  emit: EmitFn,
  signal?: AbortSignal,
): Promise<{
  answer: string;
  sourcePages: number[];
  searchTerms: string[];
  toolsCalled: ToolType[];
}> => {
  emit({ type: "rephrasing" });
  const icaos = extractICAOCodes(question);
  const queries = await rephraseMultipleQueries(question, icaos, signal);

  const results = await Promise.all(queries.map((q) => vectorSearch(q, emit, signal)));
  const chunks: VectorChunk[] = deduplicateChunksByPage(results);
  const topScore = chunks[0]?.score ?? 0;
  const vectorPages = [...new Set(chunks.map((c) => c.page))].sort((a, b) => a - b);

  const decision = parseDecision(
    await runClaude(
      buildDecisionPrompt(history, question, chunks, topScore),
      signal,
      DECISION_PROMPT,
    ),
  );

  if (decision.action === "answer" && decision.text) {
    emit({ type: "synthesize" });
    const pages = decision.pages?.length ? decision.pages : vectorPages;
    return {
      answer: decision.text,
      sourcePages: pages,
      searchTerms: queries,
      toolsCalled: ["vector"],
    };
  }

  // Vector results insufficient — escalate to vision
  const visionResult = await visionSearch(icaos, question, emit, signal);
  emit({ type: "synthesize" });
  return {
    answer: visionResult.answer,
    sourcePages: visionResult.sourcePages,
    searchTerms: [...queries, ...icaos],
    toolsCalled: ["vector", "vision"],
  };
};

const runAgentLoop = async (
  question: string,
  history: Turn[],
  emit: EmitFn,
  signal?: AbortSignal,
): Promise<AgentResult> => {
  const truncated = truncateHistory(history);
  emit({ type: "thinking" });

  // Step 1 — evaluate question: resolve ICAO, check scope, clarify if needed
  const gate = await runEvaluationGate(question, truncated, emit, signal);
  if (gate.handled) return gate.result;

  // Step 2 — detect if pilot is repeating or doubting a previous answer
  const highEffort = await findEffortNeeded(gate.resolvedQuestion, truncated, signal);

  // Step 3 — route: vision direct (pilot doubting/repeating) or vector → decide → maybe vision
  const result = highEffort
    ? await runVisionDirectPath(gate.resolvedQuestion, emit, signal)
    : await runVectorPath(gate.resolvedQuestion, truncated, emit, signal);

  emit({ type: "done", answer: result.answer, sourcePages: result.sourcePages });
  return result;
};

export { runAgentLoop };
