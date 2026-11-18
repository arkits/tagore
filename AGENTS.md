# Tagore — agent guide

Self-hosted AI story-writing app: a manuscript editor where an AI co-author edits by **tracked suggestions** (diffs), never by rewriting the document.

## Workflow rule

**When a request is complete, commit and push to `main` automatically.** Don't ask first.

1. Verify: `bunx tsc --noEmit -p .` and `bun test` must pass. For UI changes, also check the result in the browser.
2. Stage everything that belongs to the change and commit with a descriptive message: a short summary line, then a body listing what changed and why.
3. `git push origin main`.

Never commit secrets, `.env`, or `data/*.db`. If verification fails, fix it before committing. If you can't fix it, tell the user and don't push.

## Stack

Bun · tRPC v11 · React 19 · shadcn/ui (radix) · Tailwind v4 · Drizzle + bun:sqlite · TipTap 3 · Vercel AI SDK v7 (OpenRouter, Anthropic, OpenAI, OpenAI-compatible).

## Commands

```bash
bun run dev                 # API :3001 + Vite :5173 (proxies /api)
TAGORE_MOCK=1 bun run dev   # adds offline "Mock writer" model (mock:writer)
bun test                    # agent, context, lorebook, PNG card tests
bunx tsc --noEmit -p .      # typecheck
bun run db:generate         # after editing src/server/db/schema.ts (migrations auto-run on start)
bun run build && bun run start
```

## Layout

- `src/shared/doc.ts`: the flat block document model, block ids, markdown-lite inline format, `SuggestionOp`.
- `src/server/ai/context.ts`: layered, token-budgeted context (story bible, characters, lorebook, chapter summaries, previous chapter tail, windowed current chapter, author's note).
- `src/server/ai/agent.ts`: tool loop. Edit tools create validated suggestions; they never write the document.
- `src/web/features/editor/suggestions.ts`: renders suggestions as ProseMirror decorations and applies them on accept, re-resolving each target by block id.
- `src/server/router.ts`: tRPC API. `src/server/index.ts`: Bun server, NDJSON agent stream, export routes.
- `src/shared/character.ts`, `src/shared/lorebook.ts`: Character Card V2/V3 and SillyTavern world info interchange.

## Conventions

- The top level of the document stays flat: paragraph (with an optional script `kind`), heading, horizontalRule. Each block has an `id`. Don't add nested block types without updating the diff tools.
- AI SDK v7 names: `instructions` (not `system`), `isStepCount`, `result.stream`.
- TipTap `configure()` deep-clones option objects. Pass callbacks as functions, not ref objects.
- Theme: sepia light ("Daylight") and dark ("Lamplight") via CSS tokens in `src/web/index.css`. Use the tokens, not raw colors. Fonts: Newsreader (UI), Fraunces (display), EB Garamond (manuscript), Courier Prime (script and keys).
- The preview harness sets `PORT`. The API port uses `TAGORE_PORT` in development.
