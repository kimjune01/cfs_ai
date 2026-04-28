"use client";

import type { TraceEvent } from "../../lib/types";

const traceLabel = (event: TraceEvent): string => {
    switch (event.type) {
        case "routing":
            return "Analyzing question...";
        case "decomposing":
            return "Breaking down query...";
        case "searching":
            return `Searching: "${event.query}"...`;
        case "search_results":
            return `Found ${event.count} results`;
        case "synthesizing":
            return "Composing answer...";
        case "vision_search":
            return `Locating pages for ${event.terms.join(", ")}...`;
        case "vision_reading":
            return `Reading CFS pages ${event.pages.join(", ")}...`;
        case "done":
            return "Done";
        case "error":
            return `Error: ${event.message}`;
        case "route_plan":
            return `Planned ${event.steps.length} lookup${event.steps.length === 1 ? "" : "s"}`;
        case "structured_query":
            return `Looking up ${event.intent} for ${event.icao}...`;
        case "spatial_query":
            return `Searching within ${event.radiusNm} NM of ${event.origin}...`;
        case "remarks_lookup":
            return `Reading remarks for ${event.target}...`;
        case "layer_result":
            return `${event.route}: ${event.status}`;
        case "composite_synthesis":
            return `Reasoning across ${event.factCount} facts...`;
    }
};

export { traceLabel };
