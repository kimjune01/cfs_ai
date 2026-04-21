import { execFile } from "child_process";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";

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

const parseSourceCitation = (
  text: string,
  fallback: number[],
): { answer: string; pages: number[] } => {
  const match = text.match(/\nSource:\s*CFS\s+pages?\s+([\d,\s]+)\s*$/i);
  if (!match) {
    console.warn("Vision response missing source citation:", text.slice(-150));
  }
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

export { getPdfPages, largestCluster, parseSourceCitation, renderPages, searchPages };
