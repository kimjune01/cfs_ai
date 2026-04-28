"use client";

import type { TraceEvent } from "../../lib/types";

const traceLabel = (event: TraceEvent): string => {
    switch (event.type) {
        case "routing":
            return "Analyzing question…";
        case "decomposing":
            return "Breaking down query…";
        case "searching":
            return `Searching: "${event.query}"…`;
        case "search_results":
            return `Found ${event.count} results`;
        case "synthesizing":
            return "Composing answer…";
        case "vision_search":
            return `Locating pages for ${event.terms.join(", ")}…`;
        case "vision_reading":
            return `Reading CFS pages ${event.pages.join(", ")} — almost there…`;
        case "done":
            return "Done";
        case "error":
            return `Error: ${event.message}`;
    }
};

export { traceLabel };
