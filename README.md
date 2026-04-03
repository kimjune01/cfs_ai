# CFS British Columbia Assistant

An AI-powered Q&A tool for Canadian pilots. Ask questions about aerodromes, circuit altitudes, radio frequencies, runway data, fuel availability, and more — all grounded in the NavCanada Canadian Flight Supplement (CFS).

![CFS Assistant demo](Demo.png)

## How it works

The app is a RAG (Retrieval-Augmented Generation) pipeline: questions are answered using only passages retrieved from the CFS, not from the model's general knowledge.

```
┌─────────────────────────────────────────────────────────────────┐
│                        OFFLINE SETUP                            │
│                                                                 │
│  CFS.pdf  ──►  parse_cfs.py       ──►  chunks.json             │
│                (Docling: layout-       chunking strategy:       │
│                 aware parsing)         one chunk per            │
│                                        aerodrome × section      │
│                                        group (identity /        │
│                                        movement / comms /       │
│                                        procedures)              │
│                                              │                  │
│                                              ▼                  │
│                                       embed_chunks.mjs          │
│                                       (Transformers.js          │
│                                        all-MiniLM-L6-v2)       │
│                                              │                  │
│                                              ▼                  │
│                                          LanceDB                │
│                                       (vector index)            │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                       QUERY (RUNTIME)                           │
│                  hybrid keyword + semantic retrieval            │
│                                                                 │
│  User question                                                  │
│       │                                                         │
│       ├──► Extract ICAO codes  ──► force-include all chunks     │
│       │    (regex C[A-Z]{3})        for that aerodrome          │
│       │                                      │                  │
│       ├──► Extract abbreviations ──► force-include definition   │
│       │    (2–6 uppercase words)     chunks for that term       │
│       │                                      │                  │
│       └──► Embed question     ──► ANN search (LanceDB)          │
│            (all-MiniLM-L6-v2)    top-K semantic matches         │
│                                      │                          │
│                              Merge & deduplicate                │
│                              keyword chunks first,              │
│                              semantic fills remaining slots     │
│                                      │                          │
│                              Top-K CFS chunks (default 5)       │
│                                      │                          │
│                              Claude claude-sonnet-4-6           │
│                              (grounded answer)                  │
│                                      │                          │
│                              Answer + source pages              │
│                              (rendered via PDF.js)              │
└─────────────────────────────────────────────────────────────────┘
```

## Tech stack

| Layer | Tool |
|---|---|
| Web framework | Next.js (App Router) |
| UI | React + Tailwind CSS |
| Embedding model | `Xenova/all-MiniLM-L6-v2` via Transformers.js |
| Vector database | LanceDB |
| Language model | Claude claude-sonnet-4-6 (Anthropic SDK) |
| PDF parsing | Docling — layout-aware (Python, offline) |
| PDF rendering | PDF.js (client-side) |

## Project structure

```
cfs_ai/
├── public/
│   ├── CFS.pdf               # Source document
│   └── pdf.worker.mjs        # PDF.js worker
├── scripts/
│   ├── parse_cfs.py          # PDF → chunks.json (run once)
│   └── embed_chunks.mjs      # chunks.json → LanceDB (run once)
├── data/
│   ├── chunks.json           # Parsed aerodrome chunks
│   └── lancedb/              # Vector index
└── src/app/
    ├── api/chat/route.ts     # RAG endpoint (retrieval + Claude)
    ├── components/
    │   └── PDFPageViewer.tsx # PDF page renderer
    └── page.tsx              # Chat UI
```

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Add your Anthropic API key to `.env.local`:
   ```
   ANTHROPIC_API_KEY=sk-ant-...
   ```

3. If regenerating the index from a new CFS PDF, run the offline scripts once:
   ```bash
   python scripts/parse_cfs.py
   node scripts/embed_chunks.mjs
   ```

4. Start the dev server:
   ```bash
   npm run dev
   ```

The app will be available at `http://localhost:3000`.
