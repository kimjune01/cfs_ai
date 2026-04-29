import { formatHistoryForPrompt } from "./agentTools";
import { emit } from "./emitContext";
import type { DecomposeResult, QueryStep, Turn } from "./types";
import { runClaude } from "./utils/claudeUtils";
import { getDb } from "./utils/db";

// ─── Haiku extracts structured slots — route, ref, intent, filter ──────────

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
- "does CYYF publish METAR in the CFS?" → [{ ref: "CYYF", route: "unstructured", intent: "weather reporting services" }]`;

// ─── Name resolution ────────────────────────────────────────────────────────

const ICAO_RE = /^C[A-Z0-9]{3}$/;

const CFS_SECTION_MAP: Record<string, string> = {
    general: "General",
    planning: "Planning",
    "radio navigation and communications": "Radio Navigation and Communications",
    "military flight data and procedures": "Military Flight Data and Procedures",
    emergency: "Emergency",
};

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
        const candidates = db
            .prepare("SELECT icao, name FROM aerodromes WHERE LOWER(name) LIKE ?")
            .all(`%${lower}%`) as { icao: string; name: string }[];
        if (candidates.length > 0) {
            const score = (c: { name: string }) => {
                let s = 0;
                if (c.name.toLowerCase().startsWith(lower)) s += 10;
                if (/\b(HOSP|HOSPITAL|HELIPORT|HELI|HELICOPTERS)\b/i.test(c.name)) s -= 5;
                if (/\(Heli\)/i.test(c.name)) s -= 5;
                if (/\bINTL\b/i.test(c.name)) s += 3;
                if (/\bREGIONAL\b/i.test(c.name)) s += 2;
                if (/\bMUNICIPAL\b/i.test(c.name)) s += 1;
                return s;
            };
            candidates.sort((a, b) => score(b) - score(a));
            return candidates[0].icao;
        }
    } catch { /* pass through */ }

    return identifier;
};

// ─── Intent → DB intent mapping (only for structured route) ─────────────────

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

// ─── Build QuerySteps from Haiku slots ──────────────────────────────────────

const buildStep = (lookup: { ref: string; route: string; intent: string; filter?: string; radiusNm?: number }): QueryStep => {
    const refLower = lookup.ref.toLowerCase();

    // CFS section → unstructured with canonical name
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

// ─── Main decomposer ───────────────────────────────────────────────────────

const decomposeQueries = async (
    question: string,
    history: Turn[],
    signal?: AbortSignal,
): Promise<DecomposeResult> => {
    emit({ type: "decomposing" });

    const prompt = formatHistoryForPrompt(history) + `<question>\n${question}\n</question>`;

    const raw = await runClaude<{ lookups: { ref: string; route: string; intent: string; filter?: string; radiusNm?: number }[] }>({
        prompt,
        signal,
        systemPrompt: SLOT_PROMPT,
        schema: SLOT_SCHEMA,
        model: "haiku",
    });

    const lookups = raw.lookups?.filter((l) => l.ref && l.route && l.intent) ?? [];

    if (lookups.length === 0) {
        return {
            steps: [{ route: "complex" as const, subQueries: [question] }],
            aerodromeRefs: [],
        };
    }

    const steps: QueryStep[] = lookups.map((l) => {
        const step = buildStep(l);
        // Validate resolved refs — unresolved fall back to complex
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
            lookups
                .map((l) => resolveIcao(l.ref))
                .filter((r) => ICAO_RE.test(r)),
        ),
    ];

    return { steps, aerodromeRefs };
};

export { decomposeQueries };
