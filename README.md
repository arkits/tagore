# Tagore

A self-hosted writing room where an AI co-author works **on your manuscript**, not in a chat. Write ideas in a chapter's notes, ask for a draft, and every change the agent proposes arrives as a tracked suggestion you accept or reject. That works for a single word or a whole chapter.

Stack: Bun · tRPC · React · shadcn/ui · Tailwind v4 · Drizzle + SQLite · TipTap · Vercel AI SDK (OpenRouter, Anthropic, OpenAI, or any OpenAI-compatible endpoint such as Ollama or LM Studio).

## Run it

```bash
bun install
bun run dev          # API on :3001, UI on http://localhost:5173
```

Open Settings (the sliders icon), add an OpenRouter key (or another provider), and pick a model from the switcher in the header. You can change the model at any time.

Production / self-host:

```bash
bun run build && bun run start   # serves UI + API on :3001 (TAGORE_PORT or PORT to change)
```

Data lives in `data/tagore.db` (override with `TAGORE_DB`). Keys can also come from `OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY` and `OPENAI_API_KEY`.

Offline UI development: `TAGORE_MOCK=1 bun run dev` adds a scripted **Mock writer** model.

## How long stories stay coherent

The agent never receives "the whole book" and never returns the whole document.

**Editing by diff.** Each top-level block in a chapter has a stable id. The model sees `[p:ab12cd34] text…` lines and can only call `replace_text` (an exact phrase in one block), `rewrite_block`, `insert_after` and `delete_blocks`. Each call is validated against the saved chapter: the block must exist, the phrase must be unique, and each block gets one edit per run. Valid calls are stored as suggestions and rendered as inline tracked changes. Accepting one re-finds its block by id, so the suggestion stays correct while you keep writing elsewhere. Once its target text changes, it's flagged as outdated.

**Layered, budgeted context** (based on SillyTavern's prompt building, adapted to documents). See `src/server/ai/context.ts`:

| Layer | When included |
|---|---|
| Story bible: premise, style guide | always |
| Characters: full card if pinned or mentioned near the focus, otherwise a one-line roster entry | scanned |
| Lorebook ("World Info"): always-on entries, plus keyword/regex-triggered ones with one level of recursion | scanned, about 12% of budget |
| Summaries of other chapters: nearest ones in full, distant ones compressed | about 15% of budget |
| Ending of the previous chapter, word for word | about 6% of budget |
| Current chapter: notes plus every block, or a window around the cursor or selection if it's too big | the rest |
| Recent agent log for the chapter, then the author's note and instruction, closest to generation | always |

Chapter summaries regenerate automatically before a run when a chapter has changed since its summary was made (you can set a cheaper "summary model"). The agent can also call `read_blocks`, `read_chapter` and `search_manuscript` to pull in more on demand. To see the exact prompt, click **What the agent sees** in the agent panel.

## Characters

Characters use the Character Card V2 format (`chara_card_v2`). Import PNG cards (from the `chara`/`ccv3` tEXt chunk) or JSON cards from SillyTavern, Chub, etc. Export as JSON, or as PNG when the character has a PNG portrait. A card's embedded `character_book` entries are used like project lore. `{{char}}`/`{{user}}` macros are expanded.

## Tests

```bash
bun test
```
