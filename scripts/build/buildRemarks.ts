/**
 * Build script: extract unstructured text per aerodrome/section into remarks files
 *
 * Reads data/parsed_llama_preprocessed.md, extracts unstructured text per
 * aerodrome into data/remarks/{ICAO}.txt, and CFS section text into
 * data/remarks/_sections/{SECTION_NAME}.txt, with source page markers.
 *
 * Also generates data/remarks/index.json with one-line summaries.
 *
 * Usage:
 *   npx tsx scripts/build/buildRemarks.ts
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const DATA_DIR = join(process.cwd(), "data");
const INPUT_PATH = join(DATA_DIR, "parsed_llama_preprocessed.md");
const REMARKS_DIR = join(DATA_DIR, "remarks");
const SECTIONS_DIR = join(REMARKS_DIR, "_sections");

const CFS_SECTIONS = [
    "General",
    "Planning",
    "Radio Navigation and Communications",
    "Military Flight Data and Procedures",
    "Emergency",
];

type RemarksEntry = {
    file: string;
    summary: string;
    pages: number[];
};

const extractPages = (text: string): number[] => {
    const pages = new Set<number>();
    const regex = /<!--\s*(?:source_)?page:(\d+)\s*-->/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
        pages.add(parseInt(match[1], 10));
    }
    return [...pages].sort((a, b) => a - b);
};

const convertPageMarkers = (text: string): string => {
    // Convert <!-- page:N --> to <!-- source_page:N --> for runtime
    return text.replace(/<!--\s*page:(\d+)\s*-->/g, "<!-- source_page:$1 -->");
};

const splitDocument = (
    markdown: string,
): { aerodromes: Map<string, string>; sections: Map<string, string> } => {
    const aerodromes = new Map<string, string>();
    const sections = new Map<string, string>();
    const lines = markdown.split("\n");

    let currentKey = "";
    let currentType: "aerodrome" | "section" | "none" = "none";
    let currentText = "";

    const flush = () => {
        if (currentKey && currentText.trim().length > 0) {
            const converted = convertPageMarkers(currentText.trim());
            if (currentType === "aerodrome") {
                aerodromes.set(currentKey, converted);
            } else if (currentType === "section") {
                sections.set(currentKey, converted);
            }
        }
    };

    for (const line of lines) {
        // Detect aerodrome section start
        const icaoMatch =
            /^#+\s*(C[A-Z0-9]{3})\b/.exec(line) ?? /^(C[A-Z0-9]{3})\s+[-–—]/.exec(line);

        if (icaoMatch) {
            flush();
            currentKey = icaoMatch[1];
            currentType = "aerodrome";
            currentText = line + "\n";
            continue;
        }

        // Detect CFS section start
        const sectionMatch = /^#+\s*(.+)$/.exec(line);
        if (sectionMatch) {
            const heading = sectionMatch[1].trim();
            const matchedSection = CFS_SECTIONS.find(
                (s) => heading.toLowerCase().includes(s.toLowerCase()),
            );
            if (matchedSection) {
                flush();
                currentKey = matchedSection;
                currentType = "section";
                currentText = line + "\n";
                continue;
            }
        }

        currentText += line + "\n";
    }

    flush();
    return { aerodromes, sections };
};

const main = () => {
    if (!existsSync(INPUT_PATH)) {
        console.error(`Input file not found: ${INPUT_PATH}`);
        process.exit(1);
    }

    // Create directories
    mkdirSync(REMARKS_DIR, { recursive: true });
    mkdirSync(SECTIONS_DIR, { recursive: true });

    const markdown = readFileSync(INPUT_PATH, "utf-8");
    const { aerodromes, sections } = splitDocument(markdown);

    const index: RemarksEntry[] = [];

    // Write aerodrome files
    for (const [icao, text] of aerodromes) {
        const filePath = join(REMARKS_DIR, `${icao}.txt`);
        writeFileSync(filePath, text, "utf-8");

        const pages = extractPages(text);
        const firstLine = text.split("\n").find((l) => l.trim().length > 0) ?? icao;
        index.push({
            file: `${icao}.txt`,
            summary: firstLine.slice(0, 100),
            pages,
        });
    }

    // Write section files
    for (const [name, text] of sections) {
        const filePath = join(SECTIONS_DIR, `${name}.txt`);
        writeFileSync(filePath, text, "utf-8");

        const pages = extractPages(text);
        index.push({
            file: `_sections/${name}.txt`,
            summary: name,
            pages,
        });
    }

    // Write index
    writeFileSync(join(REMARKS_DIR, "index.json"), JSON.stringify(index, null, 2), "utf-8");

    console.log(
        `Done: ${aerodromes.size} aerodrome files, ${sections.size} section files written to ${REMARKS_DIR}`,
    );
};

main();
