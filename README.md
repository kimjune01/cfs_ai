# CFS British Columbia Assistant

An AI-powered Q&A tool for Canadian users. Ask questions about aerodromes, circuit altitudes, radio frequencies, runway data, fuel availability, and more — all grounded in the NavCanada Canadian Flight Supplement (CFS).

> **Note:** The CFS PDF is not included in this repo. NavCanada retains copyright over the CFS, so you must obtain your own copy and place it at `public/CFS.pdf`. For the same reason, this app cannot be deployed publicly.

![CFS Assistant demo](Demo.png)

## How it works

The app is an agentic RAG pipeline with four stages: Evaluator → Decomposer → Fan-out Search → Synthesizer, with a vision fallback when vector results are insufficient.

```
User question
      │
      ▼
 Evaluator (Claude — structured output)
 ├── Out of scope?  ──► helpful rejection explaining what CFS covers
 └── Ready?         ──► continue
      │
      ▼
 Query Decomposer (Claude — structured output)
 └── One sub-query per (aerodrome × topic) or (section × topic)
     format: "<aerodrome or section name> <topic>"
     e.g. "CYVR tower frequency", "General ATIS meaning"
      │
      ▼
 Fan-out search (parallel, Jina concurrency-limited)
 └── One vector query per sub-query
      │
      ▼
 Synthesizer (Claude)
 ├── Results good? ──► answer + source pages
 └── Results weak? ──► escalate to vision
      │
      ▼ (when needed)
 Vision pipeline (structured output)
 ├── pdftotext → find aerodrome pages by term
 ├── pdftoppm → render pages to PNG
 └── Claude reads images → { answer, sourcePages }
      │
      ▼
 Answer + source pages rendered inline (PDF.js)
```

**Evaluator** — pure scope gate. Validates that the question is about BC aviation as covered by the CFS, or about one of the five CFS-wide sections (General, Planning, Radio Navigation and Communications, Military Flight Data and Procedures, Emergency). Out-of-scope → helpful rejection. No section routing, no aerodrome extraction.

**Query Decomposer** — single LLM call that does all query intelligence: identifies which aerodromes and CFS sections are relevant, resolves implicit references from conversation history, and produces one `<ref> <topic>` sub-query per (aerodrome or section) × topic pair. Also returns the aerodrome identifiers for vision fallback.

**Fan-out search** — runs all sub-queries in parallel against the vector index (Jina API, concurrency-limited to 2). Results deduplicated by chunk text, keeping the highest score.

**Synthesizer** — assesses result quality inline with answer generation. Answers directly from vector chunks when quality is good; triggers vision fallback when results don't explicitly cover what was asked.

**No API key required** — the app uses Claude Code's existing keychain OAuth session. The Anthropic API key is explicitly stripped from child process environments to prevent it overriding keychain auth. Requires `claude` to be on `PATH`.

## Tech stack

| Layer                  | Tool                                                                    |
| ---------------------- | ----------------------------------------------------------------------- |
| Web framework          | Next.js 16 (App Router)                                                 |
| UI                     | React + Tailwind CSS                                                    |
| Embedding model        | `jina-embeddings-v4` (Jina cloud API — index + runtime query embedding) |
| PDF parser             | LlamaParse cloud API                                                    |
| Vector database        | LanceDB                                                                 |
| Language model         | Claude Sonnet (via Claude Code CLI — keychain auth)                     |
| PDF text search        | `pdftotext` (poppler)                                                   |
| PDF rendering — server | `pdftoppm` (poppler)                                                    |
| PDF rendering — client | PDF.js                                                                  |

## Project structure

```
cfs_ai/
├── public/
│   ├── CFS.pdf                         # Source document
│   └── pdf.worker.mjs                  # PDF.js worker
├── scripts/
│   ├── build/
│   │   ├── llamaParse.mjs              # CFS.pdf → data/parsed_llama.md (LlamaParse cloud)
│   │   ├── preprocess.py               # parsed_llama.md → parsed_llama_preprocessed.md
│   │   ├── chunkEmbed.py               # preprocessed.md → data/embeddings.json (Jina v4 API, title-prefixed chunks)
│   │   ├── buildIndex.py               # embeddings.json → data/lancedb/
│   │   └── liteParse.mjs               # Alternative: CFS.pdf → data/parsed.json
│   ├── runtime/
│   │   └── cfsVectorSearch.mjs         # Vector search CLI (spawned per request)
│   └── eval/
│       ├── eval.ts                     # LLM-as-judge eval runner
│       └── evalCases.ts                # Golden Q&A test cases
├── data/
│   ├── parsed_llama.md                 # Raw LlamaParse output
│   ├── parsed_llama_preprocessed.md    # Cleaned markdown (boilerplate stripped)
│   ├── embeddings.json                 # 6649 chunk embeddings from Jina API (2048-dim)
│   └── lancedb/                        # Vector index
└── src/
    ├── lib/
    │   ├── types.ts                    # Shared types (Turn, TraceEvent, VectorChunk, etc.)
    │   ├── agentTools.ts               # Pure utilities: history formatting, deduplication
    │   ├── evaluator.ts                # Evaluator: BC scope gate
    │   ├── decomposer.ts               # Query decomposer: aerodrome/section classification + sub-query generation
    │   ├── fanOut.ts                   # Fan-out search: concurrency-limited parallel vector queries
    │   ├── synthesizer.ts              # Synthesizer: quality assessment + answer generation
    │   ├── vectorSearch.ts             # LanceDB search subprocess wrapper
    │   ├── visionSearch.ts             # PDF vision pipeline
    │   └── agentLoop.ts                # Pipeline orchestration
    └── app/
        ├── api/chat/route.ts           # Streaming NDJSON endpoint
        ├── hooks/
        │   └── useAgentStream.ts       # Client-side stream consumer
        ├── components/
        │   ├── agentTrace.tsx          # Collapsible agent trace panel
        │   └── pdfPageViewer.tsx       # PDF page renderer
        └── page.tsx                    # Chat UI
```

## Setup

1. Install dependencies:

    ```bash
    npm install
    uv sync
    ```

    `npm install` handles JS dependencies. `uv sync` creates a `.venv/` and installs Python dependencies from `pyproject.toml`. Install `uv` first if needed: `curl -LsSf https://astral.sh/uv/install.sh | sh`

2. Log in to Claude Code (required — the app uses keychain auth, not an API key):

    ```bash
    claude login
    ```

3. Install poppler (required for `pdftotext` and `pdftoppm`):

    ```bash
    brew install poppler
    ```

4. Set API keys in `.env.local`:

    ```
    LLAMA_CLOUD_API_KEY=<your key>
    JINA_API_KEY=<your key>
    ```

    `JINA_API_KEY` is used both at index-build time and at runtime — `cfsVectorSearch.mjs` calls the Jina API to embed each query.

5. Obtain a copy of the CFS PDF from NavCanada and place it at `public/CFS.pdf`. Then generate the vector index:

    ```bash
    LLAMA_CLOUD_API_KEY=... node scripts/build/llamaParse.mjs
    uv run python scripts/build/preprocess.py
    JINA_API_KEY=... uv run python scripts/build/chunkEmbed.py
    uv run python scripts/build/buildIndex.py
    ```

6. Start the dev server:
    ```bash
    npm run dev
    ```

The app will be available at `http://localhost:3000`.

## Evals

The eval suite runs golden Q&A cases through the full agent pipeline and uses Claude as a judge to verify answer quality. Cases cover tower vs. MF frequency labeling, fuel availability, circuit altitudes, hallucination guards, out-of-scope rejection, multi-section fan-out, and decomposer inference.

```bash
npm run eval                              # run all cases
npm run eval -- --id=cyvr-tower-freq      # run a single case by id
npm run eval -- --filter=regression       # run a tagged subset
npm run eval -- --timeout=120000          # override per-case timeout (ms)
```

Exit code 0 = all pass, 1 = any failures.

## Usage tips

- **Ask in plain English** — you don't need to know the ICAO code. "What's the circuit altitude at Pitt Meadows?" works just as well as `CYPK`. The decomposer resolves the name directly.
- **Ask specific questions** — circuit altitude, tower frequency, fuel types, runway dimensions, lighting.
- **Vision fallback is automatic** — the agent escalates to reading the actual PDF when it isn't confident in the vector results, or when you express doubt or ask to verify a previous answer.
- **Dark mode** — toggle in the top-right corner. Preference is saved to localStorage.
- The agent trace (collapsed below each answer) shows exactly which tools ran and what confidence scores were returned.
