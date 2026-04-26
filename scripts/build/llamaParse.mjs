/**
 * Parse CFS.pdf via LlamaParse cloud API → data/parsed_llama.md
 *
 * Automatically splits large PDFs into 100-page segments to work around
 * the LlamaParse upload size limit, then re-assembles with correct page numbers.
 *
 * Usage: LLAMA_CLOUD_API_KEY=<key> node scripts/llamaParse.mjs [input.pdf] [output.md]
 */

import { LlamaCloud, toFile } from "@llamaindex/llama-cloud";
import { createReadStream, writeFileSync, mkdirSync, realpathSync, unlinkSync } from "fs";
import { join, dirname, basename } from "path";
import { fileURLToPath } from "url";
import { execFileSync } from "child_process";
import { tmpdir } from "os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PYTHON = join(__dirname, "../../.venv/bin/python");
const DEFAULT_PDF = join(__dirname, "../../public/CFS.pdf");
const DEFAULT_OUT = join(__dirname, "../../data/parsed_llama.md");
const SEGMENT_PAGES = 100;

const pdfPath = realpathSync(process.argv[2] ?? DEFAULT_PDF);
const outPath = process.argv[3] ?? DEFAULT_OUT;

if (!process.env.LLAMA_CLOUD_API_KEY) {
    console.error("LLAMA_CLOUD_API_KEY not set");
    process.exit(1);
}

const client = new LlamaCloud({ apiKey: process.env.LLAMA_CLOUD_API_KEY, timeout: 300_000 });

function getPageCount(pdf) {
    const out = execFileSync(PYTHON, [
        "-c",
        `import pypdf; print(len(pypdf.PdfReader('${pdf}').pages))`,
    ]);
    return parseInt(out.toString().trim(), 10);
}

function splitPdf(pdf, startPage, endPage, outFile) {
    execFileSync(PYTHON, [
        "-c",
        `
import pypdf, sys
r = pypdf.PdfReader('${pdf}')
w = pypdf.PdfWriter()
for i in range(${startPage}, min(${endPage}, len(r.pages))):
    w.add_page(r.pages[i])
with open('${outFile}', 'wb') as f:
    w.write(f)
`,
    ]);
}

async function parseSegment(segmentPath, pageOffset) {
    console.error(`  Uploading ${basename(segmentPath)}...`);
    const uploaded = await client.files.create({
        file: await toFile(createReadStream(segmentPath), basename(segmentPath)),
        purpose: "parse",
    });
    console.error(`  file_id: ${uploaded.id}`);

    const result = await client.parsing.parse(
        {
            tier: "cost_effective",
            version: "latest",
            file_id: uploaded.id,
            expand: ["markdown"],
        },
        { verbose: true },
    );

    const pages = result.markdown?.pages;
    if (!pages?.length) {
        console.error("No pages returned:", JSON.stringify(result.job));
        process.exit(1);
    }
    console.error(`  ${pages.length} pages parsed`);

    return pages
        .map((p) => `<!-- page:${p.page_number + pageOffset} -->\n${p.markdown}`)
        .join("\n\n");
}

const totalPages = getPageCount(pdfPath);
console.error(`Parsing ${pdfPath} (${totalPages} pages) with LlamaParse...`);

const segments = [];
for (let start = 0; start < totalPages; start += SEGMENT_PAGES) {
    segments.push({ start, end: Math.min(start + SEGMENT_PAGES, totalPages) });
}
console.error(`Split into ${segments.length} segments of up to ${SEGMENT_PAGES} pages each`);

const tmpDir = tmpdir();
const markdownParts = [];

for (let i = 0; i < segments.length; i++) {
    const { start, end } = segments[i];
    console.error(`\nSegment ${i + 1}/${segments.length}: pages ${start + 1}–${end}`);

    const segPath = join(tmpDir, `cfs_seg_${i}.pdf`);
    splitPdf(pdfPath, start, end, segPath);

    const md = await parseSegment(segPath, start);
    markdownParts.push(md);

    unlinkSync(segPath);
}

const markdown = markdownParts.join("\n\n");
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, markdown, "utf-8");
console.error(`\nDone. Written to ${outPath}`);
