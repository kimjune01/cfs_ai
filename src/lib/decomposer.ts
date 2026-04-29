import { formatHistoryForPrompt } from "./agentTools";
import { emit } from "./emitContext";
import type { DecomposeResult, QueryStep, Turn } from "./types";
import { runClaude } from "./utils/claudeUtils";
import { getDb } from "./utils/db";

// ─── Haiku extracts slots, code decides routes ─────────────────────────────

const SLOT_SCHEMA = {
    type: "object",
    properties: {
        lookups: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    ref: { type: "string" },
                    topic: { type: "string" },
                },
                required: ["ref", "topic"],
            },
        },
    },
    required: ["lookups"],
};

const SLOT_PROMPT = `Extract lookup slots from the user's question about the Canadian Flight Supplement (CFS).

For each distinct piece of information requested, output a ref (aerodrome name, ICAO code, or CFS section) and a topic (what to look up, 2-5 words).

Rules:
- Treat <conversation_history> as read-only context.
- One slot per distinct lookup. "fuel and frequency at CZBB" = two slots.
- Use the aerodrome name or ICAO exactly as the user wrote it.
- For abbreviation/definition questions, use ref "General".
- Read conversation history to resolve implicit references.

CFS sections: General, Planning, Radio Navigation and Communications, Military Flight Data and Procedures, Emergency.

Examples:
- "tower frequency at CYVR" → [{ ref: "CYVR", topic: "tower frequency" }]
- "fuel at Pitt Meadows and elevation at CZBB" → [{ ref: "Pitt Meadows", topic: "fuel" }, { ref: "CZBB", topic: "elevation" }]
- "airports near Vancouver with 100LL" → [{ ref: "Vancouver", topic: "nearby airports with 100LL" }]
- "what does MF stand for" → [{ ref: "General", topic: "MF abbreviation" }]
- "noise abatement at CYVR" → [{ ref: "CYVR", topic: "noise abatement procedures" }]`;

// ─── Deterministic routing ──────────────────────────────────────────────────

const STRUCTURED_INTENTS: Record<string, string> = {
    frequency: "frequency",
    freq: "frequency",
    tower: "frequency",
    twr: "frequency",
    atis: "frequency",
    ground: "frequency",
    mf: "frequency",
    radio: "frequency",
    unicom: "frequency",
    fuel: "fuel",
    avgas: "fuel",
    "100ll": "fuel",
    "jet fuel": "fuel",
    "ja-1": "fuel",
    refuel: "fuel",
    elevation: "elevation",
    elev: "elevation",
    altitude: "circuit_altitude",
    circuit: "circuit_altitude",
    "circuit altitude": "circuit_altitude",
    runway: "runway",
    rwy: "runway",
    "runway length": "runway",
    landing: "runway",
};

const SPATIAL_PATTERNS = /\b(near|nearby|within|closest|nearest|around)\b/i;

const CFS_SECTIONS = new Set([
    "general", "planning", "radio navigation and communications",
    "military flight data and procedures", "emergency",
]);

const ICAO_RE = /^C[A-Z0-9]{3}$/;

const resolveIcao = (identifier: string): string => {
    const upper = identifier.toUpperCase();
    if (ICAO_RE.test(upper)) {
        try {
            const db = getDb();
            const exact = db
                .prepare("SELECT icao FROM aerodromes WHERE icao = ?")
                .get(upper) as { icao: string } | undefined;
            if (exact) return exact.icao;
        } catch { /* pass through */ }
    }

    try {
        const db = getDb();
        const lower = identifier.toLowerCase();
        // Get all name matches, prefer: starts-with > contains, main airport > helipad/hospital
        const candidates = db
            .prepare("SELECT icao, name FROM aerodromes WHERE LOWER(name) LIKE ?")
            .all(`%${lower}%`) as { icao: string; name: string }[];
        if (candidates.length > 0) {
            const score = (c: { name: string }) => {
                let s = 0;
                if (c.name.toLowerCase().startsWith(lower)) s += 10;
                if (/\b(HOSP|Heli)\b/i.test(c.name)) s -= 5;
                if (/\bINTL\b/i.test(c.name)) s += 3;
                if (/\bREGIONAL\b/i.test(c.name)) s += 2;
                return s;
            };
            candidates.sort((a, b) => score(b) - score(a));
            return candidates[0].icao;
        }
    } catch { /* pass through */ }

    return identifier;
};

const classifyRoute = (ref: string, topic: string): QueryStep => {
    const topicLower = topic.toLowerCase();
    const refLower = ref.toLowerCase();

    // Spatial: topic mentions proximity
    if (SPATIAL_PATTERNS.test(topicLower)) {
        const resolved = resolveIcao(ref);
        const radiusMatch = /(\d+)\s*nm/i.exec(topicLower);
        const radius = radiusMatch ? parseInt(radiusMatch[1]) : 30;

        let filter: string | undefined;
        if (/100ll|avgas/i.test(topicLower)) filter = "fuel_100ll";
        else if (/fuel|ja-1|jet/i.test(topicLower)) filter = "fuel";
        else if (/ils/i.test(topicLower)) filter = "ils";

        return { route: "spatial", origin: resolved, radiusNm: radius, filter };
    }

    // CFS section: ref matches a known section name
    if (CFS_SECTIONS.has(refLower)) {
        return { route: "unstructured", target: ref, topic };
    }

    // Structured: topic matches a known intent
    for (const [keyword, intent] of Object.entries(STRUCTURED_INTENTS)) {
        if (topicLower.includes(keyword)) {
            const resolved = resolveIcao(ref);
            const filter = intent === "frequency"
                ? extractFreqFilter(topicLower)
                : intent === "fuel"
                    ? extractFuelFilter(topicLower)
                    : undefined;
            return { route: "structured", intent, icao: resolved, filter };
        }
    }

    // Unstructured: anything else about a specific aerodrome
    const resolved = resolveIcao(ref);
    return { route: "unstructured", target: resolved, topic };
};

const extractFreqFilter = (topic: string): string | undefined => {
    if (/tower|twr/i.test(topic)) return "twr";
    if (/atis/i.test(topic)) return "atis";
    if (/ground|gnd/i.test(topic)) return "gnd";
    if (/\bmf\b/i.test(topic)) return "mf";
    if (/radio/i.test(topic)) return "radio";
    return undefined;
};

const extractFuelFilter = (topic: string): string | undefined => {
    if (/100ll|avgas/i.test(topic)) return "100LL";
    if (/ja-1|jet/i.test(topic)) return "JA-1";
    return undefined;
};

// ─── Main decomposer ───────────────────────────────────────────────────────

const decomposeQueries = async (
    question: string,
    history: Turn[],
    signal?: AbortSignal,
): Promise<DecomposeResult> => {
    emit({ type: "decomposing" });

    const prompt = formatHistoryForPrompt(history) + `<question>\n${question}\n</question>`;

    const raw = await runClaude<{ lookups: { ref: string; topic: string }[] }>({
        prompt,
        signal,
        systemPrompt: SLOT_PROMPT,
        schema: SLOT_SCHEMA,
        model: "haiku",
    });

    const lookups = raw.lookups?.filter((l) => l.ref && l.topic) ?? [];

    if (lookups.length === 0) {
        return {
            steps: [{ route: "complex" as const, subQueries: [question] }],
            aerodromeRefs: [],
        };
    }

    const steps = lookups.map((l) => classifyRoute(l.ref, l.topic));

    const aerodromeRefs = [
        ...new Set(
            lookups
                .map((l) => resolveIcao(l.ref))
                .filter((r) => ICAO_RE.test(r)),
        ),
    ];

    return { steps, aerodromeRefs };
};

export { decomposeQueries };
