type CfsSection =
    | "GENERAL"
    | "AERODROME"
    | "PLANNING"
    | "RADIO_NAVIGATION_AND_COMMUNICATIONS"
    | "MILITARY_FLIGHT_DATA_AND_PROCEDURES"
    | "EMERGENCY";

const SECTIONS: Record<CfsSection, string> = {
    GENERAL: "General",
    AERODROME: "Aerodrome",
    PLANNING: "Planning",
    RADIO_NAVIGATION_AND_COMMUNICATIONS: "Radio Navigation and Communications",
    MILITARY_FLIGHT_DATA_AND_PROCEDURES: "Military Flight Data and Procedures",
    EMERGENCY: "Emergency",
};

type Turn = {
    role: "user" | "assistant";
    content: string;
    pagesFound?: number[];
};

type TraceEvent =
    | { type: "routing" }
    | { type: "decomposing" }
    | { type: "searching"; query: string }
    | { type: "search_results"; count: number }
    | { type: "synthesizing" }
    | { type: "vision_search"; terms: string[] }
    | { type: "vision_reading"; pages: number[] }
    | { type: "done"; answer: string; sourcePages: number[] }
    | { type: "error"; message: string };

type EmitFn = (event: TraceEvent) => void;

type VectorChunk = {
    startPage: number;
    endPage: number;
    title: string;
    text: string;
    score: number;
};

type AgentResult = {
    answer: string;
    sourcePages: number[];
    searchTerms: string[];
    toolsCalled: ("vector" | "vision")[];
};

type EvaluatorResult = {
    status: "ready" | "out_of_scope";
    reason: string;
};

type DecomposeResult = {
    queries: string[];
    aerodromeRefs: string[];
};

type SynthesizerResult =
    | { quality: "good"; answer: string; sourcePages: number[] }
    | { quality: "weak" };

export { SECTIONS };
export type {
    AgentResult,
    CfsSection,
    DecomposeResult,
    EmitFn,
    EvaluatorResult,
    SynthesizerResult,
    TraceEvent,
    Turn,
    VectorChunk,
};
