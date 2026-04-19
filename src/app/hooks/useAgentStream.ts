"use client";

import { useCallback, useRef, useState } from "react";

import type { TraceEvent, Turn } from "../../lib/types";
import { traceLabel } from "../utils/traceLabels";

type StreamState = {
  loading: boolean;
  liveStatus: string;
};

const useAgentStream = () => {
  const abortRef = useRef<AbortController | null>(null);
  const [state, setState] = useState<StreamState>({ loading: false, liveStatus: "" });

  const send = async (
    question: string,
    history: Turn[],
  ): Promise<{ answer: string; sourcePages: number[]; traceEvents: TraceEvent[] }> => {
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
  };

  const abort = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return { state, send, abort };
};

export { useAgentStream };
