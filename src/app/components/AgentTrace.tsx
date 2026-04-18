"use client";

import type { TraceEvent } from "../../lib/types";

function eventLabel(event: TraceEvent): string {
  switch (event.type) {
    case "thinking":
      return "Thinking";
    case "rephrasing":
      return "Rephrasing query for vector search";
    case "clarification":
      return `Query: "${event.question}"`;
    case "high_effort":
      return `High-effort mode · ${event.reason}`;
    case "vector_search":
      return `VSR "${event.query}"`;
    case "vector_results":
      return `${event.count} chunks found · top score ${event.topScore.toFixed(3)}`;
    case "vision_search":
      return `VIS ${event.terms.join(", ")}`;
    case "vision_render":
      return `RND pages ${event.pages.join(", ")}`;
    case "synthesize":
      return "Synthesizing answer";
    case "done":
      return `Complete · ${event.sourcePages.length} source page${event.sourcePages.length !== 1 ? "s" : ""}`;
    case "error":
      return `ERR: ${event.message}`;
  }
}

type Props = {
  events: TraceEvent[];
};

export default function AgentTrace({ events }: Props) {
  const visible = events.filter((e) => e.type !== "done");
  if (visible.length === 0) return null;

  return (
    <details className="group" style={{ fontSize: "11px", marginTop: "4px" }}>
      <summary
        className="cursor-pointer select-none flex items-center gap-2 list-none py-1"
        style={{ color: "var(--text-dim)" }}
      >
        <span
          className="group-open:rotate-90 transition-transform inline-block"
          style={{ lineHeight: 1 }}
        >
          ›
        </span>
        <span className="tracking-widest uppercase" style={{ letterSpacing: "0.14em" }}>
          Trace · {visible.length} step{visible.length !== 1 ? "s" : ""}
        </span>
      </summary>

      <ol className="mt-1.5 space-y-0.5 pl-3" style={{ borderLeft: "1px solid var(--border)" }}>
        {visible.map((event, i) => (
          <li
            key={i}
            className="flex items-start gap-3 py-0.5"
            style={{
              color: event.type === "error" ? "var(--accent-amber)" : "var(--text-muted)",
            }}
          >
            <span
              className="shrink-0 font-mono text-[10px] pt-px tabular-nums"
              style={{ color: "var(--accent-cyan)", opacity: 0.45, minWidth: "18px" }}
            >
              {String(i + 1).padStart(2, "0")}
            </span>
            <span className="font-mono leading-relaxed">{eventLabel(event)}</span>
          </li>
        ))}
      </ol>
    </details>
  );
}
