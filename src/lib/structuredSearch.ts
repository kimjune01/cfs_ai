import type { Statement } from "better-sqlite3";

import type { LayerResult, StructuredStep } from "./types";
import { getDb } from "./utils/db";

type IntentFn = (icao: string, filter?: string) => Statement;

const FREQ_ALIASES: Record<string, string> = {
    tower: "twr",
    ground: "gnd",
    "mandatory frequency": "mf",
    traffic: "tfc",
    clearance: "clnc",
    approach: "app",
    departure: "dep",
    arrival: "arr",
    terminal: "trml",
};

const normalizeFreqFilter = (filter: string): string => {
    const lower = filter.toLowerCase();
    return FREQ_ALIASES[lower] ?? lower;
};

const INTENT_QUERIES: Record<string, IntentFn> = {
    frequency: (icao, filter) => {
        const db = getDb();
        if (!filter) {
            return db
                .prepare(
                    "SELECT service, frequency_mhz, hours, notes, source_page FROM frequencies WHERE icao = ?",
                )
                .bind(icao);
        }
        const normalized = normalizeFreqFilter(filter);
        return db
            .prepare(
                "SELECT service, frequency_mhz, hours, notes, source_page FROM frequencies WHERE icao = ? AND LOWER(service) LIKE ?",
            )
            .bind(icao, `%${normalized}%`);
    },

    fuel: (icao, filter) => {
        const db = getDb();
        return filter
            ? db
                  .prepare(
                      "SELECT fuel_type, availability, source_page FROM fuel WHERE icao = ? AND LOWER(fuel_type) LIKE ?",
                  )
                  .bind(icao, `%${filter.toLowerCase()}%`)
            : db
                  .prepare("SELECT fuel_type, availability, source_page FROM fuel WHERE icao = ?")
                  .bind(icao);
    },

    circuit_altitude: (icao) =>
        getDb()
            .prepare(
                "SELECT circuit_altitude_ft, source_page FROM aerodromes WHERE icao = ?",
            )
            .bind(icao),

    elevation: (icao) =>
        getDb()
            .prepare("SELECT elevation_ft, source_page FROM aerodromes WHERE icao = ?")
            .bind(icao),

    runway: (icao) =>
        getDb()
            .prepare(
                "SELECT designator, length_ft, surface, circuit_direction, source_page FROM runways WHERE icao = ?",
            )
            .bind(icao),
};

const formatRows = (intent: string, rows: Record<string, unknown>[]): string => {
    if (rows.length === 0) return "";

    switch (intent) {
        case "frequency":
            return rows
                .map((r) => {
                    const parts = [`${r.service}: ${r.frequency_mhz} MHz`];
                    if (r.hours) parts.push(`(${r.hours})`);
                    if (r.notes) parts.push(`— ${r.notes}`);
                    return parts.join(" ");
                })
                .join("\n");

        case "fuel":
            return rows
                .map((r) => {
                    const parts = [String(r.fuel_type)];
                    if (r.availability) parts.push(`(${r.availability})`);
                    return parts.join(" ");
                })
                .join(", ");

        case "circuit_altitude":
            return rows
                .map((r) =>
                    r.circuit_altitude_ft != null
                        ? `Circuit altitude: ${r.circuit_altitude_ft} ft ASL`
                        : "Circuit altitude: not published",
                )
                .join("\n");

        case "elevation":
            return rows
                .map((r) =>
                    r.elevation_ft != null
                        ? `Elevation: ${r.elevation_ft} ft`
                        : "Elevation: not published",
                )
                .join("\n");

        case "runway":
            return rows
                .map((r) => {
                    const parts = [`Runway ${r.designator}`];
                    if (r.length_ft) parts.push(`${r.length_ft} ft`);
                    if (r.surface) parts.push(String(r.surface));
                    if (r.circuit_direction) parts.push(`circuit: ${r.circuit_direction}`);
                    return parts.join(", ");
                })
                .join("\n");

        default:
            return JSON.stringify(rows);
    }
};

const executeIntent = (step: StructuredStep): LayerResult => {
    const queryFn = INTENT_QUERIES[step.intent];
    if (!queryFn) {
        return { status: "empty", sourcePages: [], route: "structured" };
    }

    try {
        const icao = step.icao.toUpperCase();
        const stmt = queryFn(icao, step.filter);
        const rows = stmt.all() as Record<string, unknown>[];

        if (rows.length === 0 && step.filter && step.intent === "frequency") {
            const allFreqs = INTENT_QUERIES.frequency(icao).all() as Record<string, unknown>[];
            if (allFreqs.length > 0) {
                const sourcePages = allFreqs
                    .map((r) => r.source_page as number | null)
                    .filter((p): p is number => p != null);
                const available = formatRows("frequency", allFreqs);
                return {
                    status: "hit",
                    answer: `No ${step.filter?.toUpperCase() ?? "matching"} frequency. Available frequencies:\n${available}`,
                    sourcePages: [...new Set(sourcePages)],
                    route: "structured",
                };
            }
        }

        if (rows.length === 0 && step.filter && step.intent === "fuel") {
            const allFuel = INTENT_QUERIES.fuel(icao).all() as Record<string, unknown>[];
            if (allFuel.length > 0) {
                const available = allFuel.map((r) => String(r.fuel_type)).join(", ");
                const sourcePages = allFuel
                    .map((r) => r.source_page as number | null)
                    .filter((p): p is number => p != null);
                return {
                    status: "hit",
                    answer: `${step.filter} is not available. Available fuel: ${available}`,
                    sourcePages: [...new Set(sourcePages)],
                    route: "structured",
                };
            }
        }

        if (rows.length === 0) {
            return { status: "empty", sourcePages: [], route: "structured" };
        }

        const sourcePages = [
            ...new Set(
                rows
                    .map((r) => r.source_page as number | null)
                    .filter((p): p is number => p !== null && p !== undefined),
            ),
        ];

        const answer = formatRows(step.intent, rows);

        if (answer.includes("not published")) {
            return { status: "empty", sourcePages, route: "structured" };
        }

        return { status: "hit", answer, sourcePages, route: "structured" };
    } catch (e) {
        console.error("Structured search error:", e);
        return {
            status: "error",
            sourcePages: [],
            route: "structured",
            answer: `Database error: ${(e as Error).message}`,
        };
    }
};

export { executeIntent };
