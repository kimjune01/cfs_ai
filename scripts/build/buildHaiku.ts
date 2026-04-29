/**
 * One-off: finish the Haiku build into cfs-haiku-partial.db
 * Same logic as buildSqlite.ts but hardcoded to haiku + the partial DB path
 */

import { spawn } from "child_process";
import { cpus } from "os";
import Database from "better-sqlite3";
import { existsSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";

const CONCURRENCY = Math.min(cpus().length, 18);
const DATA_DIR = join(process.cwd(), "data");
const INPUT_PATH = join(DATA_DIR, "parsed_llama_preprocessed.md");
const DB_PATH = join(DATA_DIR, "cfs-haiku-partial.db");

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
        runways: { type: "array", items: { type: "object", properties: { designator: { type: "string" }, length_ft: { type: "integer" }, surface: { type: "string" }, circuit_direction: { type: "string" } }, required: ["designator"] } },
        frequencies: { type: "array", items: { type: "object", properties: { service: { type: "string" }, frequency_mhz: { type: "number" }, hours: { type: "string" }, notes: { type: "string" } }, required: ["service", "frequency_mhz"] } },
        fuel: { type: "array", items: { type: "object", properties: { fuel_type: { type: "string" }, availability: { type: "string" } }, required: ["fuel_type"] } },
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
- runways: array of runway entries with designator, length in feet, surface type, circuit direction
- frequencies: array of frequency entries with service label (TWR, MF, ATIS, GND, FSS, RADIO, etc.), frequency in MHz, operating hours, notes
- fuel: array of fuel entries with fuel_type (100LL, JA-1, MG-1, etc.) and availability (H24, Cardlock, truck, etc.)
- Only extract what is explicitly stated. Do not infer or guess values.`;

type AerodromeExtraction = {
    icao: string; name: string; lat?: number | null; lon?: number | null;
    elevation_ft?: number | null; circuit_altitude_ft?: number | null;
    runways?: { designator: string; length_ft?: number; surface?: string; circuit_direction?: string }[];
    frequencies?: { service: string; frequency_mhz: number; hours?: string; notes?: string }[];
    fuel?: { fuel_type: string; availability?: string }[];
};

const callExtractor = (prompt: string): Promise<AerodromeExtraction> =>
    new Promise((resolve, reject) => {
        const proc = spawn("claude", [
            "--enable-auto-mode", "--print", "--output-format", "json",
            "--model", "haiku",
            "--system-prompt", EXTRACTION_PROMPT,
            "--json-schema", JSON.stringify(EXTRACTION_SCHEMA),
        ], { stdio: ["pipe", "pipe", "pipe"], env: claudeEnv });
        const timer = setTimeout(() => { proc.kill(); reject(new Error("timed out")); }, 60_000);
        let stdout = "";
        proc.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
        proc.on("close", () => {
            clearTimeout(timer);
            try {
                const parsed = JSON.parse(stdout) as { is_error: boolean; result: string; structured_output?: AerodromeExtraction };
                if (parsed.is_error || !parsed.structured_output) reject(new Error(parsed.result));
                else resolve(parsed.structured_output);
            } catch { reject(new Error(`parse error: ${stdout.slice(0, 100)}`)); }
        });
        proc.stdin.write(prompt);
        proc.stdin.end();
    });

type Section = { text: string; sourcePage: number; icao?: string };

const splitSections = (markdown: string): Section[] => {
    const sections: Section[] = [];
    const lines = markdown.split("\n");
    let current = "", currentIcao: string | undefined, currentPage = 0, sectionStartPage = 0;
    const flush = () => { if (current.trim().length > 0) sections.push({ text: current.trim(), sourcePage: sectionStartPage, icao: currentIcao }); };
    for (const line of lines) {
        const pm = /<!--\s*page:(\d+)\s*-->/.exec(line);
        if (pm) currentPage = parseInt(pm[1], 10);
        const contd = /cont'?d/i.test(line) ? /\b(C[A-Z0-9]{3})\s*$/.exec(line) : null;
        if (contd) { flush(); currentIcao = contd[1]; current = line + "\n"; sectionStartPage = currentPage; continue; }
        const icao = /^#+\s*(C[A-Z0-9]{3})\b/.exec(line) ?? /^(C[A-Z0-9]{3})\s+[-–—]/.exec(line) ?? /\bBC\b.*\b(C[A-Z0-9]{3})\s*$/.exec(line);
        if (icao) { flush(); currentIcao = icao[1]; current = ""; sectionStartPage = currentPage; }
        current += line + "\n";
    }
    flush();
    return sections;
};

const main = async () => {
    const markdown = readFileSync(INPUT_PATH, "utf-8");
    const sections = splitSections(markdown);
    const db = new Database(DB_PATH);
    db.exec(`CREATE TABLE IF NOT EXISTS aerodromes (icao TEXT PRIMARY KEY, name TEXT NOT NULL, lat REAL, lon REAL, elevation_ft INTEGER, circuit_altitude_ft INTEGER, source_page INTEGER);
CREATE TABLE IF NOT EXISTS runways (icao TEXT NOT NULL, designator TEXT NOT NULL, length_ft INTEGER, surface TEXT, circuit_direction TEXT, source_page INTEGER);
CREATE TABLE IF NOT EXISTS frequencies (icao TEXT NOT NULL, service TEXT NOT NULL, frequency_mhz REAL NOT NULL, hours TEXT, notes TEXT, source_page INTEGER);
CREATE TABLE IF NOT EXISTS fuel (icao TEXT NOT NULL, fuel_type TEXT NOT NULL, availability TEXT, source_page INTEGER);`);

    const existing = new Set((db.prepare("SELECT icao FROM aerodromes").all() as { icao: string }[]).map(r => r.icao));
    const toProcess = sections.filter(s => s.text.length >= 50 && !(s.icao && existing.has(s.icao)));
    console.log(`${sections.length} sections, ${existing.size} in DB, ${toProcess.length} to process. Concurrency: ${CONCURRENCY}`);

    let processed = 0, added = 0, errors = 0, idx = 0;
    const work = async () => {
        while (idx < toProcess.length) {
            const i = idx++;
            const s = toProcess[i];
            try {
                const data = await callExtractor(s.text);
                const icao = s.icao ?? data.icao;
                if (!icao || !/^C[A-Z0-9]{3}$/.test(icao)) continue;
                if (existing.has(icao)) {
                    if (data.frequencies) for (const f of data.frequencies) db.prepare("INSERT INTO frequencies VALUES(?,?,?,?,?,?)").run(icao,f.service,f.frequency_mhz,f.hours??null,f.notes??null,s.sourcePage);
                    if (data.fuel) for (const f of data.fuel) db.prepare("INSERT INTO fuel VALUES(?,?,?,?)").run(icao,f.fuel_type,f.availability??null,s.sourcePage);
                    if (data.runways) for (const r of data.runways) db.prepare("INSERT INTO runways VALUES(?,?,?,?,?,?)").run(icao,r.designator,r.length_ft??null,r.surface??null,r.circuit_direction??null,s.sourcePage);
                    if (data.circuit_altitude_ft!=null) db.prepare("UPDATE aerodromes SET circuit_altitude_ft=? WHERE icao=? AND circuit_altitude_ft IS NULL").run(data.circuit_altitude_ft,icao);
                    added++;
                } else {
                    db.prepare("DELETE FROM runways WHERE icao=?").run(data.icao);
                    db.prepare("DELETE FROM frequencies WHERE icao=?").run(data.icao);
                    db.prepare("DELETE FROM fuel WHERE icao=?").run(data.icao);
                    db.prepare("INSERT OR REPLACE INTO aerodromes VALUES(?,?,?,?,?,?,?)").run(data.icao,data.name,data.lat??null,data.lon??null,data.elevation_ft??null,data.circuit_altitude_ft??null,s.sourcePage);
                    if (data.runways) for (const r of data.runways) db.prepare("INSERT INTO runways VALUES(?,?,?,?,?,?)").run(data.icao,r.designator,r.length_ft??null,r.surface??null,r.circuit_direction??null,s.sourcePage);
                    if (data.frequencies) for (const f of data.frequencies) db.prepare("INSERT INTO frequencies VALUES(?,?,?,?,?,?)").run(data.icao,f.service,f.frequency_mhz,f.hours??null,f.notes??null,s.sourcePage);
                    if (data.fuel) for (const f of data.fuel) db.prepare("INSERT INTO fuel VALUES(?,?,?,?)").run(data.icao,f.fuel_type,f.availability??null,s.sourcePage);
                    existing.add(data.icao);
                    processed++;
                }
                process.stdout.write(`\r  ${processed} new, ${added} appended, ${errors} errors    `);
            } catch (e) { errors++; console.error(`\n  Error: ${(e as Error).message}`); }
        }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, () => work()));
    db.close();
    console.log(`\n\nDone: ${processed} new, ${added} appended, ${errors} errors. Total: ${existing.size} in ${DB_PATH}`);
};

main().catch(e => { console.error(e); process.exit(1); });
