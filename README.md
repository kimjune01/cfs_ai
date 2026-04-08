# CFS British Columbia Assistant

An AI-powered Q&A tool for Canadian pilots. Ask questions about aerodromes, circuit altitudes, radio frequencies, runway data, fuel availability, and more — all grounded in the NavCanada Canadian Flight Supplement (CFS).

![CFS Assistant demo](Demo.png)

## How it works

The app is a hybrid agentic RAG pipeline. Every question is validated, then routed through vector search first — with Claude rephrasing the query for better retrieval — and escalated to vision only when the vector results are insufficient.

```
User question
      │
      ▼
 Validation
 ├── No ICAO code? ──► ask for it
 └── High-effort?  ──► skip vector, go straight to vision
      │
      ▼
 Query rephrasing (Claude)
 └── Rewrites the question into a precise vector search query
      │
      ▼
 Vector search (LanceDB + all-MiniLM-L6-v2)
 └── Hybrid: ICAO keyword match + semantic ANN
      │
      ▼
 Decision (Claude)
 ├── Results explicitly answer the question? ──► answer from chunks
 └── Results insufficient or ambiguous?      ──► escalate to vision
      │
      ▼ (when needed)
 Vision pipeline
 ├── pdftotext → find aerodrome pages by term
 ├── pdftoppm → render pages to PNG
 └── Claude reads images → ground-truth answer
      │
      ▼
 Answer + source pages rendered inline (PDF.js)
```

**High-effort mode** — triggered when the pilot repeats a question, expresses doubt, or asks to verify. Skips vector search entirely and reads the PDF directly.

**No API key required** — the app uses Claude Code's existing macOS keychain OAuth session. The Anthropic API key is explicitly stripped from child process environments to prevent it overriding keychain auth.

## Tech stack

| Layer | Tool |
|---|---|
| Web framework | Next.js 16 (App Router) |
| UI | React + Tailwind CSS |
| Embedding model | `Xenova/all-MiniLM-L6-v2` via Transformers.js |
| Vector database | LanceDB |
| Language model | Claude Sonnet (via Claude Code CLI — keychain auth) |
| PDF text search | `pdftotext` (poppler) |
| PDF rendering — server | `pdftoppm` (poppler) |
| PDF rendering — client | PDF.js |

## Project structure

```
cfs_ai/
├── public/
│   ├── CFS.pdf                    # Source document
│   └── pdf.worker.mjs             # PDF.js worker
├── scripts/
│   ├── parse_cfs.py               # PDF → chunks.json (run once)
│   ├── embed_chunks.mjs           # chunks.json → LanceDB (run once)
│   ├── cfs_search.mjs             # Vector search helper (called per request)
│   ├── cfs_query.mjs              # Standalone agentic RAG script
│   └── cfs_vision_query.mjs       # Standalone vision pipeline script
├── data/
│   ├── chunks.json                # Parsed aerodrome chunks
│   └── lancedb/                   # Vector index
└── src/
    ├── lib/
    │   ├── types.ts               # Shared types (Turn, TraceEvent, etc.)
    │   ├── agent-tools.ts         # Tool implementations + shared utilities
    │   └── agent-loop.ts          # Agent orchestration
    └── app/
        ├── api/chat/route.ts      # Streaming NDJSON endpoint
        ├── hooks/
        │   └── useAgentStream.ts  # Client-side stream consumer
        ├── components/
        │   ├── AgentTrace.tsx     # Collapsible agent trace panel
        │   └── PDFPageViewer.tsx  # PDF page renderer
        └── page.tsx               # Chat UI
```

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Log in to Claude Code (required — the app uses keychain auth, not an API key):
   ```bash
   claude login
   ```

3. Install poppler (required for `pdftotext` and `pdftoppm`):
   ```bash
   brew install poppler
   ```

4. If regenerating the vector index from a new CFS PDF, run the offline scripts once:
   ```bash
   python scripts/parse_cfs.py
   node scripts/embed_chunks.mjs
   ```

5. Start the dev server:
   ```bash
   npm run dev
   ```

The app will be available at `http://localhost:3000`.

## Usage tips

- **Include the ICAO code** in every question (e.g. `CYVR`, `CYXX`, `CYHE`). The app will ask if you forget.
- **Ask specific questions** — circuit altitude, tower frequency, fuel types, runway dimensions, lighting.
- **Say "verify that" or "are you sure"** to trigger high-effort mode, which reads the actual PDF page directly instead of querying the vector index.
- The agent trace (collapsed below each answer) shows exactly which tools ran and what confidence scores were returned.
