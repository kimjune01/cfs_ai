import { execFile, spawn } from "child_process";
import { promisify } from "util";
import { join } from "path";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import type { EmitFn, Turn, VectorChunk } from "./types";

const execFileAsync = promisify(execFile);
const PDF_PATH = join(process.cwd(), "public", "CFS.pdf");
const CLAUDE_BIN = "/Users/umeshdinkar/.local/bin/claude";
const CFS_SEARCH = join(process.cwd(), "scripts", "cfs_search.mjs");

// Strip ANTHROPIC_API_KEY so claude binary uses keychain auth
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const { ANTHROPIC_API_KEY: _key, ...claudeEnv } = process.env;

function attachAbort(proc: ReturnType<typeof spawn>, signal: AbortSignal): void {
  const onAbort = () => proc.kill();
  signal.addEventListener("abort", onAbort);
  proc.on("close", () => signal.removeEventListener("abort", onAbort));
}

export const VECTOR_CONFIDENCE_THRESHOLD = 0.72;
export const ICAO_RE = /\bC[A-Z]{3}\b/;
export const ICAO_RE_GLOBAL = new RegExp(ICAO_RE.source, "g");

export function extractICAOCodes(question: string): string[] {
  return [...question.toUpperCase().matchAll(ICAO_RE_GLOBAL)].map((m) => m[0]);
}

// Cache as a promise so concurrent requests share the same in-flight pdftotext call
let pdfPagesPromise: Promise<string[]> | null = null;

export function getPdfPages(): Promise<string[]> {
  if (!pdfPagesPromise) {
    pdfPagesPromise = execFileAsync(
      "pdftotext",
      ["-layout", PDF_PATH, "-"],
      { maxBuffer: 50 * 1024 * 1024 }
    ).then(({ stdout }) => stdout.split("\f"));
  }
  return pdfPagesPromise;
}

export function searchPages(pdfPages: string[], term: string): number[] {
  return pdfPages
    .map((text, i) => ({ pageNum: i + 1, text }))
    .filter(({ text }) => text.includes(term))
    .map(({ pageNum }) => pageNum);
}

export function largestCluster(pages: number[]): number[] {
  if (pages.length === 0) return [];
  const clusters: number[][] = [];
  let current: number[] = [];
  for (const p of pages) {
    if (current.length === 0 || p - current[current.length - 1] <= 2) {
      current.push(p);
    } else {
      clusters.push(current);
      current = [p];
    }
  }
  if (current.length) clusters.push(current);
  return clusters.sort((a, b) => b.length - a.length)[0];
}

export async function renderPages(
  pageNums: number[]
): Promise<{ pageNum: number; b64: string }[]> {
  const tmpDir = mkdtempSync(join(tmpdir(), "cfs-"));
  try {
    return await Promise.all(
      pageNums.map(async (pageNum) => {
        const prefix = join(tmpDir, `p${pageNum}`);
        await execFileAsync("pdftoppm", [
          "-png", "-r", "100",
          "-f", String(pageNum), "-l", String(pageNum),
          PDF_PATH, prefix,
        ]);
        const paddedNum = String(pageNum).padStart(3, "0");
        const b64 = readFileSync(`${prefix}-${paddedNum}.png`).toString("base64");
        return { pageNum, b64 };
      })
    );
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

// Parse "Source: CFS page N" or "Source: CFS pages N, M" from Claude output
export function parseSourceCitation(
  text: string,
  fallback: number[]
): { answer: string; pages: number[] } {
  const match = text.match(/\nSource:\s*CFS\s+pages?\s+([\d,\s]+)\s*$/i);
  return {
    pages: match
      ? match[1].split(",").map((s) => parseInt(s.trim(), 10)).filter(Boolean)
      : fallback,
    answer: match ? text.slice(0, match.index).trim() : text.trim(),
  };
}

export function formatHistoryForPrompt(history: Turn[]): string {
  if (history.length === 0) return "";
  return (
    "Prior conversation:\n" +
    history
      .map((t) => `${t.role === "user" ? "Pilot" : "Assistant"}: ${t.content}`)
      .join("\n") +
    "\n\n"
  );
}

export function runClaude(prompt: string, signal?: AbortSignal, systemPrompt?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = ["--enable-auto-mode", "--print", "--output-format", "json", "--model", "sonnet"];
    if (systemPrompt) args.push("--system-prompt", systemPrompt);
    const proc = spawn(CLAUDE_BIN, args, { stdio: ["pipe", "pipe", "pipe"], env: claudeEnv });

    if (signal) attachAbort(proc, signal);

    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d: Buffer) => (stdout += d));
    proc.stderr.on("data", (d: Buffer) => (stderr += d));
    proc.on("close", (code) => {
      if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
      try {
        const parsed = JSON.parse(stdout);
        if (parsed.is_error) return reject(new Error(`Claude: ${parsed.result}`));
        resolve(parsed.result.trim());
      } catch {
        const detail = stderr.slice(0, 200) || stdout.slice(0, 200);
        reject(new Error(`claude exited ${code}: ${detail}`));
      }
    });
    proc.stdin.write(prompt);
    proc.stdin.end();
  });
}

export function runClaudeVision(
  imageBlocks: object[],
  question: string,
  systemPrompt: string,
  signal?: AbortSignal
): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      CLAUDE_BIN,
      [
        "--enable-auto-mode", "--print", "--verbose",
        "--input-format", "stream-json",
        "--output-format", "stream-json",
        "--model", "sonnet",
        "--system-prompt", systemPrompt,
      ],
      { stdio: ["pipe", "pipe", "pipe"], env: claudeEnv }
    );

    if (signal) attachAbort(proc, signal);

    const input =
      JSON.stringify({
        type: "user",
        message: {
          role: "user",
          content: [...imageBlocks, { type: "text", text: question }],
        },
      }) + "\n";

    let stdout = "";
    proc.stdout.on("data", (d: Buffer) => (stdout += d));
    proc.on("close", (code) => {
      if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
      const result = stdout
        .split("\n")
        .filter(Boolean)
        .map((line) => { try { return JSON.parse(line); } catch { return null; } })
        .filter(Boolean)
        .find((obj: { type: string; subtype: string }) => obj.type === "result" && obj.subtype === "success");

      if (result) resolve((result as { result: string }).result.trim());
      else reject(new Error(`No result. Exit ${code}. Output: ${stdout.slice(0, 300)}`));
    });

    proc.stdin.write(input);
    proc.stdin.end();
  });
}

export async function vectorSearch(
  query: string,
  emit: EmitFn,
  signal?: AbortSignal
): Promise<{ chunks: VectorChunk[]; topScore: number }> {
  emit({ type: "vector_search", query });

  const result = await new Promise<string>((resolve, reject) => {
    const proc = spawn("node", [CFS_SEARCH, query, "6", "--json"], { stdio: ["pipe", "pipe", "pipe"] });

    if (signal) attachAbort(proc, signal);

    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d: Buffer) => (stdout += d));
    proc.stderr.on("data", (d: Buffer) => (stderr += d));
    proc.on("close", (code) => {
      if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
      if (code !== 0) return reject(new Error(`cfs_search failed: ${stderr.slice(0, 200)}`));
      resolve(stdout.trim());
    });
    proc.stdin.end();
  });

  let chunks: VectorChunk[] = [];
  try {
    const parsed = JSON.parse(result);
    if (Array.isArray(parsed) && parsed.every((c) => typeof c.page === "number" && typeof c.score === "number")) {
      chunks = parsed as VectorChunk[];
    }
  } catch {
    // Non-JSON output means no results
  }

  const topScore = chunks.length > 0 ? Math.max(...chunks.map((c) => c.score)) : 0;
  emit({ type: "vector_results", count: chunks.length, topScore });

  return { chunks, topScore };
}

const VISION_SYSTEM_PROMPT = `You are the Canadian Flight Supplement Aviation Assistant. Answer ONLY from the CFS page images provided.

- A field only counts as an answer if its label in the document directly matches what was asked. If the label does not match, do not use that field — state what labels ARE present and clarify they are not the same thing as what was asked.
- DO NOT substitute a related or adjacent field when the exact one is absent. Absence of a label means that service does not exist at this aerodrome.
- If the data is absent: respond only with "Not published in this CFS entry."
- If off-topic: respond only with "I can only answer questions about the Canadian Flight Supplement."
- Otherwise end your answer with "Source: CFS page N" or "Source: CFS pages N, M" (ONLY PAGES YOU ACTUALLY USED).`;

export async function visionRead(
  searchTerms: string[],
  question: string,
  emit: EmitFn,
  signal?: AbortSignal
): Promise<{ answer: string; sourcePages: number[] }> {
  emit({ type: "vision_search", terms: searchTerms });

  const pdfPages = await getPdfPages();

  const allClusters = await Promise.all(
    searchTerms.map((term) => largestCluster(searchPages(pdfPages, term)))
  );

  const seenPages = new Set<number>();
  const entryPages = allClusters
    .flat()
    .filter((p) => !seenPages.has(p) && seenPages.add(p))
    .sort((a, b) => a - b);

  if (entryPages.length === 0) {
    return {
      answer: `Could not find relevant pages in the CFS for: ${searchTerms.join(", ")}.`,
      sourcePages: [],
    };
  }

  emit({ type: "vision_render", pages: entryPages });
  const images = await renderPages(entryPages);

  const imageBlocks = images.flatMap(({ pageNum, b64 }) => [
    { type: "text", text: `--- CFS Page ${pageNum} ---` },
    { type: "image", source: { type: "base64", media_type: "image/png", data: b64 } },
  ]);

  const full = await runClaudeVision(imageBlocks, question, VISION_SYSTEM_PROMPT, signal);
  const { answer, pages } = parseSourceCitation(full, entryPages);
  return { answer, sourcePages: pages };
}

export function parseJsonStringArray(raw: string): string[] {
  try {
    const jsonStr = raw.match(/\[[\s\S]*\]/)?.[0] ?? raw;
    return (JSON.parse(jsonStr) as string[]).map((t) => t.replace(/['"`.]/g, "").trim()).filter(Boolean);
  } catch {
    return [raw.replace(/['"`.]/g, "").trim()].filter(Boolean);
  }
}

// Extract PDF-searchable terms: ICAO codes from question (fast), or Claude-generated (slow)
export async function extractSearchTerms(question: string, signal?: AbortSignal): Promise<string[]> {
  const icaoCodes = extractICAOCodes(question);
  if (icaoCodes.length > 0) return icaoCodes;

  const raw = await runClaude(
    `Return a JSON array of search terms to find this aerodrome in the NavCanada CFS PDF. ` +
    `First term must be the 4-letter ICAO code. Optionally add the aerodrome name. No section keywords (runway, frequency, etc.).\n\n` +
    `Question: ${question}`,
    signal
  );
  return parseJsonStringArray(raw);
}

export async function rephraseMultipleQueries(
  question: string,
  icaos: string[],
  signal?: AbortSignal
): Promise<string[]> {
  const raw = await runClaude(
    `Return a JSON array of concise vector search queries for the NavCanada CFS, one per ICAO code. ` +
    `Keep each ICAO code and the specific topic from the question. Remove aerodrome names. ` +
    `ICAOs: ${icaos.join(", ")}\n\nQuestion: ${question}`,
    signal
  );
  const queries = parseJsonStringArray(raw);
  if (queries.length !== icaos.length) {
    return icaos.map((icao) => icao);
  }
  return queries;
}


export function checkICAO(question: string): string | null {
  return ICAO_RE.test(question.toUpperCase())
    ? null
    : "Please include the 4-letter ICAO code for the aerodrome (e.g. CYVR for Vancouver, CYXX for Abbotsford, CYHE for Hope). What aerodrome are you asking about?";
}

export async function findEffortNeeded(
  question: string,
  history: Turn[],
  signal?: AbortSignal
): Promise<boolean> {
  // Fast path: no history — pilot can't be repeating/doubting yet
  if (history.length === 0) return false;

  const prompt =
    `${formatHistoryForPrompt(history)}` +
    `Pilot: "${question}"\n\n` +
    `Return {"high_effort": true} if the pilot is repeating a question, expressing doubt, or asking to verify. ` +
    `Otherwise {"high_effort": false}.`;

  try {
    const raw = await runClaude(prompt, signal);
    const jsonStr = raw.match(/\{[\s\S]*\}/)?.[0] ?? raw;
    const parsed = JSON.parse(jsonStr) as { high_effort: boolean };
    return parsed.high_effort ?? false;
  } catch {
    return false;
  }
}
