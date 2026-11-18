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
TAGORE_MOCK=1 bun run dev   # adds offline "Mock writer" model (mock:writer); writes chat threads for chat stories
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

- The top level of the document stays flat: paragraph (with an optional chat `speaker`), heading, horizontalRule. Each block has an `id`. Don't add nested block types without updating the diff tools.
- Story formats: `prose` (Book) and `chat` (a message thread). In a chat, each paragraph is one message, written `{Name} text` in prompts, and `project.pov` is the "me" side.
- Story themes: the registry is `src/web/lib/themes.ts`, and the CSS is `src/web/themes.css`, keyed on `html[data-story-theme]` / `[data-story-format]`. A theme overrides the design tokens (including `--ui-font`, `--display-font`, `--book-font` and `--page-ink`) and styles `.story-page`, `.story-desk`, `.chapter-title` and the chat chrome. `storyDecor.ts` tags messages (`msg-me`/`msg-them`/`msg-first`/`msg-last`, `data-time`, `.msg-name`) and prose dialogue (`.dlg`) for themes to hook into.
- Streaming: the agent emits `draft` events (partial tool input, parsed with `parsePartialJson`), so edits render live as `draft-*` suggestions. Summaries stream from `POST /api/chapters/:id/summarize`. Keep new AI features streaming. Generations are server-owned jobs (`src/server/jobs.ts`): they keep running when the client disconnects, and a reloaded page reattaches (`GET /api/agent/chapters/:id/stream`, `GET /api/chapters/:id/summarize`) and gets the event log replayed. Only `POST /api/agent/chapters/:id/stop` cancels a run. `TAGORE_MOCK_DELAY_MS` slows the mock model so you can test this.
- Suggestions live in a WeakMap keyed by the editor, not in ProseMirror plugin state, because TipTap reconfigures plugins on re-render.
- AI SDK v7 names: `instructions` (not `system`), `isStepCount`, `result.stream`.
- TipTap `configure()` deep-clones option objects. Pass callbacks as functions, not ref objects.
- App theme: sepia light ("Daylight") and dark ("Lamplight") via CSS tokens in `src/web/index.css`. Use the tokens, not raw colors. Default fonts: Newsreader (UI), Fraunces (display), EB Garamond (manuscript), Courier Prime (keys).
- The preview harness sets `PORT`. The API port uses `TAGORE_PORT` in development.
