import { readFileSync } from "fs";
import { join } from "path";

import { REMARKS_SYSTEM_PROMPT } from "./prompts";
import type { LayerResult } from "./types";
import { runClaude } from "./utils/claudeUtils";
import { getDb } from "./utils/db";

const REMARKS_DIR = join(process.cwd(), "data", "remarks");

const ICAO_RE = /^C[A-Z0-9]{3}$/;
const VALID_SECTIONS = new Set([
    "General",
    "Planning",
    "Radio Navigation and Communications",
    "Military Flight Data and Procedures",
    "Emergency",
]);

const resolveToIcao = (name: string): string | null => {
    try {
        const db = getDb();
        const row = db
            .prepare("SELECT icao FROM aerodromes WHERE LOWER(name) LIKE ?")
            .get(`%${name.toLowerCase()}%`) as { icao: string } | undefined;
        return row?.icao ?? null;
    } catch {
        return null;
    }
};

const extractSourcePages = (text: string): number[] => {
    const pages = new Set<number>();
    const regex = /<!--\s*source_page:(\d+)\s*-->/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
        pages.add(parseInt(match[1], 10));
    }
    return [...pages].sort((a, b) => a - b);
};

const loadRemarksFile = (target: string): string | null => {
    const upper = target.toUpperCase();
    if (ICAO_RE.test(upper)) {
        try {
            return readFileSync(join(REMARKS_DIR, `${upper}.txt`), "utf-8");
        } catch {
            return null;
        }
    }

    if (VALID_SECTIONS.has(target)) {
        try {
            return readFileSync(join(REMARKS_DIR, "_sections", `${target}.txt`), "utf-8");
        } catch {
            return null;
        }
    }

    const resolved = resolveToIcao(target);
    if (resolved) {
        try {
            return readFileSync(join(REMARKS_DIR, `${resolved}.txt`), "utf-8");
        } catch {
            return null;
        }
    }

    return null;
};

const remarksSearch = async (
    target: string,
    question: string,
    signal?: AbortSignal,
): Promise<LayerResult> => {
    try {
        if (!target || typeof target !== "string") {
            return { status: "empty", sourcePages: [], route: "remarks" };
        }

        const text = loadRemarksFile(target);

        if (!text) {
            return { status: "empty", sourcePages: [], route: "remarks" };
        }

        const sourcePages = extractSourcePages(text);

        const prompt = `<cfs_text>\n${text}\n</cfs_text>\n\n<question>\n${question}\n</question>`;

        const answer = await runClaude({
            prompt,
            signal,
            systemPrompt: REMARKS_SYSTEM_PROMPT,
            model: "haiku",
        });

        if (
            answer.toLowerCase().includes("not found") ||
            answer.toLowerCase().includes("not present") ||
            answer.toLowerCase().includes("not mentioned")
        ) {
            return { status: "empty", sourcePages, route: "remarks" };
        }

        return { status: "hit", answer, sourcePages, route: "remarks" };
    } catch (e) {
        console.error("Remarks search error:", e);
        return {
            status: "error",
            sourcePages: [],
            route: "remarks",
            answer: `Remarks lookup failed: ${(e as Error).message}`,
        };
    }
};

export { remarksSearch };
