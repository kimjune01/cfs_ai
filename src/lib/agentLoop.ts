import {
    buildDecisionPrompt,
    deduplicateChunks,
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

const runVectorSearch = async (
    question: string,
    icaos: string[],
    signal?: AbortSignal,
): Promise<{ queries: string[]; chunks: VectorChunk[] }> => {
    emit({ type: "rephrasing" });
    const queries = await rephraseMultipleQueries(question, icaos, signal);
    const results = await Promise.all(queries.map((q) => vectorSearch(q, signal)));
    const chunks = deduplicateChunks(results);
    const topScore = Math.max(0, ...results.map((r) => r.topScore));
    emit({ type: "vector_results", count: chunks.length, topScore });
    return { queries, chunks };
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

        const icaos = extractICAOCodes(gate.resolvedQuestion);
        const { queries, chunks } = await runVectorSearch(gate.resolvedQuestion, icaos, signal);
        const decision = await runDecision(gate.resolvedQuestion, truncated, chunks, signal);

        if (decision.action === "answer") {
            emit({ type: "done", answer: decision.text, sourcePages: decision.pages });
            return {
                answer: decision.text,
                sourcePages: decision.pages,
                searchTerms: queries,
                toolsCalled: ["vector"],
            };
        }

        const vision = await runVisionSearch(gate.resolvedQuestion, icaos, signal);
        emit({ type: "done", answer: vision.answer, sourcePages: vision.sourcePages });
        return {
            answer: vision.answer,
            sourcePages: vision.sourcePages,
            searchTerms: [...queries, ...icaos],
            toolsCalled: ["vector", "vision"],
        };
    }, emitFn);

export { runAgentLoop };
