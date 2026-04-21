"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type { TraceEvent, Turn } from "../lib/types";
import AgentTrace from "./components/agentTrace";
import { useAgentStream } from "./hooks/useAgentStream";
import { useTheme } from "./hooks/useTheme";

const PDFPageViewer = dynamic(() => import("./components/pdfPageViewer"), {
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
  const bottomRef = useRef<HTMLDivElement>(null);
  const { state, send, abort } = useAgentStream();
  const { dark, toggle } = useTheme();

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
      <header className="app-header flex-none relative z-10">
        <div className="max-w-3xl mx-auto px-5 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="font-display header-title text-lg font-semibold tracking-widest">
              CFS/AI
            </span>
            <span className="header-sep">│</span>
            <span className="header-subtitle text-xs tracking-widest uppercase">
              British Columbia
            </span>
          </div>
          <div className="flex items-center gap-4">
            <span className="header-tag hidden sm:block text-xs tracking-widest uppercase">
              Canadian Flight Supplement
            </span>
            <button
              onClick={toggle}
              className="btn-theme text-xs tracking-widest uppercase px-2 py-1 rounded"
            >
              {dark ? "Light" : "Dark"}
            </button>
          </div>
        </div>
        <div className="header-accent-line" />
      </header>

      {/* ── Messages ── */}
      <div className="flex-1 overflow-y-auto relative z-10">
        <div className="max-w-3xl mx-auto px-5 py-8 space-y-7">
          {/* Empty state */}
          {messages.length === 0 && !state.loading && (
            <div className="mt-10 space-y-8">
              <div className="text-center space-y-2">
                <p className="empty-label text-xs tracking-widest uppercase">Query System Online</p>
                <p className="empty-subtitle text-sm">
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
                <div className="trace-indent">
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
              <div className="loading-label text-xs tracking-widest uppercase mb-1.5 pulse-label">
                CFS
              </div>
              <div className="loading-box px-4 py-3 rounded text-sm">
                <span className="loading-arrow">▶</span>
                {state.liveStatus || "Initializing…"}
                <span className="blink loading-cursor">_</span>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* ── Input bar ── */}
      <div className="input-bar flex-none relative z-10">
        <div className="max-w-3xl mx-auto px-5 py-3">
          <form onSubmit={handleSubmit} className="flex gap-2 items-center">
            <div className="input-wrapper">
              <span className="input-prefix">▸</span>
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask about a Canadian aerodrome…"
                disabled={state.loading}
                // eslint-disable-next-line jsx-a11y/no-autofocus
                autoFocus
                className="chat-input"
              />
            </div>
            {state.loading ? (
              <button
                type="button"
                onClick={abort}
                className="btn-abort px-4 py-2.5 text-xs tracking-widest uppercase rounded"
              >
                Abort
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim()}
                className="btn-send px-4 py-2.5 text-xs tracking-widest uppercase rounded"
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

const UserMessage = ({ content }: { content: string }) => (
  <div className="flex justify-end">
    <div className="msg-user-wrap">
      <div className="msg-label msg-label-pilot tracking-widest uppercase mb-1.5 text-right">
        Pilot
      </div>
      <div className="bubble-user px-4 py-3 rounded text-sm whitespace-pre-wrap leading-relaxed">
        {content}
      </div>
    </div>
  </div>
);

const AssistantMessage = ({ content }: { content: string }) => (
  <div className="flex justify-start">
    <div className="msg-assistant-wrap">
      <div className="msg-label msg-label-cfs tracking-widest uppercase mb-1.5">CFS</div>
      <div className="bubble-assistant px-4 py-3 rounded text-sm leading-relaxed prose-answer">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
      </div>
    </div>
  </div>
);

const SourcePages = ({ pages }: { pages: number[] }) => (
  <div className="source-pages rounded overflow-hidden">
    <div className="source-pages-header px-4 py-2 flex items-center gap-2.5">
      <span className="source-icon">◎</span>
      <span className="source-label text-xs tracking-widest uppercase">
        Source · CFS {pages.length === 1 ? `pg ${pages[0]}` : `pg ${pages.join(", ")}`}
      </span>
    </div>
    {pages.map((page, i) => (
      <div key={page} className={i > 0 ? "source-page-divider" : ""}>
        <PDFPageViewer pageNumber={page} />
      </div>
    ))}
  </div>
);

const SampleQuery = ({ text, onSelect }: { text: string; onSelect: (q: string) => void }) => (
  <button onClick={() => onSelect(text)} className="btn-sample px-4 py-3 rounded text-xs">
    <span className="btn-sample-arrow">›</span>
    {text}
  </button>
);

export default Home;
