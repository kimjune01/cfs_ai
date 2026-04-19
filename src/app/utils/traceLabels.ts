"use client";

import type { TraceEvent } from "../../lib/types";

const traceLabel = (event: TraceEvent): string => {
  switch (event.type) {
    case "evaluating":
      return "Evaluating question…";
    case "clarification":
      return "Asking for clarification…";
    case "rephrasing":
      return "Rephrasing query for vector search…";
    case "vector_search":
      return `Searching: "${event.query}"…`;
    case "vector_results":
      return `Found ${event.count} results (confidence: ${event.topScore})`;
    case "deciding":
      return "Evaluating whether vector results are sufficient…";
    case "decision":
      return event.action === "answer"
        ? "Vector results sufficient — answering…"
        : "Vector confidence low — escalating to vision…";
    case "vision_search":
      return `Locating pages for ${event.terms.join(", ")}…`;
    case "vision_reading":
      return `Reading CFS pages ${event.pages.join(", ")} — almost there…`;
    case "synthesize":
      return "Synthesizing answer…";
    case "done":
      return "Done";
    case "error":
      return `Error: ${event.message}`;
  }
};

export { traceLabel };
