import { pipeline } from "@xenova/transformers";
import { readFileSync, rmSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import * as lancedb from "@lancedb/lancedb";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CHUNKS_PATH = join(__dirname, "../data/chunks.json");
const LANCEDB_PATH = join(__dirname, "../data/lancedb");

async function main() {
  console.error("Loading embedding model (downloads ~22MB on first run)...");
  const embedder = await pipeline(
    "feature-extraction",
    "Xenova/all-MiniLM-L6-v2"
  );

  const chunks = JSON.parse(readFileSync(CHUNKS_PATH, "utf-8"));
  console.error(`Embedding ${chunks.length} chunks...`);

  const records = [];
  for (let i = 0; i < chunks.length; i++) {
    const output = await embedder(chunks[i].text, {
      pooling: "mean",
      normalize: true,
    });
    records.push({
      id: chunks[i].id,
      icao: chunks[i].icao ?? "",
      section_group: chunks[i].section_group ?? "",
      start_page: chunks[i].start_page ?? chunks[i].page ?? 0,
      end_page: chunks[i].end_page ?? chunks[i].page ?? 0,
      text: chunks[i].text,
      vector: Array.from(output.data),
    });

    if ((i + 1) % 50 === 0) {
      console.error(`  ${i + 1}/${chunks.length} embedded...`);
    }
  }

  // Remove existing table if present
  if (existsSync(LANCEDB_PATH)) {
    rmSync(LANCEDB_PATH, { recursive: true });
  }

  const db = await lancedb.connect(LANCEDB_PATH);
  await db.createTable("cfs", records);
  console.error(`Done. LanceDB table saved to ${LANCEDB_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
