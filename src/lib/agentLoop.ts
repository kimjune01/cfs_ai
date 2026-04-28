import { truncateHistory } from "./agentTools";
import { decomposeQueries } from "./decomposer";
import { emit, runWithEmit } from "./emitContext";
import { evaluate } from "./evaluator";
import { fanOutSearch } from "./fanOut";
import { synthesize } from "./synthesizer";
import type { AgentResult, EmitFn, Turn } from "./types";
import { visionSearch } from "./visionSearch";

const runAgentLoop = async (
    question: string,
    history: Turn[],
    emitFn: EmitFn,
    signal?: AbortSignal,
): Promise<AgentResult> =>
    runWithEmit(async () => {
        const truncated = truncateHistory(history);

        // Phase 1: Evaluate scope
        const evaluation = await evaluate(question, truncated, signal);
        if (evaluation.status === "out_of_scope") {
            const answer = `This question is outside the scope of this CFS tool.\n\n${evaluation.reason}`;
            emit({ type: "done", answer, sourcePages: [] });
            return { answer, sourcePages: [], searchTerms: [], toolsCalled: [] };
        }

        // Phase 2: Query decomposition
        const { queries, aerodromeRefs } = await decomposeQueries(question, truncated, signal);

        // Phase 3: Fan-out search
        const chunks = await fanOutSearch(queries, signal);

        // Phase 4: Synthesizer
        const synthesis = await synthesize(question, truncated, chunks, signal);
        if (synthesis.quality === "good") {
            emit({ type: "done", answer: synthesis.answer, sourcePages: synthesis.sourcePages });
            return {
                answer: synthesis.answer,
                sourcePages: synthesis.sourcePages,
                searchTerms: queries,
                toolsCalled: ["vector"],
            };
        }

        // Phase 5: Vision fallback
        const visionTerms = aerodromeRefs.length > 0 ? aerodromeRefs : [question];
        const vision = await visionSearch(visionTerms, question, signal);
        emit({ type: "done", answer: vision.answer, sourcePages: vision.sourcePages });
        return {
            answer: vision.answer,
            sourcePages: vision.sourcePages,
            searchTerms: [...queries, ...visionTerms],
            toolsCalled: ["vector", "vision"],
        };
    }, emitFn);

export { runAgentLoop };
