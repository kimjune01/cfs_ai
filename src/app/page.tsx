"use client";

import { useState, useRef, useEffect } from "react";
import dynamic from "next/dynamic";

const PDFPageViewer = dynamic(() => import("./components/PDFPageViewer"), {
  ssr: false,
});

type Source = { page: number; text: string };

type Message = {
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
};

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [expandedSources, setExpandedSources] = useState<Set<string>>(new Set());
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  function toggleSource(key: string) {
    setExpandedSources((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const question = input.trim();
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: question }]);
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const data = await res.json();
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: data.answer ?? data.error ?? "No response.",
          sources: data.sources,
        },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "Unable to reach the server. Please try again.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex flex-col h-screen max-w-3xl mx-auto px-4">
      {/* Header */}
      <div className="py-5 border-b border-gray-200">
        <h1 className="text-xl font-semibold text-center text-gray-900">
          CFS British Columbia Assistant
        </h1>
        <p className="text-sm text-center text-gray-500 mt-1">
          Canadian Flight Supplement · Ask about aerodromes, frequencies,
          circuits &amp; more
        </p>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto py-6 space-y-6">
        {messages.length === 0 && (
          <div className="text-center text-gray-400 mt-16 space-y-3">
            <p className="text-base">Ask a question about the CFS.</p>
            <div className="text-sm space-y-1 text-gray-400">
              <p>&ldquo;What is the circuit altitude at CYPK?&rdquo;</p>
              <p>&ldquo;What frequency does Kamloops tower use?&rdquo;</p>
              <p>&ldquo;Is there fuel available at CYHE Hope?&rdquo;</p>
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className="space-y-3">
            {/* Bubble */}
            <div className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm whitespace-pre-wrap leading-relaxed ${
                  msg.role === "user"
                    ? "bg-blue-600 text-white"
                    : "bg-gray-100 text-gray-900"
                }`}
              >
                {msg.content}
              </div>
            </div>

            {/* Source pages */}
            {msg.sources && msg.sources.length > 0 && (
              <div className="space-y-2 pl-1">
                <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">
                  Source pages
                </p>
                {msg.sources.map((src) => {
                  const key = `${i}-${src.page}`;
                  const expanded = expandedSources.has(key);
                  return (
                    <div key={key} className="border border-gray-200 rounded-xl overflow-hidden">
                      <button
                        onClick={() => toggleSource(key)}
                        className="w-full flex items-center justify-between px-4 py-2.5 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
                      >
                        <span className="font-medium">CFS Page {src.page}</span>
                        <span className="text-gray-400 text-xs">
                          {expanded ? "▲ hide" : "▼ show"}
                        </span>
                      </button>
                      {expanded && (
                        <div className="border-t border-gray-100">
                          <PDFPageViewer pageNumber={src.page} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="bg-gray-100 rounded-2xl px-4 py-3 text-sm text-gray-400 italic">
              Searching CFS…
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="py-4 border-t border-gray-200">
        <form onSubmit={sendMessage} className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about a Canadian aerodrome…"
            className="flex-1 border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            disabled={loading}
            autoFocus
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="bg-blue-600 text-white px-5 py-2.5 rounded-xl text-sm font-medium disabled:opacity-40 hover:bg-blue-700 transition-colors"
          >
            Ask
          </button>
        </form>
      </div>
    </main>
  );
}
