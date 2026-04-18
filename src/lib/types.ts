type Turn = {
  role: "user" | "assistant";
  content: string;
  pagesFound?: number[];
};

type TraceEvent =
  | { type: "thinking" }
  | { type: "evaluating" }
  | { type: "rephrasing" }
  | { type: "clarification"; question: string }
  | { type: "high_effort"; reason: string }
  | { type: "vector_search"; query: string }
  | { type: "vector_results"; count: number; topScore: number }
  | { type: "vision_search"; terms: string[] }
  | { type: "vision_render"; pages: number[] }
  | { type: "synthesize" }
  | { type: "done"; answer: string; sourcePages: number[] }
  | { type: "error"; message: string };

type EmitFn = (event: TraceEvent) => void;

type VectorChunk = {
  page: number;
  icao: string;
  section: string;
  text: string;
  score: number;
};

type AgentResult = {
  answer: string;
  sourcePages: number[];
  searchTerms: string[];
  toolsCalled: ("vector" | "vision")[];
};

export type { Turn, TraceEvent, EmitFn, VectorChunk, AgentResult };
