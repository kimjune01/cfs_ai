"use client";

import type { TraceEvent } from "../../lib/types";
import { traceLabel } from "../utils/traceLabels";

type Props = { events: TraceEvent[] };

const AgentTrace = ({ events }: Props) => {
    const visible = events.filter((e) => e.type !== "done");
    if (visible.length === 0) return null;

    return (
        <details className="agent-trace group">
            <summary className="trace-summary cursor-pointer select-none flex items-center gap-2 list-none py-1">
                <span className="trace-toggle-icon group-open:rotate-90 transition-transform inline-block">
                    ›
                </span>
                <span className="trace-label tracking-widest uppercase">
                    Trace · {visible.length} step{visible.length !== 1 ? "s" : ""}
                </span>
            </summary>

            <ol className="trace-list mt-1.5 space-y-0.5 pl-3">
                {visible.map((event, i) => (
                    <li
                        key={i}
                        className={`flex items-start gap-3 py-0.5 ${event.type === "error" ? "trace-item-error" : "trace-item"}`}
                    >
                        <span className="trace-step-num shrink-0 font-mono text-[10px] pt-px tabular-nums">
                            {String(i + 1).padStart(2, "0")}
                        </span>
                        <span className="font-mono leading-relaxed">{traceLabel(event)}</span>
                    </li>
                ))}
            </ol>
        </details>
    );
};

export default AgentTrace;
