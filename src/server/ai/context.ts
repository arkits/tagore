/**
 * Context assembly for the story agent.
 *
 * The model never gets "the whole book". It gets a budgeted, layered view, modelled on
 * SillyTavern's prompt construction but adapted to documents:
 *
 *   1. Story bible (premise, style guide)                       — always
 *   2. Cast: full cards for pinned/mentioned characters,
 *      one-line roster entries for everyone else                — scanned
 *   3. Lorebook: constant + keyword-triggered entries            — scanned, budgeted
 *   4. Story so far: rolling summaries of other chapters         — budgeted, oldest compressed first
 *   5. Tail of the previous chapter (verbatim, for continuity)   — budgeted
 *   6. Current chapter: notes + blocks with ids; windowed
 *      around the focus when the chapter is too big              — remainder of budget
 *   7. Recent agent log for this chapter
 *   8. Author's note + the instruction (closest to generation)
 *
 * Every section reports its token cost so the UI can show what the model saw.
 */
import { and, asc, eq, ne } from "drizzle-orm";
import { db, schema } from "../db";
import {
  CONTEXT_MESSAGES,
  blockPlain,
  blockToLine,
  docToBlocks,
  estimateTokens,
  plainText,
  type Block,
  type StoryFormat,
} from "../../shared/doc";
import { expandMacros, type CardData } from "../../shared/character";

export type AgentMode = "draft" | "continue" | "reply" | "revise" | "polish" | "custom";

export type ContextRequest = {
  chapterId: string;
  instruction: string;
  mode: AgentMode;
  /** Block ids covered by the user's selection, in order. */
  selectionIds?: string[];
  /** The exact text the author highlighted (may be part of a paragraph). */
  selectionText?: string;
  /** Block the cursor is in (used to centre the window on big chapters). */
  focusId?: string | null;
  budget: number;
};

export type ContextSection = { name: string; tokens: number; detail?: string };

export type BuiltContext = {
  system: string;
  prompt: string;
  sections: ContextSection[];
  totalTokens: number;
  blocks: Block[];
  project: typeof schema.projects.$inferSelect;
  chapter: typeof schema.chapters.$inferSelect;
  /** Which blocks were shown verbatim (agent may only edit those it has seen, or read more first). */
  visibleIds: Set<string>;
};

/* ----------------------------------------------------------------- matching */

function keyMatches(key: string, haystack: string, caseSensitive = false): boolean {
  const k = key.trim();
  if (!k) return false;
  const rx = /^\/(.+)\/([a-z]*)$/.exec(k);
  try {
    if (rx) return new RegExp(rx[1]!, rx[2]!.replace(/g/g, "")).test(haystack);
    const esc = k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^\\p{L}\\p{N}])${esc}($|[^\\p{L}\\p{N}])`, caseSensitive ? "u" : "iu").test(haystack);
  } catch {
    return haystack.toLowerCase().includes(k.toLowerCase());
  }
}

/* ----------------------------------------------------------------- sections */

function formatCard(c: CardData): string {
  const n = c.name;
  const parts = [`### ${n}${c.nickname ? ` (“${c.nickname}”)` : ""}`];
  if (c.description) parts.push(expandMacros(c.description, n));
  if (c.personality) parts.push(`Personality: ${expandMacros(c.personality, n)}`);
  if (c.scenario) parts.push(`Situation: ${expandMacros(c.scenario, n)}`);
  const voice = [c.mes_example, c.first_mes].filter(Boolean).join("\n");
  if (voice) parts.push(`Voice samples:\n${expandMacros(voice, n).replace(/<START>/gi, "").trim().slice(0, 2400)}`);
  return parts.join("\n");
}

function rosterLine(c: CardData): string {
  const first = plainText(expandMacros(c.description || c.personality || "", c.name))
    .split(/(?<=[.!?])\s/)[0]
    ?.slice(0, 160);
  return `- ${c.name}${first ? ` — ${first}` : ""}`;
}

function takeWithinBudget<T>(items: T[], cost: (t: T) => number, budget: number): { kept: T[]; dropped: number } {
  const kept: T[] = [];
  let used = 0;
  let dropped = 0;
  for (const it of items) {
    const c = cost(it);
    if (used + c > budget) {
      dropped++;
      continue;
    }
    kept.push(it);
    used += c;
  }
  return { kept, dropped };
}

/** Pick a contiguous window of blocks around the focus that fits the budget. */
function windowBlocks(blocks: Block[], focusIdx: number, budget: number): { from: number; to: number } {
  const cost = blocks.map((b) => estimateTokens(blockToLine(b)) + 1);
  let from = Math.max(0, Math.min(focusIdx, blocks.length - 1));
  let to = from;
  let used = cost[from] ?? 0;
  // Grow mostly backwards (what came before matters most for continuation), 2:1.
  let turn = 0;
  while (true) {
    const canBack = from > 0 && used + cost[from - 1]! <= budget;
    const canFwd = to < blocks.length - 1 && used + cost[to + 1]! <= budget;
    if (!canBack && !canFwd) break;
    if (canBack && (turn % 3 !== 2 || !canFwd)) used += cost[--from]!;
    else if (canFwd) used += cost[++to]!;
    turn++;
  }
  return { from, to };
}

/* -------------------------------------------------------------------- build */

export function buildContext(req: ContextRequest): BuiltContext {
  const chapter = db.select().from(schema.chapters).where(eq(schema.chapters.id, req.chapterId)).get();
  if (!chapter) throw new Error("Chapter not found");
  const project = db.select().from(schema.projects).where(eq(schema.projects.id, chapter.projectId)).get()!;
  const allChapters = db
    .select()
    .from(schema.chapters)
    .where(eq(schema.chapters.projectId, project.id))
    .orderBy(asc(schema.chapters.position))
    .all();
  const blocks = docToBlocks(chapter.content);
  const B = req.budget;
  const sections: ContextSection[] = [];
  const out: string[] = [];
  const add = (name: string, body: string, detail?: string) => {
    if (!body.trim()) return;
    out.push(body.trim());
    sections.push({ name, tokens: estimateTokens(body), detail });
  };

  /* ---- focus + scan text (what lore/characters get triggered by) ---- */
  const idxById = new Map(blocks.map((b, i) => [b.id, i]));
  const selIdx = (req.selectionIds ?? []).map((id) => idxById.get(id)).filter((i): i is number => i !== undefined);
  let focusIdx =
    selIdx.length > 0
      ? selIdx[0]!
      : req.focusId && idxById.has(req.focusId)
        ? idxById.get(req.focusId)!
        : blocks.length - 1;
  if (req.mode === "continue" || req.mode === "draft") focusIdx = blocks.length - 1;

  const curIdx = allChapters.findIndex((c) => c.id === chapter.id);
  const prev = curIdx > 0 ? allChapters[curIdx - 1] : undefined;
  const prevBlocks = prev ? docToBlocks(prev.content) : [];
  const prevTail = (() => {
    let s = "";
    for (let i = prevBlocks.length - 1; i >= 0 && s.length < 6000; i--) s = blockPlain(prevBlocks[i]!) + "\n" + s;
    return s.trim();
  })();

  const nearFocus = blocks
    .slice(Math.max(0, focusIdx - 25), focusIdx + 10)
    .map(blockPlain)
    .join("\n");
  const scan = [req.instruction, chapter.notes, chapter.title, nearFocus, prevTail.slice(-2000), project.authorsNote].join("\n");

  /* ---- 1. story bible ---- */
  const bible = [
    `# ${project.title}`,
    `Format: ${project.format === "chat" ? "chat story: told entirely as a message thread" : "prose fiction"}`,
    project.format === "chat" && `Whose screen this is (their messages are "me"): ${project.pov || "unspecified — pick the protagonist"}`,
    project.premise && `## Premise\n${project.premise}`,
    project.styleGuide && `## Style guide\n${project.styleGuide}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  add("Story bible", `<story_bible>\n${bible}\n</story_bible>`);

  /* ---- 2. cast ---- */
  const cast = db
    .select({ c: schema.characters, pinned: schema.projectCharacters.pinned })
    .from(schema.projectCharacters)
    .innerJoin(schema.characters, eq(schema.characters.id, schema.projectCharacters.characterId))
    .where(eq(schema.projectCharacters.projectId, project.id))
    .all();

  const full: CardData[] = [];
  const roster: CardData[] = [];
  const bookEntries: { name: string; content: string; order: number; constant: boolean; keys: string[]; cs: boolean }[] = [];
  for (const { c, pinned } of cast) {
    const card = c.card;
    const names = [card.name, card.nickname, ...card.name.split(/\s+/).filter((p) => p.length > 2)].filter(Boolean) as string[];
    const mentioned = names.some((n) => keyMatches(n, scan));
    (pinned || mentioned || req.mode === "reply" ? full : roster).push(card);
    for (const e of card.character_book?.entries ?? []) {
      if (!e.enabled) continue;
      bookEntries.push({
        name: `${card.name}: ${e.name ?? e.comment ?? e.keys[0] ?? "entry"}`,
        content: expandMacros(e.content, card.name),
        order: e.insertion_order ?? 100,
        constant: !!e.constant,
        keys: e.keys,
        cs: !!e.case_sensitive,
      });
    }
  }
  if (full.length || roster.length) {
    const castBudget = Math.floor(B * 0.15);
    const fullFit = takeWithinBudget(full, (c) => estimateTokens(formatCard(c)), castBudget);
    const body = [
      fullFit.kept.map(formatCard).join("\n\n"),
      roster.length || fullFit.dropped
        ? `### Others in the cast\n${[...roster, ...full.filter((c) => !fullFit.kept.includes(c))].map(rosterLine).join("\n")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n\n");
    add("Characters", `<characters>\n${body}\n</characters>`, `${fullFit.kept.length} full, ${cast.length - fullFit.kept.length} roster`);
  }

  /* ---- 3. lorebook ---- */
  const lore = db
    .select()
    .from(schema.loreEntries)
    .where(and(eq(schema.loreEntries.projectId, project.id), eq(schema.loreEntries.enabled, true)))
    .all()
    .map((e) => ({ name: e.name, content: e.content, order: e.insertionOrder, constant: e.constant, keys: e.keys, cs: false }));
  const candidates = [...lore, ...bookEntries];
  let active = candidates.filter((e) => e.constant || e.keys.some((k) => keyMatches(k, scan, e.cs)));
  // One level of recursion: activated entries can trigger others.
  const recurseScan = active.map((e) => e.content).join("\n");
  active = [...active, ...candidates.filter((e) => !active.includes(e) && e.keys.some((k) => keyMatches(k, recurseScan, e.cs)))];
  if (active.length) {
    // Constants first, then by insertion order; budget drops the rest.
    active.sort((a, b) => Number(b.constant) - Number(a.constant) || a.order - b.order);
    const { kept, dropped } = takeWithinBudget(active, (e) => estimateTokens(e.content) + 8, Math.floor(B * 0.12));
    kept.sort((a, b) => a.order - b.order);
    add(
      "Lorebook",
      `<world_info>\n${kept.map((e) => `[${e.name}]\n${e.content}`).join("\n\n")}\n</world_info>`,
      `${kept.length} active${dropped ? `, ${dropped} over budget` : ""}`,
    );
  }

  /* ---- 4. story so far (summaries) ---- */
  const others = allChapters.filter((c) => c.id !== chapter.id);
  if (others.length) {
    const sumBudget = Math.floor(B * 0.15);
    const entry = (c: (typeof allChapters)[number], short: boolean) => {
      const stale = c.summaryHash !== c.contentHash && c.wordCount > 0;
      let s = c.summary || (c.wordCount ? "(not yet summarized)" : "(empty)");
      if (short) s = s.split(/(?<=[.!?])\s/).slice(0, 2).join(" ");
      return `## ${c.title}${c.position < chapter.position ? "" : " (comes later)"}${stale ? " [summary may be outdated]" : ""}\n${s}`;
    };
    // Nearest chapters keep full summaries; distant ones get compressed first.
    const ordered = [...others].sort(
      (a, b) => Math.abs(a.position - chapter.position) - Math.abs(b.position - chapter.position),
    );
    const chosen = new Map<string, string>();
    let used = 0;
    for (const c of ordered) {
      let e = entry(c, false);
      if (used + estimateTokens(e) > sumBudget) e = entry(c, true);
      if (used + estimateTokens(e) > sumBudget) continue;
      chosen.set(c.id, e);
      used += estimateTokens(e);
    }
    const body = others.filter((c) => chosen.has(c.id)).map((c) => chosen.get(c.id)).join("\n\n");
    add(
      "Chapter summaries",
      `<story_so_far>\nOther chapters (ids usable with read_chapter): ${others.map((c) => `${c.title} = ${c.id}`).join("; ")}\n\n${body}\n</story_so_far>`,
      `${chosen.size}/${others.length} chapters`,
    );
  }

  /* ---- 5. previous chapter tail ---- */
  if (prev && prevTail) {
    const tail = prevTail.slice(-Math.floor(B * 0.06) * 4);
    add("Previous chapter ending", `<previous_chapter_ending title="${prev.title}">\n…${tail}\n</previous_chapter_ending>`);
  }

  /* ---- 7. agent log (computed before 6 so the doc gets what's left) ---- */
  const log = db
    .select()
    .from(schema.agentMessages)
    .where(eq(schema.agentMessages.chapterId, chapter.id))
    .orderBy(asc(schema.agentMessages.createdAt))
    .all()
    .slice(-CONTEXT_MESSAGES);
  const logText = log.length
    ? `<recent_session>\n${log.map((m) => `${m.role === "user" ? "Author" : "You"}: ${m.content.slice(0, 600)}`).join("\n")}\n</recent_session>`
    : "";

  /* ---- 8. author's note + instruction ---- */
  const tail = buildInstruction(req, project.format, blocks, project.authorsNote, project.pov.trim());

  /* ---- 6. current chapter ---- */
  const usedSoFar = sections.reduce((n, s) => n + s.tokens, 0) + estimateTokens(logText) + estimateTokens(tail) + 1800;
  const docBudget = Math.max(2000, B - usedSoFar);
  const visibleIds = new Set<string>();
  let chapterBody: string;
  if (!blocks.length || (blocks.length === 1 && !blocks[0]!.text)) {
    if (blocks[0]) visibleIds.add(blocks[0].id);
    chapterBody = blocks[0]
      ? `(The chapter is empty. Its only block is an empty paragraph [p:${blocks[0].id}] — use rewrite_block on it, or insert_after with after_id "START".)`
      : `(The chapter is empty. Use insert_after with after_id "START".)`;
  } else {
    const all = blocks.map(blockToLine).join("\n");
    if (estimateTokens(all) <= docBudget) {
      chapterBody = all;
      blocks.forEach((b) => visibleIds.add(b.id));
    } else {
      const { from, to } = windowBlocks(blocks, focusIdx, docBudget);
      const lines: string[] = [];
      if (from > 0)
        lines.push(
          `[… ${from} earlier blocks omitted (first id ${blocks[0]!.id}). Use read_blocks to see them before editing there.]`,
        );
      for (let i = from; i <= to; i++) {
        lines.push(blockToLine(blocks[i]!));
        visibleIds.add(blocks[i]!.id);
      }
      if (to < blocks.length - 1)
        lines.push(`[… ${blocks.length - 1 - to} later blocks omitted. Use read_blocks to see them.]`);
      chapterBody = lines.join("\n");
    }
  }
  const notes = chapter.notes.trim() ? `<chapter_notes>\n${chapter.notes.trim()}\n</chapter_notes>\n\n` : "";
  const docSection = `${notes}<chapter id="${chapter.id}" title="${chapter.title}" blocks="${blocks.length}" words="${chapter.wordCount}">\n${chapterBody}\n</chapter>`;
  add("Current chapter", docSection, visibleIds.size < blocks.length ? `${visibleIds.size}/${blocks.length} blocks (windowed)` : `${blocks.length} blocks`);

  if (logText) add("Session log", logText, `${log.length} messages`);
  add("Instruction", tail);

  const system = systemPrompt(project.format);
  const prompt = out.join("\n\n");
  sections.unshift({ name: "System prompt", tokens: estimateTokens(system) });
  return {
    system,
    prompt,
    sections,
    totalTokens: sections.reduce((n, s) => n + s.tokens, 0),
    blocks,
    project,
    chapter,
    visibleIds,
  };
}

function buildInstruction(req: ContextRequest, format: StoryFormat, blocks: Block[], authorsNote: string, pov: string): string {
  const parts: string[] = [];
  if (authorsNote.trim()) parts.push(`<authors_note>\n${authorsNote.trim()}\n</authors_note>`);
  const quoted = req.selectionText?.trim();
  const sel = req.selectionIds?.length
    ? `\nThe author has selected ${quoted ? `this text${quoted.length > 1500 ? " (truncated)" : ""}:\n«${quoted.slice(0, 1500)}»\nin` : ""} block${req.selectionIds.length > 1 ? "s" : ""} ${req.selectionIds.map((i) => `[p:${i}]`).join(", ")}. Confine edits to the selected text${quoted ? " (prefer replace_text on exactly that span)" : ""} unless told otherwise.`
    : "";
  const last = blocks.at(-1);
  const modeText: Record<AgentMode, string> = {
    draft:
      format === "chat"
        ? `Write this part of the story as a message thread, from the chapter notes (the author's ideas & beats) and any direction. Build on any existing messages. Insert with insert_after (after_id "START" or the last block id${last ? ` — currently ${last.id}` : ""}). Write in batches of roughly 15–40 messages per insert_after call, continuing with after_id "LAST".`
        : `Draft this chapter from the chapter notes (the author's ideas & beats) and any direction. Write complete, polished prose. If the chapter already has text, build on it rather than replacing it. Insert with insert_after (after_id "START" or the last block id${last ? ` — currently ${last.id}` : ""}). Split long drafts into several insert_after calls of roughly 400–900 words each, each continuing after the previous one (use "LAST" as after_id to append after your previous insert).`,
    continue:
      format === "chat"
        ? `Continue the conversation from where it ends${last ? ` (after [p:${last.id}])` : ""}. Reply in character as the other participants — and as the screen's owner too if the scene calls for it — keeping each person's texting voice. Usually 3–15 messages. Use insert_after.`
        : `Continue the chapter from where it ends${last ? ` (after [p:${last.id}])` : ""}. Match voice and tense exactly. Use insert_after.`,
    reply: `Reply to the latest message as the other participant(s), in character. Use insert_after with after_id "LAST" and write one to three messages. Use the character’s nickname as the sender if they have one. Never speak as the phone’s owner (${pov || "Me"}), write narration, or add timestamps.`,
    revise: `Rewrite according to the author's direction — content, tone, length or events may change as asked.${sel} Prefer the smallest edit that achieves the goal: replace_text for phrase-level changes, rewrite_block only when most of a paragraph changes.`,
    polish: `Line-edit for prose quality: rhythm, clarity, word choice, redundancy, clichés, continuity errors. Do NOT change plot or meaning. Use one replace_text call per block, combining fixes into a single exact span with a short reason.${sel}`,
    custom: `Carry out the author's request.${sel} Use the edit tools for any change to the manuscript; answer in plain text if they only asked a question.`,
  };
  parts.push(`<task>\n${modeText[req.mode]}\n</task>`);
  if (req.instruction.trim()) parts.push(`<author_request>\n${req.instruction.trim()}\n</author_request>`);
  return parts.join("\n\n");
}

function systemPrompt(format: StoryFormat): string {
  const chat = format === "chat";
  return `You are Tagore, a skilled co-author working inside a manuscript editor. You collaborate with the author on a long-form ${chat ? "chat story — fiction told entirely through a message thread between characters" : "work of fiction"}.

HOW THE MANUSCRIPT WORKS
- The current chapter is shown as blocks, one per line: "[p:<id>] text". Ids are stable; never invent ids. For tool arguments, pass only the raw id: for "[p:abc123] text", use "abc123".
- Inline formatting uses *italic* and **bold**. Headings start with "#", "##". A line "***" is a scene break.${
    chat
      ? `
- This is a CHAT story. Every message is one block written as "{Sender Name} message text", e.g. "{Mara} you up?". Always include the {Sender} prefix, spelled exactly as the cast names appear.
- A block without a {Sender} prefix is a system line shown centred in the thread (e.g. "Mara changed the group name to 'lighthouse'", "Missed voice call", "Read 2:14 AM"). Use them sparingly.
- A "## heading" is a timestamp divider in the thread (e.g. "## Tuesday 11:42 PM"). Use one when time passes.
- Write like people really text: short messages, several in a row, fragments, typos only where in character, emoji and punctuation as each person would use them. Story is carried by what they say, what they avoid saying, and timing — no prose narration.`
      : ""
  }
- You NEVER rewrite the whole document. You propose targeted edits with tools. Each edit becomes a tracked suggestion the author accepts or rejects.

EDIT TOOLS
- replace_text: change an exact phrase inside one block. "find" must be copied character-for-character from that block and be unique within it. Best for small fixes.
- rewrite_block: replace one block entirely (text may contain several lines → several paragraphs).
- insert_after: add new blocks after a block id ("START" = top of chapter, "LAST" = after your previous insert in this run).
- delete_blocks: remove blocks.
- Each block may receive only one edit per run; combine changes to the same block.
- Read-only: read_blocks (parts of this chapter hidden by the context window), read_chapter (another chapter's full text), search_manuscript (find where something was mentioned).

CRAFT
- Honour the story bible, style guide, characters and world info. Keep continuity with the summaries and the previous chapter.
- ${chat ? "Distinct texting voices per character. Subtext, tension and reveals through dialogue and timing. No narration." : "Show, don't summarise. Specific sensory detail, subtext, distinct character voices."} Avoid purple prose, clichés, and tidy moralising endings.
- Don't re-narrate events that already happened. Don't end chapters on a summary.

After editing, reply with ONE or TWO short sentences telling the author what you did (not the text itself). If the request is ambiguous, make a sensible choice and say what you chose.`;
}

/** All chapters in the project except the given one (for summaries). */
export function otherChapters(projectId: string, exceptId: string) {
  return db
    .select()
    .from(schema.chapters)
    .where(and(eq(schema.chapters.projectId, projectId), ne(schema.chapters.id, exceptId)))
    .orderBy(asc(schema.chapters.position))
    .all();
}
