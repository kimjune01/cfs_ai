/**
 * CFS vector database search helper.
 * Called by Claude Code's Bash tool during agentic RAG.
 *
 * Usage: node scripts/cfsSearch.mjs "<query>" [k]
 * Output: formatted CFS chunks to stdout
 */

import { pipeline } from "@xenova/transformers";
import * as lancedb from "@lancedb/lancedb";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LANCEDB_PATH = join(__dirname, "../data/lancedb");

const COMMON_WORDS = new Set([
  "THE",
  "AND",
  "FOR",
  "CFS",
  "AT",
  "IN",
  "OF",
  "IS",
  "TO",
  "A",
  "BC",
  "VFR",
  "IFR",
]);

function extractIcaoCodes(q) {
  return [...q.matchAll(/\bC[A-Z]{3}\b/g)].map((m) => m[0]);
}

function extractAbbreviations(q) {
  return [...q.matchAll(/\b([A-Z]{2,6})\b/g)]
    .map((m) => m[1])
    .filter((w) => !COMMON_WORDS.has(w) && !/^C[A-Z]{3}$/.test(w));
}

function isDefinitionChunk(chunk, term) {
  const t = chunk.text;
  return (
    new RegExp(`\\b\\w[\\w ]{2,}\\s*\\(${term}\\)`).test(t) ||
    new RegExp(`^${term}\\s*[-–]\\s*\\w`, "m").test(t)
  );
}

async function search(query, k = 5) {
  const embedder = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
  const db = await lancedb.connect(LANCEDB_PATH);
  const table = await db.openTable("cfs");

  const upper = query.toUpperCase();
  const icaoCodes = extractIcaoCodes(upper);
  const abbrevs = extractAbbreviations(upper);

  const output = await embedder(query, { pooling: "mean", normalize: true });
  const queryVec = Array.from(output.data);

  const semanticResults = await table.search(queryVec).limit(k).toArray();
  const semanticChunks = semanticResults.map(({ vector: _v, ...c }) => c);

  const needsScan = icaoCodes.length > 0 || abbrevs.length > 0;
  const allRows = needsScan
    ? await table
        .query()
        .select(["id", "icao", "section_group", "start_page", "end_page", "text"])
        .toArray()
    : [];

  const icaoChunks = icaoCodes.length ? allRows.filter((c) => icaoCodes.includes(c.icao)) : [];
  const abbrevChunks = abbrevs.length
    ? allRows.filter((c) => abbrevs.some((abbr) => isDefinitionChunk(c, abbr)))
    : [];

  const keywordIds = new Set([...icaoChunks, ...abbrevChunks].map((c) => c.id));
  const keywordPages = [
    ...new Map([...icaoChunks, ...abbrevChunks].map((c) => [c.id, c])).values(),
  ];

  const additional = semanticChunks.filter((c) => !keywordIds.has(c.id));
  const remaining = Math.max(0, k - keywordPages.length);
  const chunks = [...keywordPages, ...additional.slice(0, remaining)];

  return chunks;
}

const args = process.argv.slice(2).filter((a) => a !== "--json");
const jsonMode = process.argv.includes("--json");
const query = args[0];
const k = parseInt(args[1] ?? "5", 10);

if (!query) {
  console.error('Usage: node scripts/cfsSearch.mjs "<query>" [k] [--json]');
  process.exit(1);
}

try {
  const chunks = await search(query, k);

  if (jsonMode) {
    // Structured output with similarity scores for the agent
    // LanceDB _distance is L2 on normalized vectors: similarity = 1 - distance/2
    const results = chunks.map((c) => ({
      page: c.start_page,
      icao: c.icao,
      section: c.section_group,
      text: c.text,
      score: c._distance != null ? +(1 - c._distance / 2).toFixed(3) : 1.0,
    }));
    console.log(JSON.stringify(results));
  } else {
    if (chunks.length === 0) {
      console.log("No results found.");
    } else {
      console.log(
        chunks
          .map((c) => `[CFS Page ${c.start_page} | ${c.icao} | ${c.section_group}]\n${c.text}`)
          .join("\n\n---\n\n"),
      );
    }
  }
} catch (err) {
  console.error("Search failed:", err.message);
  process.exit(1);
}
