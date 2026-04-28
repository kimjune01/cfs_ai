import { deduplicateChunks } from "./agentTools";
import { emit } from "./emitContext";
import type { VectorChunk } from "./types";
import { vectorSearch } from "./vectorSearch";

// Jina API allows 2 concurrent embedding requests in free tier
const JINA_CONCURRENCY = 2;

const withConcurrencyLimit = <T>(fns: Array<() => Promise<T>>, limit: number): Promise<T[]> => {
    let active = 0;
    let index = 0;
    const results = new Array(fns.length) as T[];

    return new Promise((resolve, reject) => {
        const next = () => {
            if (index === fns.length && active === 0) {
                resolve(results);
                return;
            }
            while (active < limit && index < fns.length) {
                const i = index++;
                active++;
                fns[i]()
                    .then((result) => {
                        results[i] = result;
                        active--;
                        next();
                    })
                    .catch(reject);
            }
        };
        next();
    });
};

const fanOutSearch = async (queries: string[], signal?: AbortSignal): Promise<VectorChunk[]> => {
    for (const q of queries) {
        emit({ type: "searching", query: q });
    }

    const fns = queries.map((q) => () => vectorSearch(q, signal));
    const results = await withConcurrencyLimit(fns, JINA_CONCURRENCY);
    const chunks = deduplicateChunks(results);
    emit({ type: "search_results", count: chunks.length });
    return chunks;
};

export { fanOutSearch };
