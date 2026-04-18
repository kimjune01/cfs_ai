import {
  runClaude,
  extractSearchTerms,
  extractICAOCodes,
  rephraseMultipleQueries,
  findEffortNeeded,
  formatHistoryForPrompt,
  VECTOR_CONFIDENCE_THRESHOLD,
} from "./agentTools";
import { vectorSearch } from "./vectorSearch";
import { visionRead } from "./visionSearch";
import { runEvaluationGate } from "./evaluator";
import type { AgentResult, EmitFn, Turn, VectorChunk } from "./types";

const MAX_HISTORY_TURNS = 10;

type ToolType = "vector" | "vision";
type Decision = { action: string; text?: string; pages?: number[] };

const truncateHistory = (history: Turn[]): Turn[] => history.slice(-MAX_HISTORY_TURNS);

const formatVectorChunks = (chunks: VectorChunk[], topScore: number): string => {
  const verdict =
    topScore >= VECTOR_CONFIDENCE_THRESHOLD
      ? `✓ HIGH CONFIDENCE (${topScore}) — answer directly if results are complete`
      : `⚠ LOW CONFIDENCE (${topScore}) — consider calling read_pages`;
  const header = `[Vector search results | top score: ${topScore} | ${verdict}]`;
  const body = chunks
    .map(
      (chunk) =>
        `[Page ${chunk.page} | ${chunk.icao} | ${chunk.section} | score=${chunk.score}]\n${chunk.text}`,
    )
    .join("\n\n---\n\n");
  return `${header}\n\n${body}`;
};

const deduplicateChunksByPage = (results: { chunks: VectorChunk[] }[]): VectorChunk[] => {
  const pageMap = new Map<number, VectorChunk>();
  for (const result of results) {
    for (const chunk of result.chunks) {
      const existing = pageMap.get(chunk.page);
      if (!existing || chunk.score > existing.score) pageMap.set(chunk.page, chunk);
    }
  }
  return [...pageMap.values()].sort((a, b) => b.score - a.score);
};

const buildDecisionMessage = (
  history: Turn[],
  question: string,
  chunks: VectorChunk[],
  topScore: number,
): string =>
  `${formatHistoryForPrompt(history)}` +
  `Question: ${question}\n\n` +
  `Vector results:\n${formatVectorChunks(chunks, topScore)}\n\n` +
  `Answer or call read_pages.`;

// Second-turn prompt: Claude has seen vector results, now answers or escalates
const DECISION_PROMPT = `You are the Canadian Flight Supplement Aviation Assistant. Based on the vector results provided ONLY, reply with ONLY a JSON object:

{"action":"answer","text":"your answer","pages":[N,M]} — only if the results contain a value explicitly labeled as what was asked. List ONLY pages you used.
{"action":"vision"} — if the specific field is not explicitly labeled, results are ambiguous, or confidence is low. When in doubt, choose vision.

DO NOT infer, interpret adjacent fields, or assume a value applies to the question. A field only qualifies as an answer if its label directly matches what was asked. If the label does not match, choose vision.`;

const runAgentLoop = async (
  question: string,
  history: Turn[],
  emit: EmitFn,
  signal?: AbortSignal,
): Promise<AgentResult> => {
  const truncated = truncateHistory(history);
  emit({ type: "thinking" });

  const gate = await runEvaluationGate(question, truncated, emit, signal);
  if (gate.handled) return gate.result;
  const resolvedQuestion = gate.resolvedQuestion;

  const highEffort = await findEffortNeeded(resolvedQuestion, truncated, signal);
  const toolsCalled: ToolType[] = [];
  const allSearchTerms: string[] = [];

  // High-effort: skip vector, go straight to vision (ground truth)
  if (highEffort) {
    emit({ type: "high_effort", reason: "Claude detected high-effort intent" });
    const terms = await extractSearchTerms(resolvedQuestion, signal);
    allSearchTerms.push(...terms);
    const visionResult = await visionRead(terms, resolvedQuestion, emit, signal);
    toolsCalled.push("vision");
    emit({ type: "done", answer: visionResult.answer, sourcePages: visionResult.sourcePages });
    return {
      answer: visionResult.answer,
      sourcePages: visionResult.sourcePages,
      searchTerms: allSearchTerms,
      toolsCalled,
    };
  }

  // Standard mode: always vector first, then Claude decides
  emit({ type: "rephrasing" });
  const icaos = extractICAOCodes(resolvedQuestion);
  const queries = await rephraseMultipleQueries(resolvedQuestion, icaos, signal);
  allSearchTerms.push(...queries);
  const results = await Promise.all(queries.map((q) => vectorSearch(q, emit, signal)));
  const chunks = deduplicateChunksByPage(results);
  const topScore = chunks[0]?.score ?? 0;
  toolsCalled.push("vector");
  // Fallback page list used when Claude's response omits explicit page refs
  const vectorPages = [...new Set(chunks.map((chunk) => chunk.page))].sort((a, b) => a - b);

  const decisionResponse = await runClaude(
    buildDecisionMessage(truncated, resolvedQuestion, chunks, topScore),
    signal,
    DECISION_PROMPT,
  );

  let decision: Decision;
  try {
    const jsonStr = decisionResponse.match(/\{[\s\S]*\}/)?.[0] ?? decisionResponse;
    decision = JSON.parse(jsonStr) as Decision;
  } catch {
    console.warn("Decision parse failed, escalating to vision:", decisionResponse.slice(0, 200));
    decision = { action: "vision" };
  }

  if (decision.action === "answer" && decision.text) {
    const pages = decision.pages?.length ? decision.pages : vectorPages;
    emit({ type: "synthesize" });
    emit({ type: "done", answer: decision.text, sourcePages: pages });
    return { answer: decision.text, sourcePages: pages, searchTerms: allSearchTerms, toolsCalled };
  }

  // Claude wants vision
  const visionTerms = await extractSearchTerms(resolvedQuestion, signal);
  allSearchTerms.push(...visionTerms);
  const visionResult = await visionRead(visionTerms, resolvedQuestion, emit, signal);
  toolsCalled.push("vision");
  emit({ type: "synthesize" });
  emit({ type: "done", answer: visionResult.answer, sourcePages: visionResult.sourcePages });
  return {
    answer: visionResult.answer,
    sourcePages: visionResult.sourcePages,
    searchTerms: allSearchTerms,
    toolsCalled,
  };
};

export { runAgentLoop };
