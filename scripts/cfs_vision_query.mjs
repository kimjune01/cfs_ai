/**
 * Vision-based CFS query — no RAG, no index, no embeddings, no API key.
 *
 * Flow:
 *   0. Claude resolves the question to a PDF search term (e.g. "Abbotsford" → "CYXX")
 *   1. pdftotext searches the PDF for that term (like Ctrl+F)
 *   2. pdftoppm renders the matching pages to PNG
 *   3. Claude Code reads the images via stream-json and answers
 *
 * Usage: node scripts/cfs_vision_query.mjs "<question>"
 * Uses Claude Code's existing login session.
 */

import { execFile, spawn } from "child_process";
import { promisify } from "util";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { readFileSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");
const PDF_PATH = join(projectRoot, "public", "CFS.pdf");
const CLAUDE_BIN = "/Users/umeshdinkar/.local/bin/claude";

// ─── Parse args ────────────────────────────────────────────────────────────

const question = process.argv.slice(2).join(" ").trim();

if (!question) {
  console.error("Usage: node scripts/cfs_vision_query.mjs \"<question>\"");
  process.exit(1);
}

// ─── Step 0: Claude resolves the question to a search term ─────────────────

console.error("Resolving search term...");

const searchTerm = await new Promise((resolve, reject) => {
  const proc = spawn(
    CLAUDE_BIN,
    ["--enable-auto-mode", "--print", "--output-format", "json", "--model", "sonnet"],
    { cwd: projectRoot, stdio: ["pipe", "pipe", "pipe"] }
  );
  let stdout = "";
  proc.stdout.on("data", (d) => (stdout += d));
  proc.on("close", (code) => {
    if (code !== 0) return reject(new Error(`claude exited ${code}`));
    try {
      const parsed = JSON.parse(stdout);
      resolve(parsed.result.trim().replace(/['"]/g, ""));
    } catch {
      reject(new Error(`Bad output: ${stdout.slice(0, 200)}`));
    }
  });
  proc.stdin.write(
    `You are a Canadian aviation assistant. Given a question about a Canadian aerodrome, ` +
    `return ONLY the best search term to use in the Canadian Flight Supplement PDF — ` +
    `typically a 4-letter ICAO code (e.g. CYXX) or an aerodrome name as it appears in the CFS. ` +
    `No explanation, no punctuation, just the search term.\n\nQuestion: ${question}`
  );
  proc.stdin.end();
});

console.error(`Searching PDF for "${searchTerm}"...`);

const { stdout: pdfText } = await execFileAsync(
  "pdftotext",
  ["-layout", PDF_PATH, "-"],
  { maxBuffer: 50 * 1024 * 1024 }
);

const pages = pdfText.split("\f");
const matchingPages = pages
  .map((text, i) => ({ pageNum: i + 1, text }))
  .filter(({ text }) => text.includes(searchTerm))
  .map(({ pageNum }) => pageNum);

if (matchingPages.length === 0) {
  console.error(`"${searchTerm}" not found in PDF.`);
  process.exit(1);
}

// Find the largest contiguous cluster — that's the main aerodrome entry
const clusters = [];
let current = [];
for (const p of matchingPages) {
  if (current.length === 0 || p - current[current.length - 1] <= 2) {
    current.push(p);
  } else {
    clusters.push(current);
    current = [p];
  }
}
if (current.length) clusters.push(current);
clusters.sort((a, b) => b.length - a.length);
const entryPages = clusters[0] ?? [];

console.error(`Found on pages: ${matchingPages.slice(0, 10).join(", ")}${matchingPages.length > 10 ? "…" : ""}`);
console.error(`Using pages: ${entryPages.join(", ")}`);

// ─── Step 2: Render pages to PNG with pdftoppm ─────────────────────────────

const tmpDir = mkdtempSync(join(tmpdir(), "cfs-vision-"));

try {
  const imageBlocks = [];

  for (const pageNum of entryPages) {
    const outPrefix = join(tmpDir, `page-${pageNum}`);
    await execFileAsync("pdftoppm", [
      "-png", "-r", "100",
      "-f", String(pageNum), "-l", String(pageNum),
      PDF_PATH, outPrefix,
    ]);

    const paddedNum = String(pageNum).padStart(3, "0");
    const pngPath = `${outPrefix}-${paddedNum}.png`;
    const b64 = readFileSync(pngPath).toString("base64");

    imageBlocks.push({ type: "text", text: `--- CFS Page ${pageNum} ---` });
    imageBlocks.push({
      type: "image",
      source: { type: "base64", media_type: "image/png", data: b64 },
    });
  }

  console.error(`Rendered ${entryPages.length} page(s). Asking Claude...`);

  // ─── Step 3: Ask Claude Code via stream-json (no API key needed) ──────────

  const systemPrompt =
    "You are a knowledgeable assistant for Canadian pilots reading pages from the NavCanada Canadian Flight Supplement (CFS). " +
    "Read the page images carefully — they contain dense tabular data with abbreviations, frequencies, and operational notes. " +
    "Answer based solely on what you can read in the images. Be concise and precise. " +
    "Always end your answer with 'Source: CFS page N' citing the exact page number where you found the information.";

  const inputJson = JSON.stringify({
    type: "user",
    message: {
      role: "user",
      content: [...imageBlocks, { type: "text", text: question }],
    },
  }) + "\n";

  const answer = await new Promise((resolve, reject) => {
    const proc = spawn(
      CLAUDE_BIN,
      [
        "--enable-auto-mode",
        "--print",
        "--verbose",
        "--input-format", "stream-json",
        "--output-format", "stream-json",
        "--model", "sonnet",
        "--system-prompt", systemPrompt,
      ],
      { cwd: projectRoot, stdio: ["pipe", "pipe", "pipe"] }
    );

    let stdout = "";
    proc.stdout.on("data", (d) => (stdout += d));
    proc.stderr.on("data", (d) => process.stderr.write(d));
    proc.on("close", (code) => {
      const result = stdout
        .split("\n")
        .filter(Boolean)
        .map((line) => { try { return JSON.parse(line); } catch { return null; } })
        .filter(Boolean)
        .find((obj) => obj.type === "result" && obj.subtype === "success");

      if (result) resolve(result.result);
      else reject(new Error(`No result found. Exit ${code}. Output: ${stdout.slice(0, 300)}`));
    });

    proc.stdin.write(inputJson);
    proc.stdin.end();
  });

  console.log("\n" + answer);

} finally {
  rmSync(tmpDir, { recursive: true, force: true });
}
