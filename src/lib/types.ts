type Turn = {
  role: "user" | "assistant";
  content: string;
  pagesFound?: number[];
};

type TraceEvent =
  | { type: "evaluating" } // 1. evaluator runs
  | { type: "clarification"; questions: string[] } // 1a. evaluator needs more info
  | { type: "rephrasing" } // 2. query rewriting
  | { type: "vector_search"; query: string } // 3. one per rephrase query
  | { type: "vector_results"; count: number; topScore: number } // 3a. results back
  | { type: "deciding" } // 4. decision prompt running
  | { type: "decision"; action: "answer" | "vision" } // 4a. verdict
  | { type: "vision_search"; terms: string[] } // 5. vision path: locating pages
  | { type: "vision_reading"; pages: number[] } // 5a. vision path: reading pages
  | { type: "synthesize" } // 6. composing final answer
  | { type: "done"; answer: string; sourcePages: number[] } // 7. complete
  | { type: "error"; message: string }; // any stage

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

export type { AgentResult, EmitFn, TraceEvent, Turn, VectorChunk };
