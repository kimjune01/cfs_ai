# CFS/AI — Codebase Overview

AI-powered Q&A assistant for Canadian pilots. Answers questions about the Canadian Flight Supplement (CFS) — NavCanada's official aerodrome reference for British Columbia airports.

Pilots ask questions like "What's the circuit altitude at CYVR?" and the app retrieves accurate answers from the CFS PDF.

## Tech Stack

| Layer        | Tech                                              |
| ------------ | ------------------------------------------------- |
| Framework    | Next.js (App Router) + React 19, TypeScript       |
| Styling      | Tailwind CSS 4                                    |
| LLM          | Claude Sonnet via Claude Code CLI (keychain auth) |
| Vector DB    | LanceDB + Transformers.js (all-MiniLM-L6-v2)      |
| PDF (client) | PDF.js                                            |
| PDF (server) | Poppler (pdftotext, pdftoppm)                     |

## Core Architecture — Hybrid Agentic RAG

Pipeline in `src/lib/agentLoop.ts`:

1. **Evaluator** — infers or validates ICAO code, rejects non-BC / off-topic questions, loops with clarifying questions until unambiguous. Hands off a synthesized self-contained question.
2. **Query rewriting** — Claude optimizes the resolved question for vector search
3. **Vector search** — LanceDB ANN + ICAO keyword matching (confidence threshold: 0.72)
4. **Decision** — answers directly if results are sufficient; escalates to vision if confidence is low, field label doesn't match, or pilot is repeating/doubting a previous answer
5. **Vision escalation** — PDF pages rendered as images, Claude reads them for ground truth

## Key Files

| File                                   | Role                                                                        |
| -------------------------------------- | --------------------------------------------------------------------------- |
| `src/lib/agentLoop.ts`                 | Pipeline orchestration: `runVectorSearch`, `runDecision`, `runVisionSearch` |
| `src/lib/evaluator.ts`                 | ICAO inference, BC scope check, clarification loop                          |
| `src/lib/prompts.ts`                   | All Claude system prompts (evaluator, decision, vision)                     |
| `src/lib/agentTools.ts`                | Query logic: ICAO extraction, search term rephrasing, vector formatting     |
| `src/lib/vectorSearch.ts`              | LanceDB hybrid search subprocess wrapper                                    |
| `src/lib/visionSearch.ts`              | PDF vision pipeline (pdftotext → pdftoppm → Claude)                         |
| `src/lib/utils/claudeUtils.ts`         | Claude subprocess wrapper (`runClaude`, `parseJsonStringArray`)             |
| `src/lib/utils/pdfUtils.ts`            | PDF I/O: text extraction, page clustering, image rendering                  |
| `src/lib/utils/processUtils.ts`        | Shared: CLAUDE_BIN, claudeEnv, attachAbort                                  |
| `src/app/utils/traceLabels.ts`         | `traceLabel` (live status) and `eventLabel` (trace panel)                   |
| `src/lib/types.ts`                     | Turn, TraceEvent, VectorChunk, AgentResult types                            |
| `src/app/api/chat/route.ts`            | POST endpoint, streams NDJSON trace events                                  |
| `src/app/page.tsx`                     | Chat UI                                                                     |
| `src/app/components/AgentTrace.tsx`    | Collapsible trace panel                                                     |
| `src/app/components/PDFPageViewer.tsx` | Canvas PDF renderer                                                         |
| `src/app/hooks/useAgentStream.ts`      | Client-side NDJSON stream consumer                                          |
| `scripts/cfs_search.mjs`               | Vector search CLI (spawned per request)                                     |
| `scripts/embed_chunks.mjs`             | One-time: chunks.json → LanceDB index                                       |
| `scripts/parse_cfs.py`                 | One-time: PDF → chunks.json (via docling)                                   |
| `data/chunks.json`                     | ~1000 parsed aerodrome entries                                              |
| `data/lancedb/`                        | Vector index                                                                |
| `public/CFS.pdf`                       | Source NavCanada CFS document                                               |

## Notable Patterns

- Claude invoked via **subprocess spawn** (not SDK) — forces macOS keychain OAuth, `ANTHROPIC_API_KEY` stripped from subprocess env
- **Streaming NDJSON** — client sees real-time trace events (`evaluating`, `vector_search`, `decision`, `vision_render`, `done`, etc.)
- **Client-side PDF** — shared PDF.js doc instance, lazy per-page rendering
- **Max history**: 10 turns (truncated to prevent prompt bloat)

## API

**POST /api/chat**

- Request: `{ question: string, history: Turn[] }`
- Response: streaming NDJSON trace events ending with `{ type: "done", answer: string, sourcePages: number[] }`
