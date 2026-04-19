"use client";

import { useState, useRef, useEffect } from "react";
import dynamic from "next/dynamic";
import ReactMarkdown from "react-markdown";
import { useAgentStream } from "./hooks/useAgentStream";
import AgentTrace from "./components/AgentTrace";
import type { TraceEvent, Turn } from "../lib/types";

const PDFPageViewer = dynamic(() => import("./components/PDFPageViewer"), {
  ssr: false,
});

type Message = {
  role: "user" | "assistant";
  content: string;
  sourcePages?: number[];
  traceEvents?: TraceEvent[];
};

const SAMPLE_QUERIES = [
  "What is the circuit altitude at Pitt Meadows?",
  "What frequency does Kamloops tower use?",
  "Is there fuel available at Hope?",
  "What are the operating hours at CYVR?",
  "How do I turn on runway lights at CZBB?",
  "What is Vancouver Harbour ATIS frequency?",
];

const Home = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [history, setHistory] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [inputFocused, setInputFocused] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const { state, send, abort } = useAgentStream();

  useEffect(() => () => abort(), [abort]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, state.loading]);

  const submitQuestion = async (question: string) => {
    if (state.loading) return;
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: question }]);

    const { answer, sourcePages, traceEvents } = await send(question, history);
    if (!answer) return;

    setMessages((prev) => [
      ...prev,
      { role: "assistant", content: answer, sourcePages, traceEvents },
    ]);

    setHistory((prev) =>
      [
        ...prev,
        { role: "user" as const, content: question },
        { role: "assistant" as const, content: answer, pagesFound: sourcePages },
      ].slice(-20),
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || state.loading) return;
    void submitQuestion(input.trim());
  };

  return (
    <main className="flex flex-col h-screen relative">
      {/* ── Header ── */}
      <header
        className="flex-none relative z-10"
        style={{
          background: "var(--surface)",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <div className="max-w-3xl mx-auto px-5 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span
              className="font-display text-lg font-semibold tracking-widest"
              style={{ color: "var(--accent-cyan)", letterSpacing: "0.15em" }}
            >
              CFS/AI
            </span>
            <span style={{ color: "var(--border-mid)", userSelect: "none" }}>│</span>
            <span
              className="text-xs tracking-widest uppercase"
              style={{ color: "var(--text-muted)", letterSpacing: "0.14em" }}
            >
              British Columbia
            </span>
          </div>
          <span
            className="hidden sm:block text-xs tracking-widest uppercase"
            style={{ color: "var(--text-dim)", letterSpacing: "0.12em" }}
          >
            Canadian Flight Supplement
          </span>
        </div>
        {/* cyan accent line */}
        <div
          style={{
            height: "1px",
            background:
              "linear-gradient(90deg, var(--accent-cyan) 0%, var(--accent-cyan) 15%, transparent 60%)",
            opacity: 0.35,
          }}
        />
      </header>

      {/* ── Messages ── */}
      <div className="flex-1 overflow-y-auto relative z-10">
        <div className="max-w-3xl mx-auto px-5 py-8 space-y-7">
          {/* Empty state */}
          {messages.length === 0 && !state.loading && (
            <div className="mt-10 space-y-8">
              <div className="text-center space-y-2">
                <p
                  className="text-xs tracking-widest uppercase"
                  style={{ color: "var(--text-dim)", letterSpacing: "0.18em" }}
                >
                  Query System Online
                </p>
                <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                  Ask about aerodromes, frequencies, circuits, fuel, hours &amp; more
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {SAMPLE_QUERIES.map((q) => (
                  <SampleQuery key={q} text={q} onSelect={(query) => void submitQuestion(query)} />
                ))}
              </div>
            </div>
          )}

          {/* Message list */}
          {messages.map((msg, i) => (
            <div key={i} className="msg-enter space-y-2">
              {msg.role === "user" ? (
                <UserMessage content={msg.content} />
              ) : (
                <AssistantMessage content={msg.content} />
              )}

              {msg.role === "assistant" && msg.traceEvents && (
                <div style={{ paddingLeft: "2px" }}>
                  <AgentTrace events={msg.traceEvents} />
                </div>
              )}

              {msg.sourcePages && msg.sourcePages.length > 0 && (
                <SourcePages pages={msg.sourcePages} />
              )}
            </div>
          ))}

          {/* Live loading */}
          {state.loading && (
            <div className="msg-enter">
              <div
                className="text-xs tracking-widest uppercase mb-1.5 pulse-label"
                style={{ color: "var(--accent-cyan)", letterSpacing: "0.14em" }}
              >
                CFS
              </div>
              <div
                className="px-4 py-3 rounded text-sm"
                style={{
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderLeft: "2px solid var(--accent-cyan)",
                  color: "var(--text-muted)",
                }}
              >
                <span style={{ color: "var(--accent-cyan)", marginRight: "6px" }}>▶</span>
                {state.liveStatus || "Initializing…"}
                <span className="blink" style={{ marginLeft: "2px", color: "var(--accent-cyan)" }}>
                  _
                </span>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* ── Input bar ── */}
      <div
        className="flex-none relative z-10"
        style={{
          background: "var(--surface)",
          borderTop: "1px solid var(--border)",
        }}
      >
        <div className="max-w-3xl mx-auto px-5 py-3">
          <form onSubmit={handleSubmit} className="flex gap-2 items-center">
            <div className="flex-1 relative">
              <span
                className="absolute left-3 top-1/2 -translate-y-1/2 text-xs select-none"
                style={{ color: inputFocused || input ? "var(--accent-cyan)" : "var(--text-dim)" }}
              >
                ▸
              </span>
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onFocus={() => setInputFocused(true)}
                onBlur={() => setInputFocused(false)}
                placeholder="Ask about a Canadian aerodrome…"
                disabled={state.loading}
                // eslint-disable-next-line jsx-a11y/no-autofocus
                autoFocus
                className="w-full py-2.5 text-sm focus:outline-none"
                style={{
                  background: "var(--bg)",
                  border: "1px solid",
                  borderColor: inputFocused ? "var(--accent-cyan)" : "var(--border-mid)",
                  borderRadius: "4px",
                  color: "var(--text-primary)",
                  fontFamily: "inherit",
                  paddingLeft: "28px",
                  paddingRight: "12px",
                  transition: "border-color 0.15s",
                }}
              />
            </div>

            {state.loading ? (
              <button
                type="button"
                onClick={abort}
                className="px-4 py-2.5 text-xs tracking-widest uppercase rounded"
                style={{
                  background: "transparent",
                  border: "1px solid var(--border-mid)",
                  color: "var(--text-muted)",
                  fontFamily: "inherit",
                  cursor: "pointer",
                  transition: "border-color 0.15s, color 0.15s",
                  letterSpacing: "0.14em",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "var(--accent-amber)";
                  e.currentTarget.style.color = "var(--accent-amber)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "var(--border-mid)";
                  e.currentTarget.style.color = "var(--text-muted)";
                }}
              >
                Abort
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim()}
                className="px-4 py-2.5 text-xs tracking-widest uppercase rounded"
                style={{
                  background: input.trim() ? "var(--accent-cyan)" : "transparent",
                  border: "1px solid",
                  borderColor: input.trim() ? "var(--accent-cyan)" : "var(--border-mid)",
                  color: input.trim() ? "var(--bg)" : "var(--text-dim)",
                  fontFamily: "inherit",
                  fontWeight: 500,
                  cursor: input.trim() ? "pointer" : "default",
                  transition: "all 0.15s",
                  letterSpacing: "0.14em",
                }}
              >
                Send
              </button>
            )}
          </form>
        </div>
      </div>
    </main>
  );
};

/* ── Sub-components ── */

const UserMessage = ({ content }: { content: string }) => {
  return (
    <div className="flex justify-end">
      <div style={{ maxWidth: "80%" }}>
        <div
          className="text-xs tracking-widest uppercase mb-1.5 text-right"
          style={{ color: "var(--text-dim)", letterSpacing: "0.14em" }}
        >
          Pilot
        </div>
        <div
          className="px-4 py-3 rounded text-sm whitespace-pre-wrap leading-relaxed"
          style={{
            background: "var(--surface-2)",
            border: "1px solid var(--border-mid)",
            borderRight: "2px solid var(--accent-cyan)",
            color: "var(--text-primary)",
          }}
        >
          {content}
        </div>
      </div>
    </div>
  );
};

const AssistantMessage = ({ content }: { content: string }) => {
  return (
    <div className="flex justify-start">
      <div style={{ maxWidth: "88%" }}>
        <div
          className="text-xs tracking-widest uppercase mb-1.5"
          style={{ color: "var(--accent-cyan)", letterSpacing: "0.14em" }}
        >
          CFS
        </div>
        <div
          className="px-4 py-3 rounded text-sm leading-relaxed prose-answer"
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderLeft: "2px solid var(--accent-cyan)",
            color: "var(--text-primary)",
          }}
        >
          <ReactMarkdown>{content}</ReactMarkdown>
        </div>
      </div>
    </div>
  );
};

const SourcePages = ({ pages }: { pages: number[] }) => {
  return (
    <div className="rounded overflow-hidden" style={{ border: "1px solid var(--border)" }}>
      <div
        className="px-4 py-2 flex items-center gap-2.5"
        style={{
          background: "var(--surface)",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <span style={{ color: "var(--accent-amber)" }}>◎</span>
        <span
          className="text-xs tracking-widest uppercase"
          style={{ color: "var(--text-muted)", letterSpacing: "0.12em" }}
        >
          Source · CFS {pages.length === 1 ? `pg ${pages[0]}` : `pg ${pages.join(", ")}`}
        </span>
      </div>
      {pages.map((page, i) => (
        <div key={page} style={i > 0 ? { borderTop: "1px solid var(--border)" } : {}}>
          <PDFPageViewer pageNumber={page} />
        </div>
      ))}
    </div>
  );
};

const SampleQuery = ({ text, onSelect }: { text: string; onSelect: (q: string) => void }) => {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={() => onSelect(text)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="text-left px-4 py-3 rounded text-xs transition-all duration-200"
      style={{
        background: "var(--surface)",
        border: "1px solid",
        borderColor: hovered ? "var(--accent-cyan)" : "var(--border)",
        color: hovered ? "var(--text-primary)" : "var(--text-muted)",
        fontFamily: "inherit",
        cursor: "pointer",
        transition: "border-color 0.15s, color 0.15s",
      }}
    >
      <span style={{ color: "var(--accent-cyan)", marginRight: "8px" }}>›</span>
      {text}
    </button>
  );
};

export default Home;
