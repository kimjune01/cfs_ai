import { runClaude } from "./utils/claudeUtils";
import { parseJsonObject } from "./utils/parseJson";
import {
  extractICAOCodes,
  rephraseMultipleQueries,
  deduplicateChunksByPage,
  buildDecisionPrompt,
} from "./agentTools";
import { DECISION_PROMPT } from "./prompts";
import { vectorSearch } from "./vectorSearch";
import { visionSearch } from "./visionSearch";
import { runEvaluationGate } from "./evaluator";
import type { AgentResult, EmitFn, Turn, VectorChunk } from "./types";

const MAX_HISTORY_TURNS = 10;

type Decision = { action: "answer"; text: string; sourcePages: number[] } | { action: "vision" };

const truncateHistory = (history: Turn[]): Turn[] => history.slice(-MAX_HISTORY_TURNS);

const parseDecision = (raw: string, chunks: VectorChunk[]): Decision => {
  const parsed = parseJsonObject<{ action: string; text?: string; pages?: number[] }>(raw);
  if (!parsed || parsed.action !== "answer" || !parsed.text) {
    if (!parsed) console.warn("Decision parse failed, escalating to vision:", raw.slice(0, 200));
    return { action: "vision" };
  }
  const vectorPages = [...new Set(chunks.map((c) => c.page))].sort((a, b) => a - b);
  const sourcePages = parsed.pages?.length ? parsed.pages : vectorPages;
  return { action: "answer", text: parsed.text, sourcePages };
};

type VectorSearchResult = {
  queries: string[];
  icaos: string[];
  chunks: VectorChunk[];
};

const runVectorSearch = async (
  question: string,
  emit: EmitFn,
  signal?: AbortSignal,
): Promise<VectorSearchResult> => {
  emit({ type: "rephrasing" });
  const icaos = extractICAOCodes(question);
  const queries = await rephraseMultipleQueries(question, icaos, signal);
  const results = await Promise.all(queries.map((q) => vectorSearch(q, emit, signal)));
  const chunks = deduplicateChunksByPage(results);
  return { queries, icaos, chunks };
};

const runDecision = async (
  question: string,
  history: Turn[],
  chunks: VectorChunk[],
  emit: EmitFn,
  signal?: AbortSignal,
): Promise<Decision> => {
  const raw = await runClaude(
    buildDecisionPrompt(history, question, chunks),
    signal,
    DECISION_PROMPT,
  );
  const decision = parseDecision(raw, chunks);
  emit({ type: "decision", action: decision.action });
  if (decision.action === "answer") emit({ type: "synthesize" });
  return decision;
};

const runVisionSearch = async (
  question: string,
  icaos: string[],
  emit: EmitFn,
  signal?: AbortSignal,
): Promise<{ answer: string; sourcePages: number[] }> => {
  const result = await visionSearch(icaos, question, emit, signal);
  emit({ type: "synthesize" });
  return result;
};

const runAgentLoop = async (
  question: string,
  history: Turn[],
  emit: EmitFn,
  signal?: AbortSignal,
): Promise<AgentResult> => {
  const truncated = truncateHistory(history);

  const gate = await runEvaluationGate(question, truncated, emit, signal);
  if (gate.handled) return gate.result;

  const { queries, icaos, chunks } = await runVectorSearch(gate.resolvedQuestion, emit, signal);
  const decision = await runDecision(gate.resolvedQuestion, truncated, chunks, emit, signal);

  let result: AgentResult;
  if (decision.action === "answer") {
    result = {
      answer: decision.text,
      sourcePages: decision.sourcePages,
      searchTerms: queries,
      toolsCalled: ["vector"],
    };
  } else {
    const vision = await runVisionSearch(gate.resolvedQuestion, icaos, emit, signal);
    result = {
      answer: vision.answer,
      sourcePages: vision.sourcePages,
      searchTerms: [...queries, ...icaos],
      toolsCalled: ["vector", "vision"],
    };
  }

  emit({ type: "done", answer: result.answer, sourcePages: result.sourcePages });
  return result;
};

export { runAgentLoop };
