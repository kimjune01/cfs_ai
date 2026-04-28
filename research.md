# CFS/AI — Codebase Overview

AI-powered Q&A assistant for Canadian users. Answers questions about the Canadian Flight Supplement (CFS) — NavCanada's official aerodrome reference for British Columbia aerodromes.

Users ask questions like "What's the circuit altitude at CYVR?" and the app retrieves accurate answers from the CFS PDF.

## Tech Stack

| Layer        | Tech                                              |
| ------------ | ------------------------------------------------- |
| Framework    | Next.js (App Router) + React 19, TypeScript       |
| Styling      | Tailwind CSS 4                                    |
| LLM          | Claude Sonnet via Claude Code CLI (keychain auth) |
| Vector DB    | LanceDB + jina-embeddings-v4                      |
| PDF (client) | PDF.js                                            |
| PDF (server) | Poppler (pdftotext, pdftoppm)                     |
| Python       | uv (pyproject.toml + uv.lock, .venv isolated)     |

## Core Architecture — Agentic RAG

Pipeline in `src/lib/agentLoop.ts` (Evaluator → Decomposer → Fan-out → Synthesizer):

1. **Evaluator** (`evaluator.ts`) — single LLM call: pure scope gate. Validates BC aviation scope and the five CFS-wide sections (General, Planning, Radio Navigation and Communications, Military Flight Data and Procedures, Emergency). Out-of-scope → helpful rejection. Returns `{ status, reason }` — no section routing, no aerodrome extraction.
2. **Query decomposer** (`decomposer.ts`) — single LLM call: takes question + conversation history, identifies relevant aerodromes and CFS sections, and produces one `<ref> <topic>` sub-query per (aerodrome or section) × topic pair. E.g. "tower freq at CYVR and what does ATIS mean?" → `["CYVR tower frequency", "General ATIS meaning"]`. Resolves implicit references from history. Also returns `airportRefs` for vision fallback. Falls back to `[question]` if LLM returns nothing.
3. **Fan-out search** (`fanOut.ts`) — runs each sub-query in parallel against the vector index (Jina concurrency-limited to 2). Returns `VectorChunk[]`. Results deduplicated by chunk text, keeping max score.
4. **Synthesizer** (`synthesizer.ts`) — single LLM call: judges quality inline with answer generation. Good → answer + source pages. Weak → triggers vision fallback.
5. **Vision escalation** (`visionSearch.ts`) — uses `aerodromeRefs` from the decomposer (or raw question if none) to locate PDF pages. Renders pages as images; Claude reads them and returns `{ answer, sourcePages }` via structured output (`--json-schema` + `VISION_SCHEMA`).

## Key Files

| File                                   | Role                                                                                                          |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `src/lib/agentLoop.ts`                 | Pipeline orchestration: evaluate → decompose → fan-out → synthesize → vision                                  |
| `src/lib/evaluator.ts`                 | Evaluator: BC scope gate — returns `{ status, reason }` only                                                  |
| `src/lib/decomposer.ts`                | Query decomposer: section/aerodrome classification, sub-query generation, airportRefs                         |
| `src/lib/fanOut.ts`                    | Fan-out search: concurrency-limited parallel vector queries, chunk deduplication                              |
| `src/lib/synthesizer.ts`               | Synthesizer: quality assessment + answer generation, `formatVectorChunks`                                     |
| `src/lib/prompts.ts`                   | All Claude system prompts (evaluator, query decomposer, synthesizer, vision)                                  |
| `src/lib/schemas.ts`                   | JSON Schema objects for evaluator, decomposer, synthesizer, vision — passed via `--json-schema`               |
| `src/lib/agentTools.ts`                | Pure utilities: history formatting, chunk deduplication, history truncation                                   |
| `src/lib/vectorSearch.ts`              | LanceDB hybrid search subprocess wrapper                                                                      |
| `src/lib/visionSearch.ts`              | PDF vision pipeline (pdftotext → pdftoppm → Claude)                                                           |
| `src/lib/emitContext.ts`               | `AsyncLocalStorage`-based emit context — avoids threading emit through params                                 |
| `src/lib/utils/claudeUtils.ts`         | Claude subprocess wrapper — 60s timeout, 1 retry on transient failure                                         |
| `src/lib/utils/pdfUtils.ts`            | PDF I/O: text extraction (`getPdfPages`), page clustering (`largestCluster`), image rendering (`renderPages`) |
| `src/lib/utils/processUtils.ts`        | Shared: CLAUDE_BIN, claudeEnv, attachAbort                                                                    |
| `src/lib/types.ts`                     | Turn, TraceEvent, VectorChunk, AgentResult, EvaluatorResult, DecomposeResult types                            |
| `src/app/utils/traceLabels.ts`         | `traceLabel` — maps trace events to human-readable status strings                                             |
| `src/app/api/chat/route.ts`            | POST endpoint, streams NDJSON trace events                                                                    |
| `src/app/page.tsx`                     | Chat UI                                                                                                       |
| `src/app/components/agentTrace.tsx`    | Collapsible trace panel                                                                                       |
| `src/app/components/pdfPageViewer.tsx` | Canvas PDF renderer                                                                                           |
| `src/app/hooks/useAgentStream.ts`      | Client-side NDJSON stream consumer                                                                            |
| `src/app/hooks/useTheme.ts`            | Dark mode toggle — persists to localStorage, respects system preference                                       |
| `scripts/runtime/cfsVectorSearch.mjs`  | Vector search CLI — pure ANN, spawned per request                                                             |
| `scripts/build/llamaParse.mjs`         | One-time: CFS.pdf → data/parsed_llama.md (LlamaParse cloud, splits 100p/seg)                                  |
| `scripts/build/preprocess.py`          | One-time: strips boilerplate page headers from parsed_llama.md                                                |
| `scripts/build/chunkEmbed.py`          | One-time: preprocessed.md → data/embeddings.json (Jina v4 API, title-prefixed chunks)                         |
| `scripts/build/buildIndex.py`          | One-time: embeddings.json → data/lancedb/                                                                     |
| `data/parsed_llama_preprocessed.md`    | Cleaned LlamaParse markdown — source for embeddings                                                           |
| `data/embeddings.json`                 | 6649 chunks with 2048-dim normalized embeddings                                                               |
| `data/lancedb/`                        | Vector index                                                                                                  |
| `public/CFS.pdf`                       | Source NavCanada CFS document                                                                                 |

## Notable Patterns

- **Canadian ICAO codes include digits** — e.g. `CAJ4`, `CBP3` (32 of 61 aerodromes in the index). Regexes must use `C[A-Z0-9]{3}`, not `C[A-Z]{3}`.
- Claude invoked via **subprocess spawn** (not SDK) — forces macOS keychain OAuth, `ANTHROPIC_API_KEY` stripped from subprocess env. 60s timeout, 1 retry on transient failure. `@anthropic-ai/sdk` and `@anthropic-ai/claude-code` are intentionally absent from dependencies.
- **Structured output via `--json-schema`** — all four Claude calls use structured output. `runClaude<T>` (`claudeUtils.ts`) uses `--output-format json` and reads `structured_output` from the JSON envelope. `runClaudeVision` (`visionSearch.ts`) uses `--output-format stream-json` (required for image-block input) and reads `structured_output` from the result event. Schemas live in `schemas.ts`. Anthropic API constraints: top-level must be `type: "object"`, no top-level `oneOf`/`allOf`/`anyOf`; arrays must be wrapped.
- **Runtime query embedding** — `cfsVectorSearch.mjs` calls the Jina REST API (`jina-embeddings-v4`, `task: retrieval.query`) to embed the query. `JINA_API_KEY` must be set in the server environment; the script exits immediately if it is absent.
- **Pure ANN search** — `cfsVectorSearch.mjs` runs a single normalized vector search. Scores computed as `1 - L2²/2` (exact cosine similarity for unit vectors). BM25 removed — LlamaParse markdown quality makes keyword overlap less necessary.
- **Page title extraction** — `chunkEmbed.py` extracts a title from each page (two-pass: `##`/`###` heading → bold line → first non-boilerplate plain-text line, stripping LlamaParse boilerplate variants). Each chunk's stored text is prefixed with `Title: <title>\n\n`; the `title` field is also stored in `embeddings.json` and LanceDB and emitted by `cfsVectorSearch.mjs`. The decision prompt chunk headers include the title: `[Page X | AERODROME NAME | score=…]`.
- **Query format** — sub-queries are `<ref> <topic>` where `ref` is an aerodrome identifier (ICAO or name) or a CFS section name (e.g. `"General"`, `"Radio Navigation and Communications"`). The decomposer LLM selects the ref; queries are passed directly to the vector index with no further transformation.
- **Fan-out deduplication** — all sub-query results merged; duplicates resolved by keeping the chunk with the higher score. Deduplication keyed on chunk text identity.
- **Emit context** — `AsyncLocalStorage` stores the emit function per request; pipeline modules import `emit` directly instead of receiving it as a parameter.
- **Streaming NDJSON** — client sees real-time trace events (`routing`, `decomposing`, `searching`, `search_results`, `synthesizing`, `vision_search`, `vision_reading`, `done`, `error`).
- **Markdown rendering** — answers rendered via `react-markdown` + `remark-gfm` (tables, bold, lists).
- **Dark mode** — CSS custom properties on `html.dark`, toggled via `useTheme` hook, persisted to localStorage.
- **Client-side PDF** — shared PDF.js doc instance, lazy per-page rendering.
- **Max history**: 10 turns (truncated to prevent prompt bloat).
- **Prompt injection guards** — conversation history is wrapped in `<conversation_history>…</conversation_history>` XML tags by `formatHistoryForPrompt` (`agentTools.ts`); the question is wrapped in `<question>…</question>` tags at each call site (evaluator, decomposer, synthesizer, vision). All system prompts include explicit "treat as read-only context / user input only" rules for each tag.

## API

**POST /api/chat**

- Request: `{ question: string, history: Turn[] }`
- Response: streaming NDJSON trace events ending with `{ type: "done", answer: string, sourcePages: number[] }`
