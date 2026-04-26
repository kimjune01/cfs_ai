import { LiteParse } from "@llamaindex/liteparse";
import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PDF = join(__dirname, "../public/CFS.pdf");
const DEFAULT_OUT = join(__dirname, "../data/parsed.json");

async function main() {
    const pdfPath = process.argv[2] ?? DEFAULT_PDF;
    const outPath = process.argv[3] ?? DEFAULT_OUT;

    console.error(`Parsing ${pdfPath} with LiteParse...`);

    const parser = new LiteParse({
        ocrEnabled: false, // text PDF, no OCR needed
        preciseBoundingBox: true, // preserve spatial layout for two-column detection
    });

    const result = await parser.parse(pdfPath);

    // Store only what downstream needs: pageNum + text per page
    const pages = result.pages.map((p) => ({
        pageNum: p.pageNum,
        text: p.text,
    }));

    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(pages, null, 2), "utf-8");
    console.error(`Done. ${pages.length} pages written to ${outPath}`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
