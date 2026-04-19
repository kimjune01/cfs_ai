# CFS British Columbia Assistant

An AI-powered Q&A tool for Canadian pilots. Ask questions about aerodromes, circuit altitudes, radio frequencies, runway data, fuel availability, and more — all grounded in the NavCanada Canadian Flight Supplement (CFS).

![CFS Assistant demo](Demo.png)

## How it works

The app is a hybrid agentic RAG pipeline. Every question is validated, then routed through vector search first — with Claude rephrasing the query for better retrieval — and escalated to vision only when the vector results are insufficient.

```
User question
      │
      ▼
 Evaluator (Claude — structured output)
 ├── No ICAO code?       ──► infer from name, or ask pilot to clarify
 ├── Ambiguous airport?  ──► ask pilot to pick (e.g. Victoria → CYYJ or CYWH)
 ├── Outside BC?         ──► out_of_scope
 ├── Off-topic?          ──► out_of_scope
 └── Ready?              ──► synthesize clean question with resolved ICAO
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
 ├── Results insufficient or ambiguous?      ──► escalate to vision
 └── Pilot repeating or doubting?            ──► escalate to vision
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

**Evaluator** — the first stage in the pipeline. Resolves or infers the ICAO code, rejects out-of-scope questions (non-BC aerodromes, weather, NOTAMs), and loops with clarifying questions until the request is unambiguous. Hands off a synthesized, self-contained question downstream.

**Decision** — runs after vector search with the retrieved chunks and conversation history. Answers directly if results are sufficient, or escalates to vision if confidence is low, the field label doesn't match, or the pilot is repeating/doubting a previous answer.

**No API key required** — the app uses Claude Code's existing keychain OAuth session. The Anthropic API key is explicitly stripped from child process environments to prevent it overriding keychain auth. Requires `claude` to be on `PATH`.

## Tech stack

| Layer                  | Tool                                                |
| ---------------------- | --------------------------------------------------- |
| Web framework          | Next.js 16 (App Router)                             |
| UI                     | React + Tailwind CSS                                |
| Embedding model        | `Xenova/all-MiniLM-L6-v2` via Transformers.js       |
| Vector database        | LanceDB                                             |
| Language model         | Claude Sonnet (via Claude Code CLI — keychain auth) |
| PDF text search        | `pdftotext` (poppler)                               |
| PDF rendering — server | `pdftoppm` (poppler)                                |
| PDF rendering — client | PDF.js                                              |

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
│   ├── cfs_vision_query.mjs       # Standalone vision pipeline script
│   ├── eval.ts                    # LLM-as-judge eval runner
│   └── evalCases.ts               # Golden Q&A test cases
├── data/
│   ├── chunks.json                # Parsed aerodrome chunks
│   └── lancedb/                   # Vector index
└── src/
    ├── lib/
    │   ├── types.ts               # Shared types (Turn, TraceEvent, etc.)
    │   ├── processUtils.ts        # Shared Claude binary + env helpers
    │   ├── agentTools.ts          # PDF utilities + Claude runner
    │   ├── vectorSearch.ts        # LanceDB hybrid search
    │   ├── visionSearch.ts        # PDF vision pipeline
    │   ├── evaluator.ts           # Question evaluator (ICAO inference, scope check)
    │   └── agentLoop.ts           # Agent orchestration
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

## Evals

The eval suite runs 13 golden Q&A cases through the full agent pipeline and uses Claude as a judge to verify answer quality. Cases cover tower vs. MF frequency labeling, fuel availability, circuit altitudes, hallucination guards, and evaluator behaviour (ICAO inference, ambiguous names, out-of-scope requests).

```bash
npm run eval                          # run all cases
npm run eval -- --filter=regression   # run a tagged subset
npm run eval -- --timeout=120000      # override per-case timeout (ms)
```

Exit code 0 = all pass, 1 = any failures.

## Usage tips

- **Include the ICAO code** in every question (e.g. `CYVR`, `CYXX`, `CYHE`). The app will ask if you forget.
- **Ask specific questions** — circuit altitude, tower frequency, fuel types, runway dimensions, lighting.
- **Say "verify that" or "are you sure"** — the decision step detects doubt or repetition and escalates directly to vision, reading the actual PDF page for ground truth.
- The agent trace (collapsed below each answer) shows exactly which tools ran and what confidence scores were returned.
