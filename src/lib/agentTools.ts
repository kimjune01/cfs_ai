import type { Turn, VectorChunk } from "./types";

const MAX_HISTORY_TURNS = 10;

const truncateHistory = (history: Turn[]): Turn[] => history.slice(-MAX_HISTORY_TURNS);

const formatHistoryForPrompt = (history: Turn[]): string => {
    if (history.length === 0) return "";
    return (
        "Prior conversation:\n" +
        history.map((t) => `${t.role === "user" ? "User" : "Assistant"}: ${t.content}`).join("\n") +
        "\n\n"
    );
};

const deduplicateChunks = (results: { chunks: VectorChunk[] }[]): VectorChunk[] => {
    const seen = new Map<string, VectorChunk>();
    for (const result of results) {
        for (const chunk of result.chunks) {
            const existing = seen.get(chunk.text);
            if (!existing || chunk.score > existing.score) seen.set(chunk.text, chunk);
        }
    }
    return [...seen.values()].sort((a, b) => b.score - a.score);
};

export { deduplicateChunks, formatHistoryForPrompt, truncateHistory };
