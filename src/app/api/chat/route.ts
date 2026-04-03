import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { pipeline } from "@xenova/transformers";
import { join } from "path";
import * as lancedb from "@lancedb/lancedb";

type Chunk = {
  id: number;
  icao: string;
  section_group: string;
  start_page: number;
  end_page: number;
  text: string;
};

type CfsTable = Awaited<ReturnType<InstanceType<typeof lancedb.Connection>["openTable"]>>;

// Singletons — opened once per server process
let table: CfsTable | null = null;
let embedder: Awaited<ReturnType<typeof pipeline>> | null = null;

async function getTable() {
  if (!table) {
    const db = await lancedb.connect(join(process.cwd(), "data", "lancedb"));
    table = await db.openTable("cfs");
  }
  return table;
}

async function getEmbedder() {
  if (!embedder) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    embedder = await (pipeline as any)(
      "feature-extraction",
      "Xenova/all-MiniLM-L6-v2"
    );
  }
  return embedder;
}

// Extract Canadian ICAO codes from a query (C + 3 uppercase letters/digits)
function extractIcaoCodes(question: string): string[] {
  return [...question.matchAll(/\bC[A-Z]{3}\b/g)].map((m) => m[0]);
}

// Extract short uppercase abbreviations from a query (2–6 letters, not common words)
const COMMON_WORDS = new Set(["THE", "AND", "FOR", "CFS", "AT", "IN", "OF", "IS", "TO", "A", "BC", "VFR", "IFR"]);
function extractAbbreviations(question: string): string[] {
  return [...question.matchAll(/\b([A-Z]{2,6})\b/g)]
    .map((m) => m[1])
    .filter((w) => !COMMON_WORDS.has(w) && !/^C[A-Z]{3}$/.test(w));
}

// A chunk is a definition page if the term appears in a definitional context
function isDefinitionChunk(chunk: Chunk, term: string): boolean {
  const t = chunk.text;
  return (
    new RegExp(`\\b\\w[\\w ]{2,}\\s*\\(${term}\\)`).test(t) ||
    new RegExp(`^${term}\\s*[-–]\\s*\\w`, "m").test(t)
  );
}

async function retrieveTopK(question: string, k = 5): Promise<Chunk[]> {
  const [embedderInstance, cfsTable] = await Promise.all([
    getEmbedder(),
    getTable(),
  ]);

  const upperQuestion = question.toUpperCase();

  // Keyword pass 1: force-include all pages belonging to mentioned ICAO codes
  const icaoCodes = extractIcaoCodes(upperQuestion);

  // Keyword pass 2: force-include definition pages for abbreviations
  const abbrevs = extractAbbreviations(upperQuestion);

  // Semantic search via LanceDB
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const output = await (embedderInstance as any)(question, {
    pooling: "mean",
    normalize: true,
  });
  const queryVec = Array.from(output.data) as number[];

  const semanticResults = (await cfsTable
    .search(queryVec)
    .limit(k)
    .toArray()) as (Chunk & { vector: number[] })[];

  const semanticChunks: Chunk[] = semanticResults.map(({ vector: _vec, ...chunk }) => chunk);

  // Build keyword chunks from full table scan (only text/page fields needed)
  const allRows = (await cfsTable.query().select(["id", "icao", "section_group", "start_page", "end_page", "text"]).toArray()) as Chunk[];

  // ICAO match: compare directly against the indexed icao field — no text scan
  const icaoChunks = icaoCodes.length
    ? allRows.filter((c) => icaoCodes.includes(c.icao))
    : [];

  const abbrevChunks = abbrevs.length
    ? allRows.filter((c) => abbrevs.some((abbr) => isDefinitionChunk(c, abbr)))
    : [];

  // Merge: keyword pages first, then semantic results not already included
  const keywordIds = new Set([...icaoChunks, ...abbrevChunks].map((c) => c.id));
  const keywordPages = [...new Map(
    [...icaoChunks, ...abbrevChunks].map((c) => [c.id, c])
  ).values()];

  const additionalSemantic = semanticChunks.filter((c) => !keywordIds.has(c.id));
  const remaining = Math.max(0, k - keywordPages.length);

  return [...keywordPages, ...additionalSemantic.slice(0, remaining)];
}

const SYSTEM_PROMPT = `You are a knowledgeable assistant for Canadian pilots. You answer questions ONLY about the NavCanada Canadian Flight Supplement (CFS).

Rules:
- Answer ONLY questions related to the Canadian Flight Supplement: aerodromes, circuit altitudes, runway data, radio frequencies, lighting, fuel, operating hours, FIC, FLT PLN, NOTAM files, airspace, or other CFS content.
- If the question is not about the CFS or Canadian aviation, respond with exactly: "I can only answer questions about the Canadian Flight Supplement. Please ask me about Canadian aerodromes, frequencies, circuit altitudes, runway data, or other CFS topics."
- Base answers solely on the CFS excerpts provided below. Do not invent or infer information not present in the context.
- If the context does not contain enough information to answer, say so clearly rather than guessing.
- Be concise and precise — pilots value accuracy over verbosity.

CFS Context:
{context}`;

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const question: string =
    (body as Record<string, unknown>)?.question?.toString().trim() ?? "";

  if (!question) {
    return Response.json({ error: "Question is required." }, { status: 400 });
  }

  try {
    const topChunks = await retrieveTopK(question);
    const context = topChunks
      .map((c) => `[CFS Page ${c.start_page} | ${c.icao} | ${c.section_group}]\n${c.text}`)
      .join("\n\n---\n\n");

    const client = new Anthropic();
    const message = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      system: SYSTEM_PROMPT.replace("{context}", context),
      messages: [{ role: "user", content: question }],
    });

    const answer =
      message.content[0].type === "text" ? message.content[0].text : "";

    const seenPages = new Set<number>();
    const sources = topChunks
      .filter((c) => !seenPages.has(c.start_page) && seenPages.add(c.start_page))
      .map((c) => ({ page: c.start_page, text: c.text }));

    return Response.json({ answer, sources });
  } catch (e) {
    console.error("CFS API error:", e);
    return Response.json({ error: "Failed to process your question." }, { status: 500 });
  }
}
