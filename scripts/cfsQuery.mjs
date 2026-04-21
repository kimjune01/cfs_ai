/**
 * Standalone agentic CFS query script — no UI required.
 *
 * Flow:
 *   1. Claude Code expands the user query into alternative phrasings
 *   2. All phrasings hit the vector DB in parallel for initial context
 *   3. Claude Code drives agentic RAG via Bash calls to cfsSearch.mjs
 *
 * Usage: node scripts/cfsQuery.mjs "<question>"
 * Uses Claude Code's existing login session — no API key required.
 */

import { spawn, execFile } from "child_process";
import { promisify } from "util";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");
const searchScript = join(__dirname, "cfsSearch.mjs");
const CLAUDE_BIN = "claude";

const userQuery = process.argv.slice(2).join(" ").trim();
if (!userQuery) {
  console.error("Usage: node scripts/cfsQuery.mjs <question>");
  process.exit(1);
}

// Run claude -p via the installed binary (uses existing OAuth session).
// Prompt is passed via stdin to handle multiline safely.
function runClaude(prompt, extraArgs = []) {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      CLAUDE_BIN,
      [
        "--enable-auto-mode",
        "--print",
        "--output-format",
        "json",
        "--model",
        "sonnet",
        ...extraArgs,
      ],
      { cwd: projectRoot, stdio: ["pipe", "pipe", "pipe"] },
    );

    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d));
    proc.stderr.on("data", (d) => (stderr += d));
    proc.on("close", (code) => {
      if (code !== 0) return reject(new Error(`claude exited ${code}: ${stderr}`));
      try {
        const parsed = JSON.parse(stdout);
        if (parsed.is_error) return reject(new Error(`Claude error: ${parsed.result}`));
        resolve(parsed.result);
      } catch {
        reject(new Error(`Failed to parse claude output: ${stdout}`));
      }
    });

    proc.stdin.write(prompt);
    proc.stdin.end();
  });
}

// Run the local search helper, return formatted chunk text
async function localSearch(query) {
  const { stdout } = await execFileAsync("node", [searchScript, query], {
    cwd: projectRoot,
    encoding: "utf8",
    maxBuffer: 5 * 1024 * 1024,
  });
  return stdout.trim();
}

// ─── Phase 1: Query expansion ──────────────────────────────────────────────

console.error("Expanding query...");

const expansionRaw = await runClaude(
  `You are a query expansion assistant for a Canadian aviation database (CFS - Canadian Flight Supplement).
Given a user question, return 3-4 alternative search queries that capture different aspects or phrasings.
Return ONLY a JSON array of strings — no explanation, no markdown.

User question: ${userQuery}`,
);

let alternatives;
try {
  const jsonStr = expansionRaw.match(/\[[\s\S]*\]/)?.[0] ?? expansionRaw;
  alternatives = JSON.parse(jsonStr);
} catch {
  alternatives = [];
}

const queries = [userQuery, ...alternatives.filter((q) => q !== userQuery)];
console.error(`Queries: ${queries.join(" | ")}`);

// ─── Phase 2: Parallel initial retrieval ───────────────────────────────────

console.error("Searching CFS...");

const searchResults = await Promise.allSettled(queries.map((q) => localSearch(q)));

const seenHeaders = new Set();
const initialChunks = searchResults
  .filter((r) => r.status === "fulfilled" && r.value)
  .flatMap((r) => r.value.split("\n\n---\n\n"))
  .filter((chunk) => {
    const header = chunk.match(/\[CFS Page \d+[^\]]*\]/)?.[0];
    if (!header || seenHeaders.has(header)) return false;
    seenHeaders.add(header);
    return true;
  });

const initialContext = initialChunks.join("\n\n---\n\n") || "No initial results found.";

// ─── Phase 3: Agentic RAG via Claude Code ──────────────────────────────────

console.error("Running agentic RAG...");

const systemPrompt = `You are a knowledgeable assistant for Canadian pilots answering questions about the NavCanada Canadian Flight Supplement (CFS).

You have access to a Bash tool. Use it to call:
  node ${searchScript} "<query>"
to search the CFS vector database. Call it multiple times with different phrasings if the first results are insufficient.

Rules:
- Answer ONLY questions about the CFS: aerodromes, circuit altitudes, runway data, radio frequencies, lighting, fuel, operating hours, airspace, or other CFS content.
- Base answers solely on what the search tool returns. Do not invent information.
- If retrieved context is insufficient, say so clearly.
- Be concise and precise — pilots value accuracy over verbosity.`;

const userMessage = `${userQuery}

Initial search results (from query expansion):
${initialContext}`;

const answer = await runClaude(userMessage, [
  "--system-prompt",
  systemPrompt,
  "--allowedTools",
  "Bash",
  "--permission-mode",
  "bypassPermissions",
]);

console.log("\n" + answer);
