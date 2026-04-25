/**
 * Generic LanceDB vector search CLI.
 *
 * Usage: node scripts/cfsVectorSearch.mjs "<query>" [k] [--json] [--db <path>] [--table <name>] [--model <id>]
 */

import { pipeline } from "@xenova/transformers";
import * as lancedb from "@lancedb/lancedb";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEFAULT_K = 5;
// BM25-only hits get a fixed score below typical vector scores (~0.75)
// so they appear after vector results but are always included in the union.
const BM25_SCORE = 0.5;

const rawArgs = process.argv.slice(2);
const jsonMode = rawArgs.includes("--json");

const getFlag = (name) => {
    const idx = rawArgs.indexOf(`--${name}`);
    return idx !== -1 ? rawArgs[idx + 1] : null;
};

// Collect positional args by skipping flags and their values
const args = [];
for (let i = 0; i < rawArgs.length; i++) {
    if (rawArgs[i].startsWith("--")) {
        if (rawArgs[i] !== "--json") i++; // skip flag value
    } else {
        args.push(rawArgs[i]);
    }
}

const dbPath = getFlag("db") ?? join(__dirname, "../data/lancedb");
const tableName = getFlag("table") ?? "cfs";
const modelId = getFlag("model") ?? "Xenova/jina-embeddings-v2-base-en";

const query = args[0];
const k = parseInt(args[1] ?? String(DEFAULT_K), 10);

if (!query) {
    console.error(
        'Usage: node scripts/cfsVectorSearch.mjs "<query>" [k] [--json] [--db <path>] [--table <name>] [--model <id>]',
    );
    process.exit(1);
}

async function search(query, k) {
    const embedder = await pipeline("feature-extraction", modelId);
    const db = await lancedb.connect(dbPath);
    const table = await db.openTable(tableName);

    // Don't normalize — keep the same scale as stored index vectors so
    // L2 distances are meaningful. queryNorm2 used in cosine score formula.
    const output = await embedder(query, { pooling: "mean", normalize: false });
    const queryVec = Array.from(output.data);
    const queryNorm2 = queryVec.reduce((s, x) => s + x * x, 0);

    // Vector pass
    const vecRows = await table.search(queryVec).limit(k).toArray();
    const vecChunks = vecRows.map(({ vector: _v, _distance, ...c }) => ({
        ...c,
        score: _distance != null ? 1 - _distance / (2 * queryNorm2) : 1.0,
    }));

    // BM25 pass — union with vector results, don't replace them.
    // Skipped silently if no FTS index exists on this table.
    let bm25Chunks = [];
    try {
        const bm25Rows = await table
            .query()
            .fullTextSearch(query, { columns: ["text"] })
            .select(["id", "start_page", "end_page", "text"])
            .limit(k)
            .toArray();
        bm25Chunks = bm25Rows.map((c) => ({ ...c, score: BM25_SCORE }));
    } catch {
        /* no FTS index */
    }

    // Deduplicate by id keeping max score, then sort
    const seen = new Map();
    for (const chunk of [...vecChunks, ...bm25Chunks]) {
        const key = Number(chunk.id);
        const existing = seen.get(key);
        if (!existing || chunk.score > existing.score) seen.set(key, chunk);
    }
    return [...seen.values()].sort((a, b) => b.score - a.score);
}

try {
    const chunks = await search(query, k);

    if (jsonMode) {
        const results = chunks.map((c) => ({
            startPage: Number(c.start_page),
            endPage: Number(c.end_page),
            text: c.text,
            score: +c.score.toFixed(3),
        }));
        console.log(JSON.stringify(results, (_, v) => (typeof v === "bigint" ? Number(v) : v)));
    } else {
        if (chunks.length === 0) {
            console.log("No results found.");
        } else {
            console.log(
                chunks
                    .map((c) => `[Page ${Number(c.start_page)}–${Number(c.end_page)}]\n${c.text}`)
                    .join("\n\n---\n\n"),
            );
        }
    }
} catch (err) {
    console.error("Search failed:", err.message);
    process.exit(1);
}
