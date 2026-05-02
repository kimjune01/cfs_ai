import type { LayerResult, SpatialStep } from "./types";
import { getDb } from "./utils/db";
import { resolveIcao } from "./utils/resolve";

const EARTH_NM = 3440.065; // Earth radius in nautical miles

const haversineNm = (
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
): number => {
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * EARTH_NM * Math.asin(Math.sqrt(a));
};

type AerodromeRow = {
    icao: string;
    name: string;
    lat: number | null;
    lon: number | null;
    source_page: number | null;
};

const resolveOrigin = (
    origin: string,
): { icao: string; lat: number; lon: number } | null => {
    const icao = resolveIcao(origin);
    const db = getDb();
    const row = db
        .prepare("SELECT icao, lat, lon FROM aerodromes WHERE icao = ?")
        .get(icao) as { icao: string; lat: number | null; lon: number | null } | undefined;

    if (row?.lat != null && row.lon != null) {
        return { icao: row.icao, lat: row.lat, lon: row.lon };
    }

    return null;
};

type NearbyResult = {
    icao: string;
    name: string;
    distanceNm: number;
    sourcePage: number | null;
};

const MAX_NEAREST = 10;

const findNearby = (step: SpatialStep): LayerResult => {
    const hasExplicitRadius = Number.isFinite(step.radiusNm) && (step.radiusNm as number) > 0;
    const radiusNm = hasExplicitRadius ? Math.min(step.radiusNm as number, 500) : Infinity;

    try {
        const db = getDb();

        const resolved = resolveOrigin(step.origin);
        if (!resolved) {
            return { status: "empty", sourcePages: [], route: "spatial" };
        }

        const allAerodromes = db
            .prepare("SELECT icao, name, lat, lon, source_page FROM aerodromes WHERE lat IS NOT NULL AND lon IS NOT NULL")
            .all() as AerodromeRow[];

        let nearby: NearbyResult[] = allAerodromes
            .filter((a) => a.lat !== null && a.lon !== null)
            .map((a) => ({
                icao: a.icao,
                name: a.name,
                distanceNm: a.icao === resolved.icao
                    ? 0
                    : haversineNm(resolved.lat, resolved.lon, a.lat!, a.lon!),
                sourcePage: a.source_page,
            }))
            .filter((a) => a.distanceNm <= radiusNm)
            .sort((a, b) => a.distanceNm - b.distanceNm);

        let fuelByIcao: Map<string, string[]> | undefined;

        if (step.filter) {
            const filter = step.filter.toLowerCase();
            if (filter.startsWith("fuel_")) {
                const isAny = filter === "fuel_any";
                const fuelRows = isAny
                    ? db.prepare("SELECT icao, fuel_type, availability FROM fuel").all() as { icao: string; fuel_type: string; availability: string | null }[]
                    : db.prepare("SELECT icao, fuel_type, availability FROM fuel WHERE LOWER(fuel_type) LIKE ?")
                        .all(`%${filter.replace("fuel_", "").replace("ll", "LL").toLowerCase()}%`) as { icao: string; fuel_type: string; availability: string | null }[];

                const icaosWithFuel = new Set(fuelRows.map((r) => r.icao));
                nearby = nearby.filter((a) => icaosWithFuel.has(a.icao));

                fuelByIcao = new Map();
                for (const r of fuelRows) {
                    const parts = [r.fuel_type];
                    if (r.availability) parts.push(`(${r.availability})`);
                    const existing = fuelByIcao.get(r.icao) ?? [];
                    existing.push(parts.join(" "));
                    fuelByIcao.set(r.icao, existing);
                }
            }
        }

        if (!hasExplicitRadius) {
            nearby = nearby.slice(0, MAX_NEAREST);
        }

        if (nearby.length === 0) {
            return { status: "empty", sourcePages: [], route: "spatial" };
        }

        const sourcePages = [
            ...new Set(
                nearby
                    .map((a) => a.sourcePage)
                    .filter((p): p is number => p !== null),
            ),
        ];

        const answer = nearby
            .map((a) => {
                let line = `${a.icao} (${a.name}) — ${a.distanceNm.toFixed(1)} NM`;
                const fuel = fuelByIcao?.get(a.icao);
                if (fuel) line += ` — ${fuel.join(", ")}`;
                return line;
            })
            .join("\n");

        return { status: "hit", answer, sourcePages, route: "spatial" };
    } catch (e) {
        console.error("Spatial search error:", e);
        return {
            status: "error",
            sourcePages: [],
            route: "spatial",
            answer: `Database error: ${(e as Error).message}`,
        };
    }
};

export { findNearby };
