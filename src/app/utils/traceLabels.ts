"use client";

import type { TraceEvent } from "../../lib/types";

// Live status strings — shown inline while the request is in flight
const traceLabel = (event: TraceEvent): string => {
  switch (event.type) {
    case "evaluating":
      return "Evaluating question…";
    case "rephrasing":
      return "Rephrasing query for vector search…";
    case "clarification":
      return "Asking for clarification…";
    case "vector_search":
      return `Searching: "${event.query}"…`;
    case "vector_results":
      return `Found ${event.count} results (confidence: ${event.topScore})`;
    case "vision_search":
      return `Locating pages for ${event.terms.join(", ")}…`;
    case "vision_render":
      return `Rendering CFS pages ${event.pages.join(", ")} — almost there…`;
    case "decision":
      return event.action === "answer"
        ? "Vector results sufficient — answering…"
        : "Vector confidence low — escalating to vision…";
    case "synthesize":
      return "Synthesizing answer…";
    case "done":
      return "Done";
    case "error":
      return `Error: ${event.message}`;
  }
};

// Compact log strings — shown in the collapsible trace panel
const eventLabel = (event: TraceEvent): string => {
  switch (event.type) {
    case "evaluating":
      return "Evaluating question";
    case "rephrasing":
      return "Rephrasing query for vector search";
    case "clarification":
      return `Query: "${event.question}"`;
    case "vector_search":
      return `VSR "${event.query}"`;
    case "vector_results":
      return `${event.count} chunks found · top score ${event.topScore.toFixed(3)}`;
    case "vision_search":
      return `VIS ${event.terms.join(", ")}`;
    case "vision_render":
      return `RND pages ${event.pages.join(", ")}`;
    case "decision":
      return event.action === "answer"
        ? "Decision: answer from vector"
        : "Decision: escalate to vision";
    case "synthesize":
      return "Synthesizing answer";
    case "done":
      return `Complete · ${event.sourcePages.length} source page${event.sourcePages.length !== 1 ? "s" : ""}`;
    case "error":
      return `ERR: ${event.message}`;
  }
};

export { traceLabel, eventLabel };
