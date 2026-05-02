import { getDb } from "./db";

const ICAO_RE = /^C[A-Z0-9]{3}$/;

const CFS_SECTION_MAP: Record<string, string> = {
    general: "General",
    planning: "Planning",
    "radio navigation and communications": "Radio Navigation and Communications",
    "military flight data and procedures": "Military Flight Data and Procedures",
    emergency: "Emergency",
};

const STRIP_SUFFIXES = /\s+(?:airport|aerodrome|airfield|airstrip|a\/d|intl|international|regional|municipal)\s*$/i;

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

    const stripped = identifier.replace(STRIP_SUFFIXES, "");
    const variants = stripped !== identifier ? [identifier, stripped] : [identifier];

    try {
        const db = getDb();
        for (const variant of variants) {
            const lower = variant.toLowerCase();
            const candidates = db
                .prepare("SELECT icao, name FROM aerodromes WHERE LOWER(name) LIKE ?")
                .all(`%${lower}%`) as { icao: string; name: string }[];
            if (candidates.length > 0) {
                const score = (c: { name: string }) => {
                    let s = 0;
                    const nameLower = c.name.toLowerCase();
                    if (nameLower === lower) s += 20;
                    else if (nameLower.startsWith(lower)) s += 10;
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
        }
    } catch { /* pass through */ }

    return identifier;
};

export { resolveIcao, ICAO_RE, CFS_SECTION_MAP };
