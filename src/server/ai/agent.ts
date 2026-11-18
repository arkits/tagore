/**
 * The story agent: a tool-calling loop whose edit tools emit *suggestions*, never direct writes.
 *
 * Suggestions are validated against the saved chapter at creation time (block exists, `find` is
 * unique, one edit per block per run), stored in SQLite, and streamed to the editor which renders
 * them inline as tracked changes. Accepting one applies it in the editor (re-resolving the block by
 * id, so positions are never stale) and the editor saves.
 */
import { isStepCount, parsePartialJson, streamText, tool } from "ai";
import { z } from "zod";
import { and, asc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, schema } from "../db";
import { blockPlain, blockToLine, docToBlocks, plainText, textToBlocks, type NewBlock, type SuggestionOp } from "../../shared/doc";
import { buildContext, otherChapters, type AgentMode } from "./context";
import { getModelInfo, getModel } from "./providers";
import { summarizeChapter } from "./summarize";
import { getSettings } from "../settings";

export type RunRequest = {
  chapterId: string;
  instruction: string;
  mode: AgentMode;
  selectionIds?: string[];
  selectionText?: string;
  focusId?: string | null;
  model?: string;
  /** Ideas/beats typed with a Draft request; saved as the chapter's notes before the run. */
  beats?: string;
};

export type Suggestion = typeof schema.suggestions.$inferSelect;

export type AgentEvent =
  | { t: "status"; message: string }
  | { t: "context"; sections: { name: string; tokens: number; detail?: string }[]; total: number; budget: number; model: string }
  | { t: "text"; delta: string }
  | { t: "tool-start"; id: string; name: string }
  | { t: "tool-progress"; id: string; chars: number }
  /** Live preview of an edit while the model is still writing it (partial tool input). */
  | { t: "draft"; id: string; op: SuggestionOp; mergeInto?: string }
  | { t: "draft-end"; id: string }
  | { t: "tool-result"; id: string; name: string; ok: boolean; message: string }
  | { t: "suggestion"; suggestion: Suggestion }
  | { t: "suggestion-removed"; id: string }
  | { t: "error"; message: string }
  | { t: "done"; runId: string; elapsedMs: number; usage?: { inputTokens?: number; outputTokens?: number; estimatedCostUsd?: number } };

export async function runAgent(req: RunRequest, emit: (e: AgentEvent) => void, signal: AbortSignal) {
  const startedAt = performance.now();
  const settings = getSettings();
  const modelRef = req.model || settings.model;
  const model = getModel(modelRef, settings);
  const runId = nanoid(10);

  /* ---- 1. refresh stale summaries of other chapters (long-range memory) ---- */
  if (req.beats !== undefined && req.beats.trim())
    db.update(schema.chapters).set({ notes: req.beats.trim() }).where(eq(schema.chapters.id, req.chapterId)).run();
  const chapter = db.select().from(schema.chapters).where(eq(schema.chapters.id, req.chapterId)).get();
  if (!chapter) throw new Error("Chapter not found");
  const stale = otherChapters(chapter.projectId, chapter.id).filter(
    (c) => c.wordCount > 30 && c.summaryHash !== c.contentHash,
  );
  for (let i = 0; i < stale.length; i += 3) {
    const batch = stale.slice(i, i + 3);
    emit({ t: "status", message: `Summarizing ${batch.map((c) => `“${c.title}”`).join(", ")}…` });
    await Promise.all(
      batch.map((c) =>
        summarizeChapter(c.id, signal).catch((e) => emit({ t: "status", message: `Couldn't summarize “${c.title}”: ${e.message}` })),
      ),
    );
  }

  /* ---- 2. build the budgeted context ---- */
  const modelInfo = await getModelInfo(modelRef);
  const ctxLen = modelInfo?.contextLength;
  const budget = Math.max(4000, Math.min(settings.contextBudget, ctxLen ? Math.floor(ctxLen * 0.7) - 8000 : Infinity));
  const ctx = buildContext({ ...req, budget });
  emit({ t: "context", sections: ctx.sections, total: ctx.totalTokens, budget, model: modelRef });

  const userMsg = req.instruction.trim() || req.beats?.trim() || `(${req.mode})`;
  db.insert(schema.agentMessages)
    .values({ id: nanoid(), chapterId: chapter.id, runId, role: "user", content: `[${req.mode}] ${userMsg}` })
    .run();

  /* ---- 3. edit bookkeeping ---- */
  const blockById = new Map(ctx.blocks.map((b) => [b.id, b]));
  // Models sometimes copy the prompt's block label into a tool argument.
  const normalizeBlockId = (id: string) => {
    if (blockById.has(id)) return id;
    const label = /^(?:\[p:([^\[\]]+)\]|p:([^\[\]]+))$/.exec(id);
    return label?.[1] ?? label?.[2] ?? id;
  };
  const insertionAnchor = (id: string) => {
    if (id === "START") return null;
    if (id === "LAST") return ctx.blocks.at(-1)?.id ?? null;
    const blockId = normalizeBlockId(id);
    return blockById.has(blockId) ? blockId : undefined;
  };
  const touched = new Set<string>();
  let seq = 0;
  let lastInsert: { id: string; op: Extract<SuggestionOp, { op: "insert_after" }> } | null = null;

  // Earlier pending suggestions on the same block are superseded by new ones.
  const pendingByBlock = new Map<string, string[]>();
  for (const s of db
    .select()
    .from(schema.suggestions)
    .where(and(eq(schema.suggestions.chapterId, chapter.id), eq(schema.suggestions.status, "pending")))
    .all()) {
    const ids = s.op.op === "delete_blocks" ? s.op.blockIds : s.op.op === "insert_after" ? [] : [s.op.blockId];
    for (const id of ids) pendingByBlock.set(id, [...(pendingByBlock.get(id) ?? []), s.id]);
  }
  const supersede = (blockIds: string[]) => {
    for (const b of blockIds)
      for (const sid of pendingByBlock.get(b) ?? []) {
        db.update(schema.suggestions).set({ status: "rejected" }).where(eq(schema.suggestions.id, sid)).run();
        emit({ t: "suggestion-removed", id: sid });
      }
  };

  const liveDrafts = new Set<string>();
  const endDraft = (id: string) => {
    if (liveDrafts.delete(id)) emit({ t: "draft-end", id });
  };

  /** Turn a partially streamed tool input into a previewable op (or null if not yet resolvable). */
  const draftFor = (name: string, input: any): { op: SuggestionOp; mergeInto?: string } | null => {
    if (!input || typeof input !== "object") return null;
    const blockId = typeof input.block_id === "string" ? normalizeBlockId(input.block_id) : undefined;
    if (name === "insert_after" && typeof input.text === "string" && typeof input.after_id === "string") {
      const blocks = textToBlocks(input.text);
      if (!blocks.length) return null;
      const afterId = insertionAnchor(input.after_id);
      if (afterId === undefined) return null;
      if (lastInsert && (input.after_id === "LAST" || (afterId !== null && afterId === lastInsert.op.afterId)))
        return { op: { ...lastInsert.op, blocks: [...lastInsert.op.blocks, ...blocks] }, mergeInto: lastInsert.id };
      return { op: { op: "insert_after", afterId, blocks } };
    }
    if (name === "rewrite_block" && typeof input.text === "string" && blockId && blockById.has(blockId)) {
      const blocks = textToBlocks(input.text);
      return blocks.length ? { op: { op: "replace_block", blockId, blocks } } : null;
    }
    if (name === "replace_text" && typeof input.replace === "string" && typeof input.find === "string" && blockId && blockById.has(blockId)) {
      const find = plainText(input.find);
      if (!find || !plainText(blockById.get(blockId)!.text).includes(find)) return null;
      return { op: { op: "replace_text", blockId, find, replace: input.replace } };
    }
    return null;
  };

  const create = (op: SuggestionOp, note: string) => {
    const row = db
      .insert(schema.suggestions)
      .values({ id: nanoid(10), chapterId: chapter.id, runId, op, note, seq: seq++ })
      .returning()
      .get();
    emit({ t: "suggestion", suggestion: row });
    return row;
  };

  const claim = (ids: string[]): string | null => {
    for (const id of ids) {
      if (!blockById.has(id)) return `Block ${id} does not exist in this chapter. Use ids exactly as shown, e.g. "${ctx.blocks[0]?.id ?? "…"}".`;
      if (touched.has(id)) return `Block ${id} already has an edit in this run. Combine all changes to one block into a single edit.`;
    }
    ids.forEach((id) => touched.add(id));
    supersede(ids);
    return null;
  };

  const parseBlocks = (text: string): NewBlock[] => {
    const b = textToBlocks(text);
    if (!b.length) throw new Error("No text given.");
    return b;
  };

  /* ---- 4. tools ---- */
  const reason = z.string().describe("One short sentence explaining the change to the author.").optional();
  const tools = {
    replace_text: tool({
      description: "Replace an exact phrase inside a single block. Use for word/phrase/sentence-level edits.",
      inputSchema: z.object({
        block_id: z.string(),
        find: z.string().describe("Exact text currently in the block (copy it verbatim; must be unique within the block)."),
        replace: z.string().describe("Replacement text. May use *italic* / **bold**."),
        reason,
      }),
      execute: async ({ block_id, find, replace, reason }, { toolCallId }) => {
        endDraft(toolCallId);
        const blockId = normalizeBlockId(block_id);
        const block = blockById.get(blockId);
        if (!block) return `Error: block ${block_id} does not exist.`;
        const hay = plainText(block.text);
        const needle = plainText(find);
        if (!needle) return "Error: find is empty.";
        const first = hay.indexOf(needle);
        if (first < 0) return `Error: "${needle.slice(0, 80)}" not found in block ${block_id}. Its text is:\n${hay}`;
        if (hay.indexOf(needle, first + 1) >= 0) return "Error: find text occurs more than once in the block; include more surrounding words.";
        const err = claim([blockId]);
        if (err) return `Error: ${err}`;
        create({ op: "replace_text", blockId, find: needle, replace }, reason ?? "");
        return "OK — suggested.";
      },
    }),
    rewrite_block: tool({
      description: "Replace one whole block. The new text may span several lines (one paragraph per line).",
      inputSchema: z.object({ block_id: z.string(), text: z.string(), reason }),
      execute: async ({ block_id, text, reason }, { toolCallId }) => {
        endDraft(toolCallId);
        const blockId = normalizeBlockId(block_id);
        const err = claim([blockId]);
        if (err) return `Error: ${err}`;
        create({ op: "replace_block", blockId, blocks: parseBlocks(text) }, reason ?? "");
        return "OK — suggested.";
      },
    }),
    insert_after: tool({
      description:
        'Insert new blocks after a block. after_id: an existing block id, "START" for the top of the chapter, or "LAST" to continue right after your previous insert in this run. One paragraph per line.',
      inputSchema: z.object({ after_id: z.string(), text: z.string(), reason }),
      execute: async ({ after_id, text, reason }, { toolCallId }) => {
        endDraft(toolCallId);
        const blocks = parseBlocks(text);
        const afterId = insertionAnchor(after_id);
        if (afterId === undefined) return `Error: block ${after_id} does not exist.`;
        // Appending to the same anchor (or "LAST") extends the previous insert so order is preserved.
        if (lastInsert && (after_id === "LAST" || (afterId !== null && afterId === lastInsert.op.afterId))) {
          lastInsert.op.blocks.push(...blocks);
          const row = db
            .update(schema.suggestions)
            .set({ op: lastInsert.op })
            .where(eq(schema.suggestions.id, lastInsert.id))
            .returning()
            .get();
          emit({ t: "suggestion", suggestion: row });
          return `OK — appended (${lastInsert.op.blocks.length} blocks in this insert so far).`;
        }
        const op = { op: "insert_after" as const, afterId, blocks };
        const row = create(op, reason ?? "");
        lastInsert = { id: row.id, op };
        return `OK — suggested ${blocks.length} new block(s).`;
      },
    }),
    delete_blocks: tool({
      description: "Delete whole blocks.",
      inputSchema: z.object({ block_ids: z.array(z.string()).min(1), reason }),
      execute: async ({ block_ids, reason }, { toolCallId }) => {
        endDraft(toolCallId);
        const blockIds = [...new Set(block_ids.map(normalizeBlockId))];
        const err = claim(blockIds);
        if (err) return `Error: ${err}`;
        create({ op: "delete_blocks", blockIds }, reason ?? "");
        return "OK — suggested.";
      },
    }),
    read_blocks: tool({
      description: "Read blocks of the CURRENT chapter that were omitted from your context.",
      inputSchema: z.object({
        from_id: z.string().optional().describe("Start at this block (default: first block)."),
        count: z.number().int().min(1).max(200).default(60),
      }),
      execute: async ({ from_id, count }) => {
        const blockId = from_id ? normalizeBlockId(from_id) : undefined;
        const start = blockId === undefined ? 0 : ctx.blocks.findIndex((b) => b.id === blockId);
        if (start < 0) return `Error: block ${from_id} not found.`;
        const slice = ctx.blocks.slice(start, start + count);
        return slice.map(blockToLine).join("\n") + (start + count < ctx.blocks.length ? `\n[… ${ctx.blocks.length - start - count} more]` : "");
      },
    }),
    read_chapter: tool({
      description: "Read the full text of ANOTHER chapter (read-only) by id.",
      inputSchema: z.object({ chapter_id: z.string() }),
      execute: async ({ chapter_id }) => {
        const ch = db.select().from(schema.chapters).where(eq(schema.chapters.id, chapter_id)).get();
        if (!ch || ch.projectId !== chapter.projectId) return "Error: no such chapter.";
        const text = docToBlocks(ch.content).map(blockPlain).join("\n");
        return `# ${ch.title}\n${text.length > 40000 ? text.slice(0, 40000) + "\n[… truncated]" : text}`;
      },
    }),
    search_manuscript: tool({
      description: "Case-insensitive search across all chapters. Returns matching passages with chapter and block ids.",
      inputSchema: z.object({ query: z.string().min(2) }),
      execute: async ({ query }) => {
        const q = query.toLowerCase();
        const rows = db
          .select()
          .from(schema.chapters)
          .where(eq(schema.chapters.projectId, chapter.projectId))
          .orderBy(asc(schema.chapters.position))
          .all();
        const hits: string[] = [];
        for (const ch of rows)
          for (const b of docToBlocks(ch.content)) {
            const t = blockPlain(b);
            const i = t.toLowerCase().indexOf(q);
            if (i >= 0) hits.push(`${ch.title} [p:${b.id}]: …${t.slice(Math.max(0, i - 120), i + 200)}…`);
            if (hits.length >= 25) break;
          }
        return hits.length ? hits.join("\n") : "No matches.";
      },
    }),
  };

  /* ---- 5. stream ---- */
  const result = streamText({
    model,
    instructions: ctx.system,
    prompt: ctx.prompt,
    tools,
    stopWhen: isStepCount(40),
    temperature: settings.temperature,
    abortSignal: signal,
  });

  let assistantText = "";
  const inputChars = new Map<string, number>();
  const inputs = new Map<string, { name: string; buf: string; at: number }>();
  const DRAFTABLE = new Set(["insert_after", "rewrite_block", "replace_text"]);
  const pushDraft = async (id: string, force = false) => {
    const t = inputs.get(id);
    if (!t || !DRAFTABLE.has(t.name)) return;
    const now = Date.now();
    if (!force && now - t.at < 70) return; // ~14 fps is plenty for prose
    t.at = now;
    const { value } = await parsePartialJson(t.buf);
    const d = draftFor(t.name, value);
    if (!d) return;
    liveDrafts.add(id);
    emit({ t: "draft", id, ...d });
  };
  // A run that is stopped or fails without producing anything leaves no trace in the history
  // (otherwise the dead request would keep being replayed to the model as "recent session").
  let hadError = false;
  const dropRun = () => db.delete(schema.agentMessages).where(eq(schema.agentMessages.runId, runId)).run();
  try {
    for await (const part of result.stream) {
      switch (part.type) {
        case "text-delta":
          assistantText += part.text;
          emit({ t: "text", delta: part.text });
          break;
        case "tool-input-start":
          inputChars.set(part.id, 0);
          inputs.set(part.id, { name: part.toolName, buf: "", at: 0 });
          emit({ t: "tool-start", id: part.id, name: part.toolName });
          break;
        case "tool-input-delta": {
          const n = (inputChars.get(part.id) ?? 0) + part.delta.length;
          inputChars.set(part.id, n);
          const t = inputs.get(part.id);
          if (t) t.buf += part.delta;
          emit({ t: "tool-progress", id: part.id, chars: n });
          await pushDraft(part.id);
          break;
        }
        case "tool-input-end":
          await pushDraft(part.id, true);
          break;
        case "tool-result": {
          endDraft(part.toolCallId);
          const out = String(part.output ?? "");
          emit({ t: "tool-result", id: part.toolCallId, name: part.toolName, ok: !out.startsWith("Error"), message: out.slice(0, 300) });
          break;
        }
        case "tool-error":
          endDraft(part.toolCallId);
          emit({ t: "tool-result", id: part.toolCallId, name: part.toolName, ok: false, message: String((part.error as any)?.message ?? part.error) });
          break;
        case "error":
          hadError = true;
          emit({ t: "error", message: String((part.error as any)?.message ?? part.error) });
          break;
      }
    }
  } catch (err) {
    if (seq === 0) dropRun();
    throw err;
  }
  for (const id of [...liveDrafts]) endDraft(id);
  if ((signal.aborted || hadError) && seq === 0 && !assistantText.trim()) {
    dropRun();
    return;
  }
  if (signal.aborted) return;
  const usage = await Promise.resolve(result.totalUsage).catch(() => undefined);
  const count = seq;
  db.insert(schema.agentMessages)
    .values({
      id: nanoid(),
      chapterId: chapter.id,
      runId,
      role: "assistant",
      content: (assistantText.trim() || "(no comment)") + (count ? ` [${count} suggestion${count === 1 ? "" : "s"}]` : ""),
      model: modelRef,
    })
    .run();
  const pricing = modelInfo?.pricing;
  const inputTokens = usage?.inputTokens;
  const outputTokens = usage?.outputTokens;
  const estimatedCostUsd = pricing && inputTokens !== undefined && outputTokens !== undefined
    && Number.isFinite(pricing.prompt) && pricing.prompt >= 0
    && Number.isFinite(pricing.completion) && pricing.completion >= 0
    ? (inputTokens * pricing.prompt + outputTokens * pricing.completion) / 1_000_000
    : undefined;
  emit({
    t: "done",
    runId,
    elapsedMs: Math.round(performance.now() - startedAt),
    usage: usage ? { inputTokens, outputTokens, estimatedCostUsd } : undefined,
  });
}
