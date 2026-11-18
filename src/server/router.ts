import { initTRPC, TRPCError } from "@trpc/server";
import { z } from "zod";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, schema } from "./db";
import { blocksWordCount, docToBlocks, EMPTY_DOC, hashString, type PMDoc } from "../shared/doc";
import { emptyCard, normalizeCard, type CardData } from "../shared/character";
import { getSettings, publicSettings, saveSettings } from "./settings";
import { listModels, testProvider } from "./ai/providers";
import { summarizeChapter } from "./ai/summarize";
import { buildContext } from "./ai/context";
import { extractCardFromPng } from "./cards/png";
import { parseLorebook } from "../shared/lorebook";

const t = initTRPC.create();
const p = t.procedure;

const notFound = (what: string) => new TRPCError({ code: "NOT_FOUND", message: `${what} not found` });

function docStats(doc: PMDoc) {
  const blocks = docToBlocks(doc);
  return { wordCount: blocksWordCount(blocks), contentHash: hashString(JSON.stringify(blocks.map((b) => [b.type, b.speaker, b.text]))) };
}

/* ------------------------------------------------------------------ projects */

const projectsRouter = t.router({
  list: p.query(() => {
    const rows = db.select().from(schema.projects).orderBy(desc(schema.projects.updatedAt)).all();
    const counts = db
      .select({ projectId: schema.chapters.projectId, words: sql<number>`sum(${schema.chapters.wordCount})`, n: sql<number>`count(*)` })
      .from(schema.chapters)
      .groupBy(schema.chapters.projectId)
      .all();
    return rows.map((r) => {
      const c = counts.find((x) => x.projectId === r.id);
      return { ...r, words: c?.words ?? 0, chapters: c?.n ?? 0 };
    });
  }),
  get: p.input(z.string()).query(({ input }) => {
    const row = db.select().from(schema.projects).where(eq(schema.projects.id, input)).get();
    if (!row) throw notFound("Project");
    return row;
  }),
  create: p
    .input(
      z.object({
        title: z.string().min(1),
        format: z.enum(["prose", "chat"]).default("prose"),
        premise: z.string().default(""),
        theme: z.string().max(40).optional(),
        pov: z.string().max(80).optional(),
      }),
    )
    .mutation(({ input }) => {
      const id = nanoid(10);
      db.insert(schema.projects)
        .values({ id, ...input, theme: input.theme ?? (input.format === "chat" ? "imessage" : "folio"), pov: input.pov ?? "" })
        .run();
      const chapterId = nanoid(10);
      db.insert(schema.chapters)
        .values({ id: chapterId, projectId: id, title: input.format === "chat" ? "Part One" : "Chapter One", position: 0, content: EMPTY_DOC })
        .run();
      return { id, chapterId };
    }),
  update: p
    .input(
      z.object({
        id: z.string(),
        title: z.string().optional(),
        format: z.enum(["prose", "chat"]).optional(),
        theme: z.string().max(40).optional(),
        pov: z.string().max(80).optional(),
        premise: z.string().optional(),
        styleGuide: z.string().optional(),
        authorsNote: z.string().optional(),
      }),
    )
    .mutation(({ input: { id, ...patch } }) => {
      db.update(schema.projects).set({ ...patch, updatedAt: Date.now() }).where(eq(schema.projects.id, id)).run();
      return { ok: true };
    }),
  delete: p.input(z.string()).mutation(({ input }) => {
    db.delete(schema.projects).where(eq(schema.projects.id, input)).run();
    return { ok: true };
  }),
});

/* ------------------------------------------------------------------ chapters */

const chaptersRouter = t.router({
  list: p.input(z.string()).query(({ input }) =>
    db
      .select({
        id: schema.chapters.id,
        title: schema.chapters.title,
        position: schema.chapters.position,
        wordCount: schema.chapters.wordCount,
        summary: schema.chapters.summary,
        stale: sql<boolean>`coalesce(${schema.chapters.summaryHash}, '') != coalesce(${schema.chapters.contentHash}, '')`,
        updatedAt: schema.chapters.updatedAt,
      })
      .from(schema.chapters)
      .where(eq(schema.chapters.projectId, input))
      .orderBy(asc(schema.chapters.position))
      .all(),
  ),
  get: p.input(z.string()).query(({ input }) => {
    const row = db.select().from(schema.chapters).where(eq(schema.chapters.id, input)).get();
    if (!row) throw notFound("Chapter");
    return row;
  }),
  create: p.input(z.object({ projectId: z.string(), title: z.string().optional() })).mutation(({ input }) => {
    const max = db
      .select({ m: sql<number>`coalesce(max(${schema.chapters.position}), -1)` })
      .from(schema.chapters)
      .where(eq(schema.chapters.projectId, input.projectId))
      .get()!.m;
    const id = nanoid(10);
    db.insert(schema.chapters)
      .values({ id, projectId: input.projectId, title: input.title ?? `Chapter ${max + 2}`, position: max + 1, content: EMPTY_DOC })
      .run();
    return { id };
  }),
  saveContent: p.input(z.object({ id: z.string(), content: z.any() })).mutation(({ input }) => {
    const doc = input.content as PMDoc;
    if (doc?.type !== "doc") throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid document" });
    const stats = docStats(doc);
    const ch = db
      .update(schema.chapters)
      .set({ content: doc, ...stats, updatedAt: Date.now() })
      .where(eq(schema.chapters.id, input.id))
      .returning({ projectId: schema.chapters.projectId })
      .get();
    if (!ch) throw notFound("Chapter");
    db.update(schema.projects).set({ updatedAt: Date.now() }).where(eq(schema.projects.id, ch.projectId)).run();
    return { ...stats, savedAt: Date.now() };
  }),
  update: p
    .input(z.object({ id: z.string(), title: z.string().optional(), notes: z.string().optional(), summary: z.string().optional() }))
    .mutation(({ input: { id, summary, ...patch } }) => {
      const extra: Partial<typeof schema.chapters.$inferInsert> = {};
      if (summary !== undefined) {
        // A hand-edited summary counts as fresh for the current content.
        const ch = db.select({ h: schema.chapters.contentHash }).from(schema.chapters).where(eq(schema.chapters.id, id)).get();
        Object.assign(extra, { summary, summaryHash: ch?.h ?? null });
      }
      db.update(schema.chapters).set({ ...patch, ...extra }).where(eq(schema.chapters.id, id)).run();
      return { ok: true };
    }),
  reorder: p.input(z.object({ projectId: z.string(), ids: z.array(z.string()) })).mutation(({ input }) => {
    db.transaction((tx) => {
      input.ids.forEach((id, i) =>
        tx.update(schema.chapters).set({ position: i }).where(and(eq(schema.chapters.id, id), eq(schema.chapters.projectId, input.projectId))).run(),
      );
    });
    return { ok: true };
  }),
  delete: p.input(z.string()).mutation(({ input }) => {
    db.delete(schema.chapters).where(eq(schema.chapters.id, input)).run();
    return { ok: true };
  }),
  summarize: p.input(z.string()).mutation(async ({ input }) => ({ summary: await summarizeChapter(input) })),
  /** Preview exactly what the agent would see, without calling a model. */
  contextPreview: p
    .input(z.object({ chapterId: z.string(), mode: z.enum(["draft", "continue", "revise", "polish", "custom"]), instruction: z.string().default("") }))
    .query(({ input }) => {
      const ctx = buildContext({ ...input, budget: getSettings().contextBudget });
      return { system: ctx.system, prompt: ctx.prompt, sections: ctx.sections, total: ctx.totalTokens };
    }),
});

/* ------------------------------------------------------------- suggestions */

const suggestionsRouter = t.router({
  pending: p.input(z.string()).query(({ input }) =>
    db
      .select()
      .from(schema.suggestions)
      .where(and(eq(schema.suggestions.chapterId, input), eq(schema.suggestions.status, "pending")))
      .orderBy(asc(schema.suggestions.createdAt), asc(schema.suggestions.seq))
      .all(),
  ),
  resolve: p
    .input(z.object({ ids: z.array(z.string()).min(1), status: z.enum(["accepted", "rejected"]) }))
    .mutation(({ input }) => {
      db.update(schema.suggestions).set({ status: input.status }).where(inArray(schema.suggestions.id, input.ids)).run();
      return { ok: true };
    }),
});

/* ------------------------------------------------------------------ agent log */

const agentRouter = t.router({
  log: p.input(z.string()).query(({ input }) =>
    db.select().from(schema.agentMessages).where(eq(schema.agentMessages.chapterId, input)).orderBy(asc(schema.agentMessages.createdAt)).all(),
  ),
  clearLog: p.input(z.string()).mutation(({ input }) => {
    db.delete(schema.agentMessages).where(eq(schema.agentMessages.chapterId, input)).run();
    return { ok: true };
  }),
});

/* ---------------------------------------------------------------- characters */

const cardSchema = z.record(z.string(), z.any());

const charactersRouter = t.router({
  list: p.query(() => db.select().from(schema.characters).orderBy(asc(schema.characters.name)).all()),
  forProject: p.input(z.string()).query(({ input }) =>
    db
      .select({ character: schema.characters, pinned: schema.projectCharacters.pinned })
      .from(schema.projectCharacters)
      .innerJoin(schema.characters, eq(schema.characters.id, schema.projectCharacters.characterId))
      .where(eq(schema.projectCharacters.projectId, input))
      .orderBy(asc(schema.characters.name))
      .all(),
  ),
  get: p.input(z.string()).query(({ input }) => {
    const row = db.select().from(schema.characters).where(eq(schema.characters.id, input)).get();
    if (!row) throw notFound("Character");
    return row;
  }),
  create: p.input(z.object({ name: z.string().default("New character"), projectId: z.string().optional() })).mutation(({ input }) => {
    const id = nanoid(10);
    db.insert(schema.characters).values({ id, name: input.name, card: emptyCard(input.name) }).run();
    if (input.projectId) db.insert(schema.projectCharacters).values({ projectId: input.projectId, characterId: id }).run();
    return { id };
  }),
  update: p
    .input(z.object({ id: z.string(), card: cardSchema, avatar: z.string().nullable().optional() }))
    .mutation(({ input }) => {
      const card = normalizeCard({ spec: "chara_card_v2", data: input.card });
      db.update(schema.characters)
        .set({ card, name: card.name, ...(input.avatar !== undefined ? { avatar: input.avatar } : {}), updatedAt: Date.now() })
        .where(eq(schema.characters.id, input.id))
        .run();
      return { ok: true };
    }),
  /** Import from a JSON card or a PNG card (base64 data URL). */
  import: p
    .input(z.object({ fileName: z.string(), dataUrl: z.string(), projectId: z.string().optional() }))
    .mutation(({ input }) => {
      const [meta, b64] = input.dataUrl.split(",", 2);
      const bytes = Buffer.from(b64 ?? "", "base64");
      let raw: unknown;
      let avatar: string | null = null;
      if (/image\/png/.test(meta ?? "") || input.fileName.toLowerCase().endsWith(".png")) {
        raw = extractCardFromPng(new Uint8Array(bytes));
        avatar = `data:image/png;base64,${b64}`;
      } else {
        raw = JSON.parse(bytes.toString("utf8"));
      }
      const card: CardData = normalizeCard(raw);
      const id = nanoid(10);
      db.insert(schema.characters).values({ id, name: card.name, card, avatar }).run();
      if (input.projectId) db.insert(schema.projectCharacters).values({ projectId: input.projectId, characterId: id }).onConflictDoNothing().run();
      return { id, name: card.name, loreEntries: card.character_book?.entries.length ?? 0 };
    }),
  delete: p.input(z.string()).mutation(({ input }) => {
    db.delete(schema.characters).where(eq(schema.characters.id, input)).run();
    return { ok: true };
  }),
  link: p
    .input(z.object({ projectId: z.string(), characterId: z.string(), linked: z.boolean(), pinned: z.boolean().optional() }))
    .mutation(({ input }) => {
      if (!input.linked) {
        db.delete(schema.projectCharacters)
          .where(and(eq(schema.projectCharacters.projectId, input.projectId), eq(schema.projectCharacters.characterId, input.characterId)))
          .run();
      } else {
        db.insert(schema.projectCharacters)
          .values({ projectId: input.projectId, characterId: input.characterId, pinned: input.pinned ?? false })
          .onConflictDoUpdate({
            target: [schema.projectCharacters.projectId, schema.projectCharacters.characterId],
            set: { pinned: input.pinned ?? false },
          })
          .run();
      }
      return { ok: true };
    }),
});

/* ---------------------------------------------------------------------- lore */

const loreInput = z.object({
  name: z.string(),
  keys: z.array(z.string()),
  content: z.string(),
  enabled: z.boolean(),
  constant: z.boolean(),
  insertionOrder: z.number().int(),
});

const loreRouter = t.router({
  list: p.input(z.string()).query(({ input }) =>
    db.select().from(schema.loreEntries).where(eq(schema.loreEntries.projectId, input)).orderBy(asc(schema.loreEntries.insertionOrder), asc(schema.loreEntries.name)).all(),
  ),
  create: p.input(z.object({ projectId: z.string() }).merge(loreInput.partial())).mutation(({ input }) => {
    const id = nanoid(10);
    db.insert(schema.loreEntries)
      .values({ id, projectId: input.projectId, name: input.name ?? "New entry", keys: input.keys ?? [], content: input.content ?? "", enabled: input.enabled ?? true, constant: input.constant ?? false, insertionOrder: input.insertionOrder ?? 100 })
      .run();
    return { id };
  }),
  update: p.input(z.object({ id: z.string() }).merge(loreInput.partial())).mutation(({ input: { id, ...patch } }) => {
    db.update(schema.loreEntries).set(patch).where(eq(schema.loreEntries.id, id)).run();
    return { ok: true };
  }),
  delete: p.input(z.string()).mutation(({ input }) => {
    db.delete(schema.loreEntries).where(eq(schema.loreEntries.id, input)).run();
    return { ok: true };
  }),
  /** Import a SillyTavern world info / Character Card lorebook JSON (raw file text). */
  import: p.input(z.object({ projectId: z.string(), fileName: z.string(), text: z.string().max(20_000_000) })).mutation(({ input }) => {
    let raw: unknown;
    try {
      raw = JSON.parse(input.text);
    } catch {
      throw new TRPCError({ code: "BAD_REQUEST", message: `${input.fileName} isn't valid JSON.` });
    }
    let book;
    try {
      book = parseLorebook(raw, input.fileName.replace(/\.json$/i, ""));
    } catch (e: any) {
      throw new TRPCError({ code: "BAD_REQUEST", message: e.message });
    }
    // Skip exact duplicates of entries already in the project (same name + content), so re-importing is harmless.
    const existing = new Set(
      db
        .select({ name: schema.loreEntries.name, content: schema.loreEntries.content })
        .from(schema.loreEntries)
        .where(eq(schema.loreEntries.projectId, input.projectId))
        .all()
        .map((e) => `${e.name}\u0000${e.content}`),
    );
    const fresh = book.entries.filter((e) => !existing.has(`${e.name}\u0000${e.content}`));
    if (fresh.length)
      db.insert(schema.loreEntries)
        .values(fresh.map((e) => ({ id: nanoid(10), projectId: input.projectId, ...e })))
        .run();
    return { name: book.name, imported: fresh.length, duplicates: book.entries.length - fresh.length, skipped: book.skipped };
  }),
});

/* ------------------------------------------------------------------ settings */

const settingsRouter = t.router({
  get: p.query(() => publicSettings()),
  update: p
    .input(
      z.object({
        model: z.string().optional(),
        summaryModel: z.string().optional(),
        contextBudget: z.number().int().min(4000).max(1_000_000).optional(),
        temperature: z.number().min(0).max(2).optional(),
        providers: z
          .object({
            openrouter: z.object({ apiKey: z.string() }).partial(),
            openai: z.object({ apiKey: z.string(), baseURL: z.string() }).partial(),
            anthropic: z.object({ apiKey: z.string() }).partial(),
            custom: z.object({ name: z.string(), baseURL: z.string(), apiKey: z.string() }).partial(),
          })
          .partial()
          .optional(),
      }),
    )
    .mutation(({ input }) => {
      // Masked keys coming back from the UI mean "unchanged".
      const providers = structuredClone(input.providers ?? {}) as any;
      for (const k of Object.keys(providers)) if (providers[k]?.apiKey?.startsWith("••••")) delete providers[k].apiKey;
      return publicSettings(saveSettings({ ...input, providers } as any));
    }),
  models: p.input(z.object({ refresh: z.boolean().optional() }).optional()).query(({ input }) => listModels(input?.refresh)),
  testProvider: p
    .input(z.object({ provider: z.enum(["openrouter", "openai", "anthropic", "custom"]), apiKey: z.string().optional(), baseURL: z.string().optional() }))
    .mutation(({ input }) => testProvider(input)),
});

export const appRouter = t.router({
  projects: projectsRouter,
  chapters: chaptersRouter,
  suggestions: suggestionsRouter,
  agent: agentRouter,
  characters: charactersRouter,
  lore: loreRouter,
  settings: settingsRouter,
});

export type AppRouter = typeof appRouter;
