import { getDb } from "./db";

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

export { resolveIcao, ICAO_RE, CFS_SECTION_MAP };
