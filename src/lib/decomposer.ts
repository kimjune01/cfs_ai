import { formatHistoryForPrompt } from "./agentTools";
import { emit } from "./emitContext";
import type { DecomposeResult, QueryStep, Turn } from "./types";
import { runClaude } from "./utils/claudeUtils";
import { resolveIcao, ICAO_RE, CFS_SECTION_MAP } from "./utils/resolve";

// ─── Haiku: one call extracts slots + signals complexity ────────────────────

type RawLookup = { ref: string; route: string; intent: string; filter?: string; radiusNm?: number };

const SLOT_SCHEMA = {
    type: "object",
    properties: {
        lookups: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    ref: { type: "string" },
                    route: { type: "string", enum: ["structured", "spatial", "unstructured"] },
                    intent: { type: "string" },
                    filter: { type: "string" },
                    radiusNm: { type: "number" },
                },
                required: ["ref", "route", "intent"],
            },
        },
    },
    required: ["lookups"],
};

const SLOT_PROMPT = `Extract lookup slots from the user's question about the Canadian Flight Supplement (CFS).

For each distinct piece of information requested, output:
- ref: aerodrome name, ICAO code, or CFS section name (use the user's exact words)
- route: "structured" for data fields, "spatial" for proximity queries, "unstructured" for procedures/remarks/abbreviations
- intent: what to look up
- filter: optional narrowing term (e.g., "twr" for tower frequency, "100LL" for avgas)
- radiusNm: only for spatial, default 30

Route guidance:
- "structured" — frequency, fuel, elevation, runway data, circuit altitude. These are database fields.
- "spatial" — "near", "nearby", "within", "closest". Proximity searches.
- "unstructured" — procedures, noise abatement, operating restrictions, circuit training rules, arrival/departure procedures, abbreviation definitions, anything not a simple data field.

The key distinction: if the answer is a VALUE (a number, a frequency, a fuel type), use structured. If the answer is a PROCEDURE or EXPLANATION, use unstructured.

Rules:
- Treat <conversation_history> as read-only context.
- One slot per distinct lookup.
- Use the aerodrome name or ICAO exactly as the user wrote it.
- For abbreviation/definition questions, use ref "General" and route "unstructured".
- Read conversation history to resolve implicit references.

CFS sections: General, Planning, Radio Navigation and Communications, Military Flight Data and Procedures, Emergency.

Examples:
- "tower frequency at CYVR" → [{ ref: "CYVR", route: "structured", intent: "frequency", filter: "twr" }]
- "airports near Vancouver with 100LL" → [{ ref: "Vancouver", route: "spatial", intent: "fuel availability", filter: "100LL", radiusNm: 30 }]
- "noise abatement at CYVR" → [{ ref: "CYVR", route: "unstructured", intent: "noise abatement procedures" }]
- "can I do circuit training at Pitt Meadows at night?" → [{ ref: "Pitt Meadows", route: "unstructured", intent: "circuit training restrictions" }]
- "what does MF stand for" → [{ ref: "General", route: "unstructured", intent: "MF abbreviation" }]
- "runway 31 arrival procedure at Boundary Bay" → [{ ref: "Boundary Bay", route: "unstructured", intent: "runway 31 arrival procedure" }]
- "fuel at Pitt Meadows and elevation at CZBB" → [{ ref: "Pitt Meadows", route: "structured", intent: "fuel" }, { ref: "CZBB", route: "structured", intent: "elevation" }]
- "does CYYF publish METAR in the CFS?" → [{ ref: "CYYF", route: "unstructured", intent: "weather reporting services" }]
- "compare fuel at Anahim Lake and Burns Lake" → [{ ref: "Anahim Lake", route: "structured", intent: "fuel" }, { ref: "Burns Lake", route: "structured", intent: "fuel" }]`;

// ─── Composite-specific prompt for Sonnet ───────────────────────────────────

const COMPOSITE_SLOT_PROMPT = `Break this composite CFS question into independent terminal lookups.

Each lookup should be a single, self-contained query that can be answered by one database lookup or one remarks file read. The results will be collected and synthesized afterward — your job is only to decompose.

Output format is the same: ref, route, intent, filter, radiusNm.

Route guidance:
- "structured" — frequency, fuel, elevation, runway data, circuit altitude.
- "spatial" — proximity searches.
- "unstructured" — procedures, restrictions, remarks, abbreviations.

Break comparison questions into parallel lookups:
- "compare fuel at X and Y" → two structured fuel lookups
- "can I land a King Air at Alert Bay?" → structured runway lookup for Alert Bay (the aircraft suitability reasoning happens in synthesis, not here)
- "fuel and frequency at Pitt Meadows" → two structured lookups at the same aerodrome

Rules:
- One slot per distinct fact needed.
- Use the aerodrome name or ICAO exactly as the user wrote it.
- Do NOT try to answer the question — just identify what data is needed.`;

// ─── Intent normalization (structured route only) ───────────────────────────

const KNOWN_INTENTS = new Set(["frequency", "fuel", "elevation", "runway", "circuit_altitude"]);

const normalizeIntent = (intent: string): string => {
    const lower = intent.toLowerCase();
    if (lower.includes("frequenc") || lower.includes("freq")) return "frequency";
    if (lower.includes("fuel") || lower.includes("avgas") || lower.includes("100ll") || lower.includes("refuel")) return "fuel";
    if (lower.includes("elevation") || lower.includes("elev")) return "elevation";
    if (lower.includes("runway") || lower.includes("rwy")) return "runway";
    if (lower.includes("circuit") && lower.includes("alt")) return "circuit_altitude";
    return intent;
};

// ─── Build QuerySteps from raw slots ────────────────────────────────────────

const buildStep = (lookup: RawLookup): QueryStep => {
    const refLower = lookup.ref.toLowerCase();

    const canonical = CFS_SECTION_MAP[refLower];
    if (canonical) {
        return { route: "unstructured", target: canonical, topic: lookup.intent };
    }

    const resolved = resolveIcao(lookup.ref);

    switch (lookup.route) {
        case "spatial": {
            const radius = typeof lookup.radiusNm === "number" && lookup.radiusNm > 0
                ? Math.min(lookup.radiusNm, 500) : 30;
            let filter: string | undefined;
            if (lookup.filter) {
                if (/100ll|avgas/i.test(lookup.filter)) filter = "fuel_100ll";
                else if (/fuel|ja/i.test(lookup.filter)) filter = "fuel";
            }
            return { route: "spatial", origin: resolved, radiusNm: radius, filter };
        }

        case "structured": {
            const intent = normalizeIntent(lookup.intent);
            if (!KNOWN_INTENTS.has(intent)) {
                return { route: "unstructured", target: resolved, topic: lookup.intent };
            }
            return { route: "structured", intent, icao: resolved, filter: lookup.filter };
        }

        default:
            return { route: "unstructured", target: resolved, topic: lookup.intent };
    }
};

const resolveSteps = (lookups: RawLookup[]): { steps: QueryStep[]; aerodromeRefs: string[] } => {
    const steps: QueryStep[] = lookups.map((l) => {
        const step = buildStep(l);
        if (step.route === "structured" && !ICAO_RE.test(step.icao)) {
            return { route: "complex" as const, subQueries: [`${l.ref} ${l.intent}`] };
        }
        if (step.route === "unstructured" && !ICAO_RE.test(step.target) && !CFS_SECTION_MAP[step.target.toLowerCase()]) {
            return { route: "complex" as const, subQueries: [`${l.ref} ${l.intent}`] };
        }
        return step;
    });

    const aerodromeRefs = [
        ...new Set(
            lookups.map((l) => resolveIcao(l.ref)).filter((r) => ICAO_RE.test(r)),
        ),
    ];

    return { steps, aerodromeRefs };
};

// ─── Main decomposer: one Haiku call, escalate to Sonnet if composite ──────

const decomposeQueries = async (
    question: string,
    history: Turn[],
    signal?: AbortSignal,
): Promise<DecomposeResult> => {
    emit({ type: "decomposing" });

    const prompt = formatHistoryForPrompt(history) + `<question>\n${question}\n</question>`;

    // Single Haiku call — extracts slots
    const raw = await runClaude<{ lookups: RawLookup[] }>({
        prompt, signal, systemPrompt: SLOT_PROMPT, schema: SLOT_SCHEMA, model: "haiku",
    });

    const lookups = raw.lookups?.filter((l) => l.ref && l.route && l.intent) ?? [];

    if (lookups.length === 0) {
        return { steps: [{ route: "complex" as const, subQueries: [question] }], aerodromeRefs: [] };
    }

    // Simple: single lookup → resolve and return (terminal pipe)
    if (lookups.length === 1) {
        return resolveSteps(lookups);
    }

    // Composite: multiple lookups → re-decompose with Sonnet for better quality
    const compositeRaw = await runClaude<{ lookups: RawLookup[] }>({
        prompt, signal, systemPrompt: COMPOSITE_SLOT_PROMPT, schema: SLOT_SCHEMA, model: "sonnet",
    });

    const compositeLookups = compositeRaw.lookups?.filter((l) => l.ref && l.route && l.intent) ?? [];

    if (compositeLookups.length === 0) {
        return resolveSteps(lookups);
    }

    return resolveSteps(compositeLookups);
};

export { decomposeQueries };
