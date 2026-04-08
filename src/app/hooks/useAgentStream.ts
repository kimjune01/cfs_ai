"use client";

import { useRef, useState } from "react";
import type { TraceEvent, Turn } from "../../lib/types";

function traceLabel(event: TraceEvent): string {
  switch (event.type) {
    case "thinking":              return "Thinking…";
    case "rephrasing":            return "Rephrasing query for vector search…";
    case "clarification":         return "Asking for clarification…";
    case "high_effort":           return `High-effort mode — ${event.reason}`;
    case "vector_search":         return `Searching: "${event.query}"…`;
    case "vector_results":        return `Found ${event.count} results (confidence: ${event.topScore})`;
    case "vision_search":         return `Locating pages for ${event.terms.join(", ")}…`;
    case "vision_render":         return `Rendering CFS pages ${event.pages.join(", ")} — almost there…`;
    case "synthesize":            return "Synthesizing answer…";
    case "done":                  return "Done";
    case "error":                 return `Error: ${event.message}`;
  }
}

export type StreamState = {
  loading: boolean;
  liveStatus: string;
};

export function useAgentStream() {
  const abortRef = useRef<AbortController | null>(null);
  const [state, setState] = useState<StreamState>({ loading: false, liveStatus: "" });

  async function send(
    question: string,
    history: Turn[]
  ): Promise<{ answer: string; sourcePages: number[]; traceEvents: TraceEvent[] }> {
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    setState({ loading: true, liveStatus: "Starting…" });

    const traceEvents: TraceEvent[] = [];
    let answer = "";
    let sourcePages: number[] = [];

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, history }),
        signal: abortRef.current.signal,
      });

      if (!res.ok) throw new Error(`Server error ${res.status}`);

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop()!;

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line) as TraceEvent;
            traceEvents.push(event);
            if (event.type === "done") {
              answer = event.answer;
              sourcePages = event.sourcePages;
            }
            setState({ loading: true, liveStatus: traceLabel(event) });
          } catch {
            // Malformed line — skip
          }
        }
      }
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") {
        setState({ loading: false, liveStatus: "" });
        return { answer, sourcePages, traceEvents };
      }
      answer = "Unable to reach the server. Please try again.";
    }

    setState({ loading: false, liveStatus: "" });
    return { answer, sourcePages, traceEvents };
  }

  function abort() {
    abortRef.current?.abort();
  }

  return { state, send, abort };
}
