import type { LayerResult, SpatialStep } from "./types";
import { getDb } from "./utils/db";

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
    const db = getDb();
    const byIcao = db
        .prepare("SELECT icao, lat, lon FROM aerodromes WHERE icao = ?")
        .get(origin.toUpperCase()) as { icao: string; lat: number | null; lon: number | null } | undefined;

    if (byIcao?.lat != null && byIcao.lon != null) {
        return { icao: byIcao.icao, lat: byIcao.lat, lon: byIcao.lon };
    }

    const byName = db
        .prepare("SELECT icao, lat, lon FROM aerodromes WHERE LOWER(name) LIKE ?")
        .get(`%${origin.toLowerCase()}%`) as
        | { icao: string; lat: number | null; lon: number | null }
        | undefined;

    if (byName?.lat != null && byName.lon != null) {
        return { icao: byName.icao, lat: byName.lat, lon: byName.lon };
    }

    return null;
};

type NearbyResult = {
    icao: string;
    name: string;
    distanceNm: number;
    sourcePage: number | null;
};

const findNearby = (step: SpatialStep): LayerResult => {
    const radiusNm = Number.isFinite(step.radiusNm) && step.radiusNm > 0
        ? Math.min(step.radiusNm, 500)
        : 30;

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
            .filter((a) => a.icao !== resolved.icao && a.lat !== null && a.lon !== null)
            .map((a) => ({
                icao: a.icao,
                name: a.name,
                distanceNm: haversineNm(resolved.lat, resolved.lon, a.lat!, a.lon!),
                sourcePage: a.source_page,
            }))
            .filter((a) => a.distanceNm <= radiusNm)
            .sort((a, b) => a.distanceNm - b.distanceNm);

        // Apply filter if set
        if (step.filter) {
            const filter = step.filter.toLowerCase();
            if (filter.startsWith("fuel_")) {
                const fuelType = filter.replace("fuel_", "").replace("ll", "LL");
                const icaosWithFuel = new Set(
                    (
                        db
                            .prepare(
                                "SELECT DISTINCT icao FROM fuel WHERE LOWER(fuel_type) LIKE ?",
                            )
                            .all(`%${fuelType.toLowerCase()}%`) as { icao: string }[]
                    ).map((r) => r.icao),
                );
                nearby = nearby.filter((a) => icaosWithFuel.has(a.icao));
            }
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
            .map(
                (a) =>
                    `${a.icao} (${a.name}) — ${a.distanceNm.toFixed(1)} NM`,
            )
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
