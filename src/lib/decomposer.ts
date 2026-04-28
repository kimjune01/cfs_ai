import { formatHistoryForPrompt } from "./agentTools";
import { emit } from "./emitContext";
import { QUERY_DECOMPOSER_SYSTEM_PROMPT } from "./prompts";
import { DECOMPOSER_V2_SCHEMA } from "./schemas";
import type { DecomposeResult, QueryStep, Turn } from "./types";
import { runClaude } from "./utils/claudeUtils";
import { getDb } from "./utils/db";

const ICAO_RE = /^C[A-Z0-9]{3}$/;

const resolveIcao = (identifier: string): string => {
    if (ICAO_RE.test(identifier.toUpperCase())) {
        try {
            const db = getDb();
            const exact = db
                .prepare("SELECT icao FROM aerodromes WHERE icao = ?")
                .get(identifier.toUpperCase()) as { icao: string } | undefined;
            if (exact) return exact.icao;
        } catch { /* DB not available, pass through */ }
    }

    try {
        const db = getDb();
        const byName = db
            .prepare("SELECT icao FROM aerodromes WHERE LOWER(name) LIKE ?")
            .get(`%${identifier.toLowerCase()}%`) as { icao: string } | undefined;
        if (byName) return byName.icao;
    } catch { /* DB not available */ }

    return identifier;
};

const decomposeQueries = async (
    question: string,
    history: Turn[],
    signal?: AbortSignal,
): Promise<DecomposeResult> => {
    emit({ type: "decomposing" });

    const prompt = formatHistoryForPrompt(history) + `<question>\n${question}\n</question>`;

    const raw = await runClaude<{ steps: QueryStep[]; aerodromeRefs: string[] }>({
        prompt,
        signal,
        systemPrompt: QUERY_DECOMPOSER_SYSTEM_PROMPT,
        schema: DECOMPOSER_V2_SCHEMA,
        model: "haiku",
    });

    const validSteps: QueryStep[] = [];
    for (const step of raw.steps ?? []) {
        switch (step.route) {
            case "structured":
                if (step.intent && step.icao) validSteps.push(step);
                break;
            case "spatial":
                if (step.origin && typeof step.radiusNm === "number" && step.radiusNm > 0)
                    validSteps.push(step);
                break;
            case "unstructured":
                if (step.target && step.topic) validSteps.push(step);
                break;
            case "complex":
                if (step.subQueries && step.subQueries.length > 0) validSteps.push(step);
                break;
        }
    }

    const resolvedSteps: QueryStep[] = (
        validSteps.length > 0
            ? validSteps
            : [{ route: "complex" as const, subQueries: [question] }]
    ).map((step) => {
        switch (step.route) {
            case "structured":
                return { ...step, icao: resolveIcao(step.icao) };
            case "spatial":
                return { ...step, origin: resolveIcao(step.origin) };
            case "unstructured":
                return { ...step, target: resolveIcao(step.target) };
            default:
                return step;
        }
    });

    const resolvedRefs = (raw.aerodromeRefs ?? []).map(resolveIcao);

    return { steps: resolvedSteps, aerodromeRefs: resolvedRefs };
};

export { decomposeQueries };
