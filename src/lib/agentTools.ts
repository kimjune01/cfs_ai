import type { Turn, VectorChunk } from "./types";
import { runClaude, parseJsonStringArray } from "./utils/claudeUtils";

const ICAO_RE_GLOBAL = /\bC[A-Z]{3}\b/g;

const extractICAOCodes = (question: string): string[] =>
  [...question.toUpperCase().matchAll(ICAO_RE_GLOBAL)].map((m) => m[0]);

const formatHistoryForPrompt = (history: Turn[]): string => {
  if (history.length === 0) return "";
  return (
    "Prior conversation:\n" +
    history.map((t) => `${t.role === "user" ? "Pilot" : "Assistant"}: ${t.content}`).join("\n") +
    "\n\n"
  );
};

const formatVectorChunks = (chunks: VectorChunk[]): string => {
  const body = chunks
    .map(
      (chunk) =>
        `[Page ${chunk.page} | ${chunk.icao} | ${chunk.section} | score=${chunk.score}]\n${chunk.text}`,
    )
    .join("\n\n---\n\n");
  return `[Vector search results]\n\n${body}`;
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

const buildDecisionPrompt = (history: Turn[], question: string, chunks: VectorChunk[]): string =>
  `${formatHistoryForPrompt(history)}` +
  `Question: ${question}\n\n` +
  `Vector results:\n${formatVectorChunks(chunks)}\n\n` +
  `Answer or call read_pages.`;

const rephraseMultipleQueries = async (
  question: string,
  icaos: string[],
  signal?: AbortSignal,
): Promise<string[]> => {
  const raw = await runClaude(
    `Return a JSON array of concise vector search queries for the NavCanada CFS, one per ICAO code. ` +
      `Keep each ICAO code and the specific topic from the question. Remove aerodrome names. ` +
      `ICAOs: ${icaos.join(", ")}\n\nQuestion: ${question}`,
    signal,
  );
  const queries = parseJsonStringArray(raw);
  if (queries.length !== icaos.length) {
    return icaos;
  }
  return queries;
};

export {
  extractICAOCodes,
  formatHistoryForPrompt,
  deduplicateChunksByPage,
  buildDecisionPrompt,
  rephraseMultipleQueries,
};
