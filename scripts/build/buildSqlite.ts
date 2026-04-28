/**
 * Build script: parse CFS markdown into SQLite database
 *
 * Reads data/parsed_llama_preprocessed.md, extracts structured fields per
 * aerodrome via Haiku, writes to data/cfs.db with source_page provenance.
 *
 * Usage:
 *   npx tsx scripts/build/buildSqlite.ts
 */

import { spawn } from "child_process";
import Database from "better-sqlite3";
import { existsSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";

const DATA_DIR = join(process.cwd(), "data");
const INPUT_PATH = join(DATA_DIR, "parsed_llama_preprocessed.md");
const DB_PATH = join(DATA_DIR, "cfs.db");

// Strip ANTHROPIC_API_KEY so claude binary uses keychain auth
const { ANTHROPIC_API_KEY: _key, ...claudeEnv } = process.env;

const EXTRACTION_SCHEMA = {
    type: "object",
    properties: {
        icao: { type: "string" },
        name: { type: "string" },
        lat: { type: ["number", "null"] },
        lon: { type: ["number", "null"] },
        elevation_ft: { type: ["integer", "null"] },
        circuit_altitude_ft: { type: ["integer", "null"] },
        runways: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    designator: { type: "string" },
                    length_ft: { type: "integer" },
                    surface: { type: "string" },
                    circuit_direction: { type: "string" },
                },
                required: ["designator"],
            },
        },
        frequencies: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    service: { type: "string" },
                    frequency_mhz: { type: "number" },
                    hours: { type: "string" },
                    notes: { type: "string" },
                },
                required: ["service", "frequency_mhz"],
            },
        },
        fuel: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    fuel_type: { type: "string" },
                    availability: { type: "string" },
                },
                required: ["fuel_type"],
            },
        },
    },
    required: ["icao", "name"],
};

const EXTRACTION_PROMPT = `Extract structured aerodrome data from this CFS entry. Return a JSON object with the fields defined in the schema.

Rules:
- icao: the 4-character ICAO code (e.g. CYVR, CZBB)
- name: the aerodrome name as written
- lat/lon: decimal degrees if coordinates are present, null otherwise
- elevation_ft: aerodrome elevation in feet, null if not found
- circuit_altitude_ft: circuit altitude in feet ASL, null if not found
- runways: array of runway entries with designator (e.g. "08/26"), length in feet, surface type, circuit direction
- frequencies: array of frequency entries with service label (TWR, MF, ATIS, GND, FSS, RADIO, etc.), frequency in MHz, operating hours, notes
- fuel: array of fuel entries with fuel_type (100LL, JA-1, MG-1, etc.) and availability (H24, Cardlock, truck, etc.)
- Only extract what is explicitly stated. Do not infer or guess values.`;

type AerodromeExtraction = {
    icao: string;
    name: string;
    lat?: number | null;
    lon?: number | null;
    elevation_ft?: number | null;
    circuit_altitude_ft?: number | null;
    runways?: { designator: string; length_ft?: number; surface?: string; circuit_direction?: string }[];
    frequencies?: { service: string; frequency_mhz: number; hours?: string; notes?: string }[];
    fuel?: { fuel_type: string; availability?: string }[];
};

const callHaiku = (prompt: string): Promise<AerodromeExtraction> =>
    new Promise((resolve, reject) => {
        const proc = spawn(
            "claude",
            [
                "--enable-auto-mode",
                "--print",
                "--output-format",
                "json",
                "--model",
                "haiku",
                "--system-prompt",
                EXTRACTION_PROMPT,
                "--json-schema",
                JSON.stringify(EXTRACTION_SCHEMA),
            ],
            { stdio: ["pipe", "pipe", "pipe"], env: claudeEnv },
        );

        const timer = setTimeout(() => {
            proc.kill();
            reject(new Error("Haiku timed out after 60s"));
        }, 60_000);

        let stdout = "";
        proc.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
        proc.on("close", () => {
            clearTimeout(timer);
            try {
                const parsed = JSON.parse(stdout) as {
                    is_error: boolean;
                    result: string;
                    structured_output?: AerodromeExtraction;
                };
                if (parsed.is_error || !parsed.structured_output) {
                    reject(new Error(`Haiku error: ${parsed.result}`));
                    return;
                }
                resolve(parsed.structured_output);
            } catch {
                reject(new Error(`Haiku parse error: ${stdout.slice(0, 200)}`));
            }
        });

        proc.stdin.write(prompt);
        proc.stdin.end();
    });

// Split markdown into aerodrome sections
const splitSections = (markdown: string): { text: string; sourcePage: number }[] => {
    const sections: { text: string; sourcePage: number }[] = [];
    const lines = markdown.split("\n");
    let current = "";
    let currentPage = 0;
    let sectionStartPage = 0;

    for (const line of lines) {
        const pageMatch = /<!--\s*page:(\d+)\s*-->/.exec(line);
        if (pageMatch) {
            currentPage = parseInt(pageMatch[1], 10);
        }

        const icaoMatch = /^#+\s*(C[A-Z0-9]{3})\b/.exec(line) ?? /^(C[A-Z0-9]{3})\s+[-–—]/.exec(line);
        if (icaoMatch && current.trim().length > 0) {
            sections.push({ text: current.trim(), sourcePage: sectionStartPage });
            current = "";
            sectionStartPage = currentPage;
        }

        if (!current && !icaoMatch) {
            sectionStartPage = currentPage;
        }

        current += line + "\n";
    }

    if (current.trim().length > 0) {
        sections.push({ text: current.trim(), sourcePage: sectionStartPage });
    }

    return sections;
};

const createDatabase = (db: Database.Database): void => {
    db.exec(`
        CREATE TABLE IF NOT EXISTS aerodromes (
            icao TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            lat REAL,
            lon REAL,
            elevation_ft INTEGER,
            circuit_altitude_ft INTEGER,
            source_page INTEGER
        );

        CREATE TABLE IF NOT EXISTS runways (
            icao TEXT NOT NULL,
            designator TEXT NOT NULL,
            length_ft INTEGER,
            surface TEXT,
            circuit_direction TEXT,
            source_page INTEGER,
            FOREIGN KEY(icao) REFERENCES aerodromes(icao)
        );

        CREATE TABLE IF NOT EXISTS frequencies (
            icao TEXT NOT NULL,
            service TEXT NOT NULL,
            frequency_mhz REAL NOT NULL,
            hours TEXT,
            notes TEXT,
            source_page INTEGER,
            FOREIGN KEY(icao) REFERENCES aerodromes(icao)
        );

        CREATE TABLE IF NOT EXISTS fuel (
            icao TEXT NOT NULL,
            fuel_type TEXT NOT NULL,
            availability TEXT,
            source_page INTEGER,
            FOREIGN KEY(icao) REFERENCES aerodromes(icao)
        );
    `);
};

const insertAerodrome = (db: Database.Database, data: AerodromeExtraction, sourcePage: number): void => {
    db.prepare("DELETE FROM runways WHERE icao = ?").run(data.icao);
    db.prepare("DELETE FROM frequencies WHERE icao = ?").run(data.icao);
    db.prepare("DELETE FROM fuel WHERE icao = ?").run(data.icao);

    db.prepare(
        "INSERT OR REPLACE INTO aerodromes (icao, name, lat, lon, elevation_ft, circuit_altitude_ft, source_page) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(
        data.icao,
        data.name,
        data.lat ?? null,
        data.lon ?? null,
        data.elevation_ft ?? null,
        data.circuit_altitude_ft ?? null,
        sourcePage,
    );

    if (data.runways) {
        const stmt = db.prepare(
            "INSERT INTO runways (icao, designator, length_ft, surface, circuit_direction, source_page) VALUES (?, ?, ?, ?, ?, ?)",
        );
        for (const rwy of data.runways) {
            stmt.run(
                data.icao,
                rwy.designator,
                rwy.length_ft ?? null,
                rwy.surface ?? null,
                rwy.circuit_direction ?? null,
                sourcePage,
            );
        }
    }

    if (data.frequencies) {
        const stmt = db.prepare(
            "INSERT INTO frequencies (icao, service, frequency_mhz, hours, notes, source_page) VALUES (?, ?, ?, ?, ?, ?)",
        );
        for (const freq of data.frequencies) {
            stmt.run(
                data.icao,
                freq.service,
                freq.frequency_mhz,
                freq.hours ?? null,
                freq.notes ?? null,
                sourcePage,
            );
        }
    }

    if (data.fuel) {
        const stmt = db.prepare(
            "INSERT INTO fuel (icao, fuel_type, availability, source_page) VALUES (?, ?, ?, ?)",
        );
        for (const f of data.fuel) {
            stmt.run(data.icao, f.fuel_type, f.availability ?? null, sourcePage);
        }
    }
};

const main = async () => {
    if (!existsSync(INPUT_PATH)) {
        console.error(`Input file not found: ${INPUT_PATH}`);
        process.exit(1);
    }

    if (!existsSync(DATA_DIR)) {
        mkdirSync(DATA_DIR, { recursive: true });
    }

    // Remove existing DB
    if (existsSync(DB_PATH)) {
        const { unlinkSync } = await import("fs");
        unlinkSync(DB_PATH);
    }

    const markdown = readFileSync(INPUT_PATH, "utf-8");
    const sections = splitSections(markdown);

    console.log(`Found ${sections.length} sections to process`);

    const db = new Database(DB_PATH);
    createDatabase(db);

    let processed = 0;
    let errors = 0;

    for (const section of sections) {
        // Skip very short sections (unlikely to be aerodrome data)
        if (section.text.length < 50) continue;

        try {
            const data = await callHaiku(section.text);
            if (data.icao && /^C[A-Z0-9]{3}$/.test(data.icao)) {
                insertAerodrome(db, data, section.sourcePage);
                processed++;
                process.stdout.write(`\r  Processed ${processed} aerodromes (${errors} errors)`);
            }
        } catch (e) {
            errors++;
            console.error(`\n  Error processing section: ${(e as Error).message}`);
        }
    }

    db.close();
    console.log(`\n\nDone: ${processed} aerodromes written to ${DB_PATH} (${errors} errors)`);
};

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
