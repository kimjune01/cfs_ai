import { formatHistoryForPrompt } from "./agentTools";
import { emit } from "./emitContext";
import { QUERY_DECOMPOSER_SYSTEM_PROMPT } from "./prompts";
import { QUERY_DECOMPOSER_SCHEMA } from "./schemas";
import type { DecomposeResult, Turn } from "./types";
import { runClaude } from "./utils/claudeUtils";

type SubQuery = { ref: string; topic: string };

const decomposeQueries = async (
    question: string,
    history: Turn[],
    signal?: AbortSignal,
): Promise<DecomposeResult> => {
    emit({ type: "decomposing" });

    const prompt = formatHistoryForPrompt(history) + `<question>\n${question}\n</question>`;

    const { subQueries, aerodromeRefs } = await runClaude<{
        subQueries: SubQuery[];
        aerodromeRefs: string[];
    }>(prompt, signal, QUERY_DECOMPOSER_SYSTEM_PROMPT, QUERY_DECOMPOSER_SCHEMA);

    if (!subQueries || subQueries.length === 0) {
        return { queries: [question], aerodromeRefs: aerodromeRefs ?? [] };
    }

    const queries = [...new Set(subQueries.map((sq) => `${sq.ref} ${sq.topic}`.trim()))];
    return { queries, aerodromeRefs: aerodromeRefs ?? [] };
};

export { decomposeQueries };
