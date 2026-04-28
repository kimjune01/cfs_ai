import { formatHistoryForPrompt } from "./agentTools";
import { emit } from "./emitContext";
import { QUERY_DECOMPOSER_SYSTEM_PROMPT } from "./prompts";
import { DECOMPOSER_V2_SCHEMA } from "./schemas";
import type { DecomposeResult, QueryStep, Turn } from "./types";
import { runClaude } from "./utils/claudeUtils";

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

    const steps =
        validSteps.length > 0
            ? validSteps
            : [{ route: "complex" as const, subQueries: [question] }];

    return { steps, aerodromeRefs: raw.aerodromeRefs ?? [] };
};

export { decomposeQueries };
