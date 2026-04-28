import { formatHistoryForPrompt } from "./agentTools";
import { emit } from "./emitContext";
import { SYNTHESIZER_SYSTEM_PROMPT } from "./prompts";
import { SYNTHESIZER_SCHEMA } from "./schemas";
import type { SynthesizerResult, Turn, VectorChunk } from "./types";
import { runClaude } from "./utils/claudeUtils";

const formatVectorChunks = (chunks: VectorChunk[]): string => {
    const body = chunks
        .map((chunk) => {
            const pageLabel =
                chunk.endPage > chunk.startPage
                    ? `Pages ${chunk.startPage}–${chunk.endPage}`
                    : `Page ${chunk.startPage}`;
            const titlePart = chunk.title ? ` | ${chunk.title}` : "";
            return `[${pageLabel}${titlePart} | score=${chunk.score}]\n${chunk.text}`;
        })
        .join("\n\n---\n\n");
    return `[Vector search results]\n\n${body}`;
};

const synthesize = async (
    question: string,
    history: Turn[],
    chunks: VectorChunk[],
    signal?: AbortSignal,
): Promise<SynthesizerResult> => {
    emit({ type: "synthesizing" });

    const prompt =
        formatHistoryForPrompt(history) +
        `<question>\n${question}\n</question>\n\n` +
        formatVectorChunks(chunks);

    const raw = await runClaude<{ quality: string; answer?: string; sourcePages?: number[] }>({
        prompt,
        signal,
        systemPrompt: SYNTHESIZER_SYSTEM_PROMPT,
        schema: SYNTHESIZER_SCHEMA,
    });

    if (raw.quality === "good" && typeof raw.answer === "string" && raw.answer.length > 0) {
        return { quality: "good", answer: raw.answer, sourcePages: raw.sourcePages ?? [] };
    }
    return { quality: "weak" };
};

export { synthesize };
