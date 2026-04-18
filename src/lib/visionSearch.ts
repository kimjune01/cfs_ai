import { spawn } from "child_process";
import { attachAbort, claudeEnv, CLAUDE_BIN } from "./processUtils";
import {
  getPdfPages,
  searchPages,
  largestCluster,
  renderPages,
  parseSourceCitation,
} from "./agentTools";
import type { EmitFn } from "./types";

const VISION_SYSTEM_PROMPT = `You are the Canadian Flight Supplement Aviation Assistant. Answer ONLY from the CFS page images provided.

- A field only counts as an answer if its label in the document directly matches what was asked. If the label does not match, do not use that field — state what labels ARE present and clarify they are not the same thing as what was asked.
- DO NOT substitute a related or adjacent field when the exact one is absent. Absence of a label means that service does not exist at this aerodrome.
- If the data is absent: respond only with "Not published in this CFS entry."
- If off-topic: respond only with "I can only answer questions about the Canadian Flight Supplement."
- Otherwise end your answer with "Source: CFS page N" or "Source: CFS pages N, M" (ONLY PAGES YOU ACTUALLY USED).`;

const runClaudeVision = (
  imageBlocks: object[],
  question: string,
  signal?: AbortSignal,
): Promise<string> =>
  new Promise((resolve, reject) => {
    const proc = spawn(
      CLAUDE_BIN,
      [
        "--enable-auto-mode",
        "--print",
        "--verbose",
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--model",
        "sonnet",
        "--system-prompt",
        VISION_SYSTEM_PROMPT,
      ],
      { stdio: ["pipe", "pipe", "pipe"], env: claudeEnv },
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
    proc.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    proc.on("close", (code) => {
      if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
      type StreamResult = { type: string; subtype: string; result: string };
      const result = stdout
        .split("\n")
        .filter(Boolean)
        .map((line): StreamResult | null => {
          try {
            return JSON.parse(line) as StreamResult;
          } catch {
            return null;
          }
        })
        .filter((obj): obj is StreamResult => obj !== null)
        .find((obj) => obj.type === "result" && obj.subtype === "success");

      if (result) resolve(result.result.trim());
      else reject(new Error(`No result. Exit ${code}. Output: ${stdout.slice(0, 300)}`));
    });

    proc.stdin.write(input);
    proc.stdin.end();
  });

const visionRead = async (
  searchTerms: string[],
  question: string,
  emit: EmitFn,
  signal?: AbortSignal,
): Promise<{ answer: string; sourcePages: number[] }> => {
  emit({ type: "vision_search", terms: searchTerms });

  const pdfPages = await getPdfPages();

  const allClusters = searchTerms.map((term) => largestCluster(searchPages(pdfPages, term)));

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

  const full = await runClaudeVision(imageBlocks, question, signal);
  const { answer, pages } = parseSourceCitation(full, entryPages);
  return { answer, sourcePages: pages };
};

export { visionRead };
