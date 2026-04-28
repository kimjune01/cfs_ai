/**
 * Convert liteParse JSON output to markdown with <!-- page:N --> markers.
 * Usage: node scripts/build/liteToMarkdown.mjs [input.json] [output.md]
 */

import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_INPUT = join(__dirname, "../../data/parsed_lite.json");
const DEFAULT_OUTPUT = join(__dirname, "../../data/parsed_llama_preprocessed.md");

const inputPath = process.argv[2] ?? DEFAULT_INPUT;
const outputPath = process.argv[3] ?? DEFAULT_OUTPUT;

const pages = JSON.parse(readFileSync(inputPath, "utf-8"));

const md = pages
    .map((p) => `<!-- page:${p.pageNum} -->\n${p.text}`)
    .join("\n\n");

writeFileSync(outputPath, md, "utf-8");
console.error(`Done. ${pages.length} pages written to ${outputPath}`);
