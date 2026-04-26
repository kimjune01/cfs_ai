/**
 * Generic LanceDB vector search CLI.
 *
 * Usage: node scripts/cfsVectorSearch.mjs "<query>" [k] [--json] [--db <path>] [--table <name>]
 * Requires: JINA_API_KEY env var
 */

import * as lancedb from "@lancedb/lancedb";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const JINA_API_KEY = process.env.JINA_API_KEY;
if (!JINA_API_KEY) {
    console.error("JINA_API_KEY is not set");
    process.exit(1);
}

const DEFAULT_K = 5;

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

const dbPath = getFlag("db") ?? join(__dirname, "../../data/lancedb");
const tableName = getFlag("table") ?? "cfs";

const query = args[0];
const k = parseInt(args[1] ?? String(DEFAULT_K), 10);

if (!query) {
    console.error(
        'Usage: node scripts/runtime/cfsVectorSearch.mjs "<query>" [k] [--json] [--db <path>] [--table <name>]',
    );
    process.exit(1);
}

async function embedQuery(text) {
    const resp = await fetch("https://api.jina.ai/v1/embeddings", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${JINA_API_KEY}`,
        },
        body: JSON.stringify({
            model: "jina-embeddings-v4",
            task: "retrieval.query",
            normalized: true,
            input: [{ text }],
        }),
    });
    if (!resp.ok) {
        const body = await resp.text();
        throw new Error(`Jina API error ${resp.status}: ${body.slice(0, 200)}`);
    }
    const data = await resp.json();
    return data.data[0].embedding;
}

async function search(query, k) {
    const queryVec = await embedQuery(query);
    const db = await lancedb.connect(dbPath);
    const table = await db.openTable(tableName);

    const rows = await table.search(queryVec).limit(k).toArray();
    return rows
        .map(({ vector: _v, _distance, ...c }) => ({
            ...c,
            score: _distance != null ? 1 - _distance / 2 : 1.0,
        }))
        .sort((a, b) => b.score - a.score);
}

try {
    const chunks = await search(query, k);

    if (jsonMode) {
        const results = chunks.map((c) => ({
            startPage: Number(c.start_page),
            endPage: Number(c.end_page),
            title: c.title ?? "",
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
