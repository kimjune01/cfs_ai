@AGENTS.md

## Starting a new session

Read `research.md` first. It has the full architectural overview, key file index, and notable patterns — everything needed to orient without exploring the codebase.

## Commands

```bash
npm run dev          # dev server at http://localhost:3000
npm run eval         # run all 13 golden Q&A eval cases
```

## Conventions

- Pure utilities (no domain logic) go in `src/lib/utils/` or `src/app/utils/`. Domain modules stay at the `src/lib/` level.
- Do not set `ANTHROPIC_API_KEY` — the app uses Claude Code keychain auth. Setting it will break subprocess auth.

## Before committing or pushing

Update `README.md` and `research.md` to reflect any changes before creating a commit or push.
