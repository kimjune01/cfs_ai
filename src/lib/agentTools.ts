import { execFile, spawn } from "child_process";
import { promisify } from "util";
import { join } from "path";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import type { Turn } from "./types";
import { CLAUDE_BIN, claudeEnv, attachAbort } from "./processUtils";

const execFileAsync = promisify(execFile);
const PDF_PATH = join(process.cwd(), "public", "CFS.pdf");

// Cache as a promise so concurrent requests share the same in-flight pdftotext call
let pdfPagesPromise: Promise<string[]> | null = null;

const getPdfPages = (): Promise<string[]> => {
  if (!pdfPagesPromise) {
    pdfPagesPromise = execFileAsync("pdftotext", ["-layout", PDF_PATH, "-"], {
      maxBuffer: 50 * 1024 * 1024,
    }).then(({ stdout }) => stdout.split("\f"));
  }
  return pdfPagesPromise;
};

const searchPages = (pdfPages: string[], term: string): number[] =>
  pdfPages
    .map((text, i) => ({ pageNum: i + 1, text }))
    .filter(({ text }) => text.includes(term))
    .map(({ pageNum }) => pageNum);

const largestCluster = (pages: number[]): number[] => {
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
};

const renderPages = async (pageNums: number[]): Promise<{ pageNum: number; b64: string }[]> => {
  const tmpDir = mkdtempSync(join(tmpdir(), "cfs-"));
  try {
    return await Promise.all(
      pageNums.map(async (pageNum) => {
        const prefix = join(tmpDir, `p${pageNum}`);
        await execFileAsync("pdftoppm", [
          "-png",
          "-r",
          "100",
          "-f",
          String(pageNum),
          "-l",
          String(pageNum),
          PDF_PATH,
          prefix,
        ]);
        const paddedNum = String(pageNum).padStart(3, "0");
        const b64 = readFileSync(`${prefix}-${paddedNum}.png`).toString("base64");
        return { pageNum, b64 };
      }),
    );
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
};

// Parse "Source: CFS page N" or "Source: CFS pages N, M" from Claude output
const parseSourceCitation = (
  text: string,
  fallback: number[],
): { answer: string; pages: number[] } => {
  const match = text.match(/\nSource:\s*CFS\s+pages?\s+([\d,\s]+)\s*$/i);
  return {
    pages: match
      ? match[1]
          .split(",")
          .map((s) => parseInt(s.trim(), 10))
          .filter(Boolean)
      : fallback,
    answer: match ? text.slice(0, match.index).trim() : text.trim(),
  };
};

const VECTOR_CONFIDENCE_THRESHOLD = 0.72;
const ICAO_RE = /\bC[A-Z]{3}\b/;
const ICAO_RE_GLOBAL = new RegExp(ICAO_RE.source, "g");

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

const runClaude = (prompt: string, signal?: AbortSignal, systemPrompt?: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const args = ["--enable-auto-mode", "--print", "--output-format", "json", "--model", "sonnet"];
    if (systemPrompt) args.push("--system-prompt", systemPrompt);
    const proc = spawn(CLAUDE_BIN, args, { stdio: ["pipe", "pipe", "pipe"], env: claudeEnv });

    if (signal) attachAbort(proc, signal);

    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    proc.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    proc.on("close", (code) => {
      if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
      try {
        const parsed = JSON.parse(stdout) as { is_error: boolean; result: string };
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

const parseJsonStringArray = (raw: string): string[] => {
  try {
    const jsonStr = raw.match(/\[[\s\S]*\]/)?.[0] ?? raw;
    return (JSON.parse(jsonStr) as string[])
      .map((t) => t.replace(/['"`.]/g, "").trim())
      .filter(Boolean);
  } catch {
    return [raw.replace(/['"`.]/g, "").trim()].filter(Boolean);
  }
};

// Extract PDF-searchable terms: ICAO codes from question (fast), or Claude-generated (slow)
const extractSearchTerms = async (question: string, signal?: AbortSignal): Promise<string[]> => {
  const icaoCodes = extractICAOCodes(question);
  if (icaoCodes.length > 0) return icaoCodes;

  const raw = await runClaude(
    `Return a JSON array of search terms to find this aerodrome in the NavCanada CFS PDF. ` +
      `First term must be the 4-letter ICAO code. Optionally add the aerodrome name. No section keywords (runway, frequency, etc.).\n\n` +
      `Question: ${question}`,
    signal,
  );
  return parseJsonStringArray(raw);
};

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

const checkICAO = (question: string): string | null =>
  ICAO_RE.test(question.toUpperCase())
    ? null
    : "Please include the 4-letter ICAO code for the aerodrome (e.g. CYVR for Vancouver, CYXX for Abbotsford, CYHE for Hope). What aerodrome are you asking about?";

const findEffortNeeded = async (
  question: string,
  history: Turn[],
  signal?: AbortSignal,
): Promise<boolean> => {
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
};

export {
  PDF_PATH,
  getPdfPages,
  searchPages,
  largestCluster,
  renderPages,
  parseSourceCitation,
  VECTOR_CONFIDENCE_THRESHOLD,
  ICAO_RE,
  ICAO_RE_GLOBAL,
  extractICAOCodes,
  formatHistoryForPrompt,
  runClaude,
  parseJsonStringArray,
  extractSearchTerms,
  rephraseMultipleQueries,
  checkICAO,
  findEffortNeeded,
};
