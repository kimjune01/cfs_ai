import {
    buildDecisionPrompt,
    deduplicateChunksByPage,
    extractICAOCodes,
    rephraseMultipleQueries,
} from "./agentTools";
import { emit, runWithEmit } from "./emitContext";
import { runEvaluationGate } from "./promptEvaluator";
import { DECISION_PROMPT } from "./prompts";
import { DECISION_SCHEMA } from "./schemas";
import type { AgentResult, EmitFn, Turn, VectorChunk } from "./types";
import { runClaude } from "./utils/claudeUtils";
import { vectorSearch } from "./vectorSearch";
import { visionSearch } from "./visionSearch";

const MAX_HISTORY_TURNS = 10;

type Decision = { action: "answer"; text: string; pages: number[] } | { action: "vision" };

const truncateHistory = (history: Turn[]): Turn[] => history.slice(-MAX_HISTORY_TURNS);

type VectorSearchResult = {
    queries: string[];
    icaos: string[];
    chunks: VectorChunk[];
};

const runVectorSearch = async (
    question: string,
    signal?: AbortSignal,
): Promise<VectorSearchResult> => {
    emit({ type: "rephrasing" });
    const icaos = extractICAOCodes(question);
    const queries = await rephraseMultipleQueries(question, icaos, signal);
    const results = await Promise.all(queries.map((q) => vectorSearch(q, signal)));
    const chunks = deduplicateChunksByPage(results);
    const topScore = chunks.length > 0 ? Math.max(...chunks.map((c) => c.score)) : 0;
    emit({ type: "vector_results", count: chunks.length, topScore });
    return { queries, icaos, chunks };
};

const runDecision = async (
    question: string,
    history: Turn[],
    chunks: VectorChunk[],
    signal?: AbortSignal,
): Promise<Decision> => {
    emit({ type: "deciding" });
    const decision = await runClaude<Decision>(
        buildDecisionPrompt(history, question, chunks),
        signal,
        DECISION_PROMPT,
        DECISION_SCHEMA,
    );
    emit({ type: "decision", action: decision.action });
    if (decision.action === "answer") emit({ type: "synthesize" });
    return decision;
};

const runVisionSearch = async (
    question: string,
    icaos: string[],
    signal?: AbortSignal,
): Promise<{ answer: string; sourcePages: number[] }> => {
    const result = await visionSearch(icaos, question, signal);
    emit({ type: "synthesize" });
    return result;
};

const runAgentLoop = async (
    question: string,
    history: Turn[],
    emitFn: EmitFn,
    signal?: AbortSignal,
): Promise<AgentResult> =>
    runWithEmit(async () => {
        const truncated = truncateHistory(history);

        const gate = await runEvaluationGate(question, truncated, signal);
        if (gate.handled) return gate.result;

        const { queries, icaos, chunks } = await runVectorSearch(gate.resolvedQuestion, signal);
        const decision = await runDecision(gate.resolvedQuestion, truncated, chunks, signal);

        let result: AgentResult;
        if (decision.action === "answer") {
            result = {
                answer: decision.text,
                sourcePages: decision.pages,
                searchTerms: queries,
                toolsCalled: ["vector"],
            };
        } else {
            const vision = await runVisionSearch(gate.resolvedQuestion, icaos, signal);
            result = {
                answer: vision.answer,
                sourcePages: vision.sourcePages,
                searchTerms: [...queries, ...icaos],
                toolsCalled: ["vector", "vision"],
            };
        }

        emit({ type: "done", answer: result.answer, sourcePages: result.sourcePages });
        return result;
    }, emitFn);

export { runAgentLoop };
