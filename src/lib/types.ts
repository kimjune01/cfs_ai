export type Turn = {
  role: "user" | "assistant";
  content: string;
  pagesFound?: number[];
};

export type TraceEvent =
  | { type: "thinking" }
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

export type EmitFn = (event: TraceEvent) => void;

export type VectorChunk = {
  page: number;
  icao: string;
  section: string;
  text: string;
  score: number;
};

export type AgentResult = {
  answer: string;
  sourcePages: number[];
  searchTerms: string[];
  toolsCalled: ("vector" | "vision")[];
};
