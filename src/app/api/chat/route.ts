import { NextRequest } from "next/server";
import { runAgentLoop } from "../../../lib/agentLoop";
import type { TraceEvent, Turn } from "../../../lib/types";

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const raw = body as Record<string, unknown>;
  const question = typeof raw?.question === "string" ? raw.question.trim() : "";
  const history: Turn[] = Array.isArray(raw?.history) ? (raw.history as Turn[]) : [];

  if (!question) {
    return Response.json({ error: "Question is required." }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const { signal } = request;

  const stream = new ReadableStream({
    async start(controller) {
      function emit(event: TraceEvent) {
        if (signal.aborted) return;
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      }

      try {
        await runAgentLoop(question, history, emit, signal);
      } catch (e) {
        if (signal.aborted) {
          // Client disconnected — clean exit, no error event needed
        } else {
          console.error("Agent error:", e);
          emit({ type: "error", message: "Failed to process your question." });
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-store",
    },
  });
}
