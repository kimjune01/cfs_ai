import {
  runClaude,
  vectorSearch,
  visionRead,
  extractSearchTerms,
  extractICAOCodes,
  rephraseMultipleQueries,
  checkICAO,
  findEffortNeeded,
  formatHistoryForPrompt,
  VECTOR_CONFIDENCE_THRESHOLD,
} from "./agent-tools";
import type { AgentResult, EmitFn, Turn, VectorChunk } from "./types";

const MAX_HISTORY_TURNS = 10;

function truncateHistory(history: Turn[]): Turn[] {
  return history.slice(-MAX_HISTORY_TURNS);
}

function formatVectorChunks(chunks: VectorChunk[], topScore: number): string {
  const verdict = topScore >= VECTOR_CONFIDENCE_THRESHOLD
    ? `✓ HIGH CONFIDENCE (${topScore}) — answer directly if results are complete`
    : `⚠ LOW CONFIDENCE (${topScore}) — consider calling read_pages`;
  const header = `[Vector search results | top score: ${topScore} | ${verdict}]`;
  const body = chunks
    .map((c) => `[Page ${c.page} | ${c.icao} | ${c.section} | score=${c.score}]\n${c.text}`)
    .join("\n\n---\n\n");
  return `${header}\n\n${body}`;
}



// Second-turn prompt: Claude has seen vector results, now answers or escalates
const DECISION_PROMPT = `You are the Canadian Flight Supplement Aviation Assistant. Based on the vector results provided ONLY, reply with ONLY a JSON object:

{"action":"answer","text":"your answer","pages":[N,M]} — only if the results contain a value explicitly labeled as what was asked. List ONLY pages you used.
{"action":"vision"} — if the specific field is not explicitly labeled, results are ambiguous, or confidence is low. When in doubt, choose vision.

DO NOT infer, interpret adjacent fields, or assume a value applies to the question. A field only qualifies as an answer if its label directly matches what was asked. If the label does not match, choose vision.`;

export async function runAgentLoop(
  question: string,
  history: Turn[],
  emit: EmitFn,
  signal?: AbortSignal
): Promise<AgentResult> {
  const truncated = truncateHistory(history);
  emit({ type: "thinking" });

  const icaoClarification = checkICAO(question);
  if (icaoClarification) {
    emit({ type: "clarification", question: icaoClarification });
    emit({ type: "done", answer: icaoClarification, sourcePages: [] });
    return { answer: icaoClarification, sourcePages: [], searchTerms: [], toolsCalled: [] };
  }

  const highEffort = await findEffortNeeded(question, truncated, signal);
  const toolsCalled: ("vector" | "vision")[] = [];
  const allSearchTerms: string[] = [];

  // High-effort: skip vector, go straight to vision (ground truth)
  if (highEffort) {
    emit({ type: "high_effort", reason: "Claude detected high-effort intent" });
    const terms = await extractSearchTerms(question, signal);
    allSearchTerms.push(...terms);
    const visionResult = await visionRead(terms, question, emit, signal);
    toolsCalled.push("vision");
    emit({ type: "done", answer: visionResult.answer, sourcePages: visionResult.sourcePages });
    return { answer: visionResult.answer, sourcePages: visionResult.sourcePages, searchTerms: allSearchTerms, toolsCalled };
  }

  // Standard mode: always vector first, then Claude decides
  emit({ type: "rephrasing" });
  const icaos = extractICAOCodes(question);
  const queries = await rephraseMultipleQueries(question, icaos, signal);
  allSearchTerms.push(...queries);
  const results = await Promise.all(queries.map((q) => vectorSearch(q, emit, signal)));
  const pageMap = new Map<number, VectorChunk>();
  for (const r of results) {
    for (const c of r.chunks) {
      const existing = pageMap.get(c.page);
      if (!existing || c.score > existing.score) pageMap.set(c.page, c);
    }
  }
  const chunks = [...pageMap.values()].sort((a, b) => b.score - a.score);
  const topScore = chunks[0]?.score ?? 0;
  toolsCalled.push("vector");
  const vectorPages = [...new Set(chunks.map((c) => c.page))].sort((a, b) => a - b);

  const decisionResponse = await runClaude(
    `${formatHistoryForPrompt(truncated)}Question: ${question}\n\nVector results:\n${formatVectorChunks(chunks, topScore)}\n\nAnswer or call read_pages.`,
    signal,
    DECISION_PROMPT
  );

  let decision: { action: string; text?: string; pages?: number[] };
  try {
    const jsonStr = decisionResponse.match(/\{[\s\S]*\}/)?.[0] ?? decisionResponse;
    decision = JSON.parse(jsonStr) as typeof decision;
  } catch {
    console.warn("Decision parse failed, using raw response:", decisionResponse.slice(0, 200));
    decision = { action: "answer", text: decisionResponse.trim(), pages: vectorPages };
  }

  if (decision.action === "answer" && decision.text) {
    const pages = decision.pages?.length ? decision.pages : vectorPages;
    emit({ type: "synthesize" });
    emit({ type: "done", answer: decision.text, sourcePages: pages });
    return { answer: decision.text, sourcePages: pages, searchTerms: allSearchTerms, toolsCalled };
  }

  // Claude wants vision
  const visionTerms = await extractSearchTerms(question, signal);
  allSearchTerms.push(...visionTerms);
  const visionResult = await visionRead(visionTerms, question, emit, signal);
  toolsCalled.push("vision");
  emit({ type: "synthesize" });
  emit({ type: "done", answer: visionResult.answer, sourcePages: visionResult.sourcePages });
  return { answer: visionResult.answer, sourcePages: visionResult.sourcePages, searchTerms: allSearchTerms, toolsCalled };
}
