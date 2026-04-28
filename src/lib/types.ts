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

// ─── Query step discriminated union ─────────────────────────────────────────

type StructuredStep = { route: "structured"; intent: string; icao: string; filter?: string };
type SpatialStep = { route: "spatial"; origin: string; radiusNm: number; filter?: string };
type UnstructuredStep = { route: "unstructured"; target: string; topic: string };
type ComplexStep = { route: "complex"; subQueries: string[] };

type QueryStep = StructuredStep | SpatialStep | UnstructuredStep | ComplexStep;

// ─── Decomposer result (v2 shape) ──────────────────────────────────────────

type DecomposeResult = {
    steps: QueryStep[];
    aerodromeRefs: string[];
};

// ─── Layer result (universal return type) ───────────────────────────────────

type LayerResult = {
    status: "hit" | "empty" | "error";
    answer?: string;
    sourcePages: number[];
    route: string;
};

// ─── Trace events ───────────────────────────────────────────────────────────

type TraceEvent =
    | { type: "routing" }
    | { type: "decomposing" }
    | { type: "searching"; query: string }
    | { type: "search_results"; count: number }
    | { type: "synthesizing" }
    | { type: "vision_search"; terms: string[] }
    | { type: "vision_reading"; pages: number[] }
    | { type: "done"; answer: string; sourcePages: number[] }
    | { type: "error"; message: string }
    | { type: "route_plan"; steps: QueryStep[] }
    | { type: "structured_query"; intent: string; icao: string }
    | { type: "spatial_query"; origin: string; radiusNm: number }
    | { type: "remarks_lookup"; target: string }
    | { type: "layer_result"; route: string; status: string };

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
    toolsCalled: ("structured" | "spatial" | "remarks" | "vector" | "vision")[];
};

type EvaluatorResult = {
    status: "ready" | "out_of_scope";
    reason: string;
};

type SynthesizerResult =
    | { quality: "good"; answer: string; sourcePages: number[] }
    | { quality: "weak" };

export { SECTIONS };
export type {
    AgentResult,
    CfsSection,
    ComplexStep,
    DecomposeResult,
    EmitFn,
    EvaluatorResult,
    LayerResult,
    QueryStep,
    SpatialStep,
    StructuredStep,
    SynthesizerResult,
    TraceEvent,
    Turn,
    UnstructuredStep,
    VectorChunk,
};
