import { truncateHistory } from "./agentTools";
import { decomposeQueries } from "./decomposer";
import { emit, runWithEmit } from "./emitContext";
import { evaluate } from "./evaluator";
import { fanOutSearch } from "./fanOut";
import { COMBINE_SYSTEM_PROMPT } from "./prompts";
import { remarksSearch } from "./remarksSearch";
import { findNearby } from "./spatialSearch";
import { executeIntent } from "./structuredSearch";
import { synthesize } from "./synthesizer";
import type {
    AgentResult,
    ComplexStep,
    EmitFn,
    LayerResult,
    QueryStep,
    SpatialStep,
    StructuredStep,
    Turn,
    UnstructuredStep,
} from "./types";
import { runClaude } from "./utils/claudeUtils";
import { visionSearch } from "./visionSearch";

// ─── Per-step routing with fallback chains ──────────────────────────────────

const vectorVisionFallback = async (
    question: string,
    aerodromeRefs: string[],
    history: Turn[],
    signal?: AbortSignal,
): Promise<LayerResult> => {
    // Vector search + synthesize
    const queries = aerodromeRefs.length > 0 ? aerodromeRefs.map((r) => `${r} ${question}`) : [question];
    const chunks = await fanOutSearch(queries, signal);
    const synthesis = await synthesize(question, history, chunks, signal);

    if (synthesis.quality === "good") {
        return {
            status: "hit",
            answer: synthesis.answer,
            sourcePages: synthesis.sourcePages,
            route: "vector",
        };
    }

    // Vision fallback
    const visionTerms = aerodromeRefs.length > 0 ? aerodromeRefs : [question];
    const vision = await visionSearch(visionTerms, question, signal);

    if (vision.sourcePages.length > 0) {
        return {
            status: "hit",
            answer: vision.answer,
            sourcePages: vision.sourcePages,
            route: "vision",
        };
    }

    return { status: "empty", sourcePages: [], route: "vision" };
};

const routeStructured = async (
    step: StructuredStep,
    question: string,
    aerodromeRefs: string[],
    history: Turn[],
    signal?: AbortSignal,
): Promise<{ result: LayerResult; tools: AgentResult["toolsCalled"] }> => {
    emit({ type: "structured_query", intent: step.intent, icao: step.icao });
    const result = executeIntent(step);
    emit({ type: "layer_result", route: "structured", status: result.status });

    if (result.status === "hit") {
        return { result, tools: ["structured"] };
    }

    // Fallback to remarks
    emit({ type: "remarks_lookup", target: step.icao });
    const remarks = await remarksSearch(step.icao, `${step.intent} ${step.filter ?? ""}`.trim(), signal);
    emit({ type: "layer_result", route: "remarks", status: remarks.status });

    if (remarks.status === "hit") {
        return { result: remarks, tools: ["structured", "remarks"] };
    }

    // Fallback to vector+vision
    const fallback = await vectorVisionFallback(question, aerodromeRefs, history, signal);
    const tools: AgentResult["toolsCalled"] = ["structured", "remarks"];
    if (fallback.route === "vector" || fallback.route === "vision") {
        tools.push(fallback.route as "vector" | "vision");
    }
    return { result: fallback, tools };
};

const routeSpatial = async (
    step: SpatialStep,
    question: string,
    aerodromeRefs: string[],
    history: Turn[],
    signal?: AbortSignal,
): Promise<{ result: LayerResult; tools: AgentResult["toolsCalled"] }> => {
    emit({ type: "spatial_query", origin: step.origin, radiusNm: step.radiusNm });
    const result = findNearby(step);
    emit({ type: "layer_result", route: "spatial", status: result.status });

    if (result.status === "hit") {
        return { result, tools: ["spatial"] };
    }

    // Fallback to vector+vision
    const fallback = await vectorVisionFallback(question, aerodromeRefs, history, signal);
    const tools: AgentResult["toolsCalled"] = ["spatial"];
    if (fallback.route === "vector" || fallback.route === "vision") {
        tools.push(fallback.route as "vector" | "vision");
    }
    return { result: fallback, tools };
};

const routeUnstructured = async (
    step: UnstructuredStep,
    question: string,
    aerodromeRefs: string[],
    history: Turn[],
    signal?: AbortSignal,
): Promise<{ result: LayerResult; tools: AgentResult["toolsCalled"] }> => {
    emit({ type: "remarks_lookup", target: step.target });
    const result = await remarksSearch(step.target, step.topic, signal);
    emit({ type: "layer_result", route: "remarks", status: result.status });

    if (result.status === "hit") {
        return { result, tools: ["remarks"] };
    }

    // Fallback to vector+vision
    const fallback = await vectorVisionFallback(question, aerodromeRefs, history, signal);
    const tools: AgentResult["toolsCalled"] = ["remarks"];
    if (fallback.route === "vector" || fallback.route === "vision") {
        tools.push(fallback.route as "vector" | "vision");
    }
    return { result: fallback, tools };
};

const routeComplex = async (
    step: ComplexStep,
    question: string,
    history: Turn[],
    signal?: AbortSignal,
): Promise<{ result: LayerResult; tools: AgentResult["toolsCalled"] }> => {
    const chunks = await fanOutSearch(step.subQueries, signal);
    const synthesis = await synthesize(question, history, chunks, signal);

    if (synthesis.quality === "good") {
        return {
            result: {
                status: "hit",
                answer: synthesis.answer,
                sourcePages: synthesis.sourcePages,
                route: "complex",
            },
            tools: ["vector"],
        };
    }

    // Vision fallback
    const vision = await visionSearch(step.subQueries, question, signal);
    return {
        result: {
            status: vision.sourcePages.length > 0 ? "hit" : "empty",
            answer: vision.answer,
            sourcePages: vision.sourcePages,
            route: "complex",
        },
        tools: ["vector", "vision"],
    };
};

const routeStep = async (
    step: QueryStep,
    question: string,
    aerodromeRefs: string[],
    history: Turn[],
    signal?: AbortSignal,
): Promise<{ result: LayerResult; tools: AgentResult["toolsCalled"] }> => {
    switch (step.route) {
        case "structured":
            return routeStructured(step, question, aerodromeRefs, history, signal);
        case "spatial":
            return routeSpatial(step, question, aerodromeRefs, history, signal);
        case "unstructured":
            return routeUnstructured(step, question, aerodromeRefs, history, signal);
        case "complex":
            return routeComplex(step, question, history, signal);
    }
};

// ─── Main agent loop ────────────────────────────────────────────────────────

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

        // Phase 2: Decompose into routed steps
        const { steps, aerodromeRefs } = await decomposeQueries(question, truncated, signal);
        emit({ type: "route_plan", steps });

        // Phase 3: Route each step
        const stepResults: { result: LayerResult; tools: AgentResult["toolsCalled"] }[] = [];
        for (const step of steps) {
            const outcome = await routeStep(step, question, aerodromeRefs, truncated, signal);
            stepResults.push(outcome);
        }

        // Collect tools and source pages
        const allTools = new Set<AgentResult["toolsCalled"][number]>();
        const allSourcePages = new Set<number>();
        const hitAnswers: string[] = [];

        for (const { result, tools } of stepResults) {
            for (const t of tools) allTools.add(t);
            for (const p of result.sourcePages) allSourcePages.add(p);
            if (result.status === "hit" && result.answer) {
                hitAnswers.push(result.answer);
            }
        }

        const sourcePages = [...allSourcePages].sort((a, b) => a - b);
        const toolsCalled = [...allTools] as AgentResult["toolsCalled"];
        const searchTerms = steps.flatMap((s) => {
            switch (s.route) {
                case "structured":
                    return [`${s.icao} ${s.intent}`];
                case "spatial":
                    return [`${s.origin} nearby`];
                case "unstructured":
                    return [`${s.target} ${s.topic}`];
                case "complex":
                    return s.subQueries;
            }
        });

        // Phase 4: Combine results
        let answer: string;

        if (hitAnswers.length === 0) {
            answer = "Not found in CFS. The requested information could not be located in the Canadian Flight Supplement data available.";
        } else if (hitAnswers.length === 1) {
            answer = hitAnswers[0];
        } else {
            // Multiple hits — combine with Haiku
            const combinePrompt =
                `<question>\n${question}\n</question>\n\n` +
                hitAnswers
                    .map((a, i) => `<result_${i + 1}>\n${a}\n</result_${i + 1}>`)
                    .join("\n\n") +
                `\n\nCombine the above results into a single coherent answer. Source pages: ${sourcePages.join(", ")}`;

            try {
                answer = await runClaude({
                    prompt: combinePrompt,
                    signal,
                    systemPrompt: COMBINE_SYSTEM_PROMPT,
                    model: "haiku",
                });
            } catch {
                // If combining fails, just concatenate
                answer = hitAnswers.join("\n\n---\n\n");
            }
        }

        emit({ type: "done", answer, sourcePages });
        return { answer, sourcePages, searchTerms, toolsCalled };
    }, emitFn);

export { runAgentLoop };
