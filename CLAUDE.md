@AGENTS.md

## Starting a new session

Read `research.md` first. It has the full architectural overview, key file index, and notable patterns — everything needed to orient without exploring the codebase.

## Conventions

- File names must use camelCase (e.g. `agentLoop.ts`), not hyphens (e.g. ~~`agent-loop.ts`~~).
- All exports must be grouped at the end of the file as named exports: `export { name1, name2 }`. Do not use inline `export` on declarations.
- Use arrow function style: `const foo = () => {}`. Do not use `function` declarations.

## Before committing or pushing

Update `README.md` and `research.md` to reflect any changes before creating a commit or push.

## After every change

Run lint and format before considering any change done:

```bash
npm run lint && npm run format
```
