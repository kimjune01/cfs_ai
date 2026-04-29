/**
 * Deterministic CFS parser — no LLM, no hallucination, no cost.
 *
 * Parses data/parsed_llama_preprocessed.md into data/cfs.db using regex.
 * Every field is extracted from labeled CFS text patterns.
 *
 * Usage: npx tsx scripts/build/parseCfs.ts
 */

import Database from "better-sqlite3";
import { existsSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";

const DATA_DIR = join(process.cwd(), "data");
const INPUT_PATH = join(DATA_DIR, "parsed_llama_preprocessed.md");
const DB_PATH = process.env.CFS_DB_PATH ?? join(DATA_DIR, "cfs.db");

// ─── Section splitting ─────────────────────────────────────────────────────

type Section = { lines: string[]; sourcePage: number; icao: string };

const splitSections = (markdown: string): Section[] => {
    const sections = new Map<string, Section>();
    const order: string[] = [];
    const lines = markdown.split("\n");
    let currentIcao = "";
    let currentPage = 0;

    for (const line of lines) {
        const pm = /<!--\s*page:(\d+)\s*-->/.exec(line);
        if (pm) { currentPage = parseInt(pm[1], 10); continue; }

        const contd = /cont'?d/i.test(line) ? /\b(C[A-Z0-9]{3})\s*$/.exec(line) : null;
        if (contd) { currentIcao = contd[1]; }

        const header = !contd ? (
            /\bBC\b.*\b(C[A-Z0-9]{3})\s*$/.exec(line)
            ?? /^#+\s*(C[A-Z0-9]{3})\b/.exec(line)
        ) : null;

        if (header) {
            currentIcao = header[1];
            if (!sections.has(currentIcao)) {
                sections.set(currentIcao, { lines: [], sourcePage: currentPage, icao: currentIcao });
                order.push(currentIcao);
            }
        }

        if (currentIcao && sections.has(currentIcao)) {
            sections.get(currentIcao)!.lines.push(line);
        } else if (currentIcao && !sections.has(currentIcao)) {
            sections.set(currentIcao, { lines: [line], sourcePage: currentPage, icao: currentIcao });
            order.push(currentIcao);
        }
    }

    return order.map((icao) => sections.get(icao)!);
};

// ─── Field extractors ───────────────────────────────────────────────────────

const extractName = (lines: string[]): string => {
    for (const line of lines) {
        const m = /^(.+?)\s+BC\b/.exec(line.trim());
        if (m && !/cont'?d/i.test(line)) return m[1].trim();
    }
    return "";
};

const extractCoords = (lines: string[]): { lat: number; lon: number } | null => {
    const text = lines.join("\n");
    const m = /N(\d{2})\s+(\d{2})\s+(\d{2})\s+W(\d{2,3})\s+(\d{2})\s+(\d{2})/.exec(text);
    if (!m) return null;
    const lat = parseInt(m[1]) + parseInt(m[2]) / 60 + parseInt(m[3]) / 3600;
    const lon = -(parseInt(m[4]) + parseInt(m[5]) / 60 + parseInt(m[6]) / 3600);
    return { lat: Math.round(lat * 100000) / 100000, lon: Math.round(lon * 100000) / 100000 };
};

const extractElevation = (lines: string[]): number | null => {
    const text = lines.join("\n");
    const m = /Elev\s+(\d+)[''´]/.exec(text);
    return m ? parseInt(m[1]) : null;
};

const extractCircuitAltitude = (lines: string[]): number | null => {
    const text = lines.join("\n");
    const m = /[Cc]ircuit\s+(?:hgt|alt(?:itude)?)\s+(\d+)\s*(?:ASL|')/i.exec(text);
    return m ? parseInt(m[1]) : null;
};

type Runway = { designator: string; length_ft: number | null; surface: string | null; circuit_direction: string | null };

const extractRunways = (lines: string[]): Runway[] => {
    const runways: Runway[] = [];
    const text = lines.join("\n");

    // Rwy 16(165°)/34(345°) 6000x149 ASPH
    const rwyRe = /Rwy\s+([\d/]+)(?:\([^)]*\))?(?:\/(\d+)(?:\([^)]*\))?)?\s+(\d+)x\d+\s+(\w+)/gi;
    let m;
    while ((m = rwyRe.exec(text)) !== null) {
        const designator = m[2] ? `${m[1]}/${m[2]}` : m[1];
        runways.push({
            designator,
            length_ft: parseInt(m[3]),
            surface: m[4],
            circuit_direction: null,
        });
    }

    // HELI DATA FATO/TLOF patterns
    const heliRe = /(?:FATO|TLOF)\s+(\d+)[''´]?\s*(?:x\s*(\d+)[''´]?)?\s*(?:dia\s+)?(\w+)?/gi;
    while ((m = heliRe.exec(text)) !== null) {
        runways.push({
            designator: "H",
            length_ft: parseInt(m[1]),
            surface: m[3] ?? null,
            circuit_direction: null,
        });
    }

    // Circuit direction: "Rgt hand circuits Rwy 34" or "Right hand circuit Rwy 01"
    const circuitRe = /(?:Rgt|Right)\s+hand\s+circuits?\s+Rwy\s+(\d+)/gi;
    while ((m = circuitRe.exec(text)) !== null) {
        const rwyNum = m[1];
        for (const rwy of runways) {
            if (rwy.designator.includes(rwyNum)) {
                rwy.circuit_direction = "right";
            }
        }
    }

    return runways;
};

type Frequency = { service: string; frequency_mhz: number; hours: string | null; notes: string | null };

const extractFrequencies = (lines: string[]): Frequency[] => {
    const freqs: Frequency[] = [];
    const text = lines.join("\n");

    // Match patterns in COMM section:
    // TWR Abbotsford 119.4 (inner) 121.0 (outer) 15-07Z‡
    // MF rdo 118.5 5NM 4100 ASL
    // ATF tfc 122.8 2NM 1600 ASL
    // ATIS 119.8 15-07Z‡
    // GND 121.9
    // RADIO 118.5 PTC avbl (V)
    // GND ADV 121.9

    const commSection = text.match(/COMM[\s\S]*?(?=(?:^[A-Z]{3,}(?:\s|$)|\n<!-- page:))/m)?.[0] ?? "";
    const allText = commSection || text;

    // Generic frequency pattern: SERVICE_LABEL ... FREQ_MHZ
    const serviceLabels = [
        "TWR", "MF", "ATF", "ATIS", "GND ADV", "GND", "RADIO", "RCO",
        "CLNC DEL", "DEP", "ARR", "TML", "APP", "PAD CONTROL",
        "UNICOM", "A/G",
    ];

    for (const label of serviceLabels) {
        const escaped = label.replace(/[/]/g, "\\/");
        // Match the label followed by any text containing a frequency
        const re = new RegExp(`${escaped}\\b([^\\n]*\\d{2,3}\\.\\d{1,3}[^\\n]*)`, "gi");
        let m;
        while ((m = re.exec(allText)) !== null) {
            const rest = m[1];
            // Extract all frequencies from this line
            const freqRe = /(\d{2,3}\.\d{1,3})/g;
            let fm;
            while ((fm = freqRe.exec(rest)) !== null) {
                const freq = parseFloat(fm[1]);
                if (freq < 100 || freq > 400) continue;

                // Extract hours pattern like 15-07Z or 1630-0230Z
                const hoursMatch = /(\d{2,4}-\d{2,4}Z[‡†]?)/.exec(rest);

                // Get context around this frequency for notes
                const afterFreq = rest.slice(fm.index + fm[0].length, fm.index + fm[0].length + 60).trim();
                const noteMatch = /^\s*(?:\(([^)]+)\)|(\w[^,\d]*))/.exec(afterFreq);
                const notes = noteMatch?.[1] ?? noteMatch?.[2]?.trim() ?? null;

                freqs.push({
                    service: label,
                    frequency_mhz: freq,
                    hours: hoursMatch?.[1] ?? null,
                    notes: notes && notes.length > 2 ? notes : null,
                });
            }
        }
    }

    return freqs;
};

type Fuel = { fuel_type: string; availability: string | null };

const extractFuel = (lines: string[]): Fuel[] => {
    const fuels: Fuel[] = [];
    const text = lines.join("\n");

    const fuelMatch = /FUEL\s+(.+)/i.exec(text);
    if (!fuelMatch) return fuels;

    const fuelLine = fuelMatch[1];

    const types = ["100LL", "MG-1", "Jet A-1", "JA-1", "Jet A", "Jet B", "JA"];
    const matched = new Set<string>();
    for (const type of types) {
        if (!fuelLine.includes(type)) continue;
        if (type === "JA" && (matched.has("JA-1") || matched.has("Jet A") || matched.has("Jet A-1"))) continue;
        if (type === "Jet A" && matched.has("Jet A-1")) continue;
        matched.add(type);
        {
            // Get everything after the fuel type mention for availability
            const afterType = fuelLine.slice(fuelLine.indexOf(type) + type.length);
            // Availability is usually the scheduling/access info
            const availMatch = /^\s*[,;]?\s*(.+?)(?=(?:100LL|MG-1|JA-1|JA\b|Jet|$))/i.exec(afterType);
            let availability = availMatch?.[1]?.trim() ?? null;
            if (availability && /^[,;]\s*$/.test(availability)) availability = null;

            fuels.push({ fuel_type: type, availability });
        }
    }

    return fuels;
};

// ─── Database ───────────────────────────────────────────────────────────────

const createDatabase = (db: Database.Database): void => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS aerodromes (
            icao TEXT PRIMARY KEY, name TEXT NOT NULL, lat REAL, lon REAL,
            elevation_ft INTEGER, circuit_altitude_ft INTEGER, source_page INTEGER
        );
        CREATE TABLE IF NOT EXISTS runways (
            icao TEXT NOT NULL, designator TEXT NOT NULL, length_ft INTEGER,
            surface TEXT, circuit_direction TEXT, source_page INTEGER
        );
        CREATE TABLE IF NOT EXISTS frequencies (
            icao TEXT NOT NULL, service TEXT NOT NULL, frequency_mhz REAL NOT NULL,
            hours TEXT, notes TEXT, source_page INTEGER
        );
        CREATE TABLE IF NOT EXISTS fuel (
            icao TEXT NOT NULL, fuel_type TEXT NOT NULL, availability TEXT, source_page INTEGER
        );
    `);
};

// ─── Main ───────────────────────────────────────────────────────────────────

const main = () => {
    if (!existsSync(INPUT_PATH)) {
        console.error(`Input not found: ${INPUT_PATH}`);
        process.exit(1);
    }

    mkdirSync(DATA_DIR, { recursive: true });

    const markdown = readFileSync(INPUT_PATH, "utf-8");
    const sections = splitSections(markdown);

    console.log(`Parsed ${sections.length} aerodrome sections`);

    const db = new Database(DB_PATH);
    createDatabase(db);

    const insertAerodrome = db.prepare(
        "INSERT OR REPLACE INTO aerodromes (icao, name, lat, lon, elevation_ft, circuit_altitude_ft, source_page) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    const deleteRunways = db.prepare("DELETE FROM runways WHERE icao = ?");
    const deleteFreqs = db.prepare("DELETE FROM frequencies WHERE icao = ?");
    const deleteFuel = db.prepare("DELETE FROM fuel WHERE icao = ?");
    const insertRunway = db.prepare("INSERT INTO runways VALUES (?, ?, ?, ?, ?, ?)");
    const insertFreq = db.prepare("INSERT INTO frequencies VALUES (?, ?, ?, ?, ?, ?)");
    const insertFuel = db.prepare("INSERT INTO fuel VALUES (?, ?, ?, ?)");

    let aerodromes = 0;
    let totalFreqs = 0;
    let totalFuel = 0;
    let totalRunways = 0;

    const insertAll = db.transaction((section: Section) => {
        const { icao, lines, sourcePage } = section;
        const name = extractName(lines);
        const coords = extractCoords(lines);
        const elevation = extractElevation(lines);
        const circuitAlt = extractCircuitAltitude(lines);
        const runways = extractRunways(lines);
        const frequencies = extractFrequencies(lines);
        const fuel = extractFuel(lines);

        deleteRunways.run(icao);
        deleteFreqs.run(icao);
        deleteFuel.run(icao);

        insertAerodrome.run(icao, name || icao, coords?.lat ?? null, coords?.lon ?? null, elevation, circuitAlt, sourcePage);

        for (const r of runways) insertRunway.run(icao, r.designator, r.length_ft, r.surface, r.circuit_direction, sourcePage);
        for (const f of frequencies) insertFreq.run(icao, f.service, f.frequency_mhz, f.hours, f.notes, sourcePage);
        for (const f of fuel) insertFuel.run(icao, f.fuel_type, f.availability, sourcePage);

        aerodromes++;
        totalFreqs += frequencies.length;
        totalFuel += fuel.length;
        totalRunways += runways.length;
    });

    for (const section of sections) {
        insertAll(section);
    }

    db.close();

    console.log(`Done: ${aerodromes} aerodromes, ${totalFreqs} frequencies, ${totalFuel} fuel, ${totalRunways} runways`);
    console.log(`Written to ${DB_PATH}`);
};

main();
