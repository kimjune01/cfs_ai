import { spawn } from "child_process";
import { join } from "path";

import { emit } from "./emitContext";
import type { VectorChunk } from "./types";
import { attachAbort } from "./utils/processUtils";

const CFS_SEARCH = join(process.cwd(), "scripts", "runtime", "cfsVectorSearch.mjs");

const vectorSearch = async (
    query: string,
    signal?: AbortSignal,
): Promise<{ chunks: VectorChunk[]; topScore: number }> => {
    emit({ type: "vector_search", query });

    const result = await new Promise<string>((resolve, reject) => {
        const proc = spawn("node", [CFS_SEARCH, query, "10", "--json"], {
            stdio: ["pipe", "pipe", "pipe"],
        });

        if (signal) attachAbort(proc, signal);

        let stdout = "";
        let stderr = "";
        proc.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
        proc.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
        proc.on("close", (code) => {
            if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
            if (code !== 0) return reject(new Error(`cfs_search failed: ${stderr.slice(0, 200)}`));
            resolve(stdout.trim());
        });
        proc.stdin.end();
    });

    let chunks: VectorChunk[] = [];
    try {
        const raw: unknown = JSON.parse(result);
        if (Array.isArray(raw)) {
            const candidates = raw as VectorChunk[];
            if (
                candidates.every(
                    (c) =>
                        typeof c.startPage === "number" &&
                        typeof c.endPage === "number" &&
                        typeof c.score === "number",
                )
            ) {
                chunks = candidates;
            }
        }
    } catch {
        // Non-JSON output means no results
    }

    const topScore = chunks.length > 0 ? Math.max(...chunks.map((c) => c.score)) : 0;
    emit({ type: "vector_results", count: chunks.length, topScore });

    return { chunks, topScore };
};

export { vectorSearch };
