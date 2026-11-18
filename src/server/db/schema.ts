import { sqliteTable, text, integer, primaryKey, index } from "drizzle-orm/sqlite-core";
import type { PMDoc, StoryFormat, SuggestionOp } from "../../shared/doc";
import type { CardData } from "../../shared/character";

const now = () => Date.now();

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value", { mode: "json" }).$type<unknown>().notNull(),
});

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  format: text("format").$type<StoryFormat>().notNull().default("prose"),
  /** The pitch: what this story is. Always in context. */
  premise: text("premise").notNull().default(""),
  /** Voice, tense, POV, tone, rules. Always in context. */
  styleGuide: text("style_guide").notNull().default(""),
  /** Short, high-priority steering placed right before the instruction (SillyTavern's "Author's Note"). */
  authorsNote: text("authors_note").notNull().default(""),
  /** Visual theme id (see src/web/lib/themes.ts). */
  theme: text("theme").notNull().default("folio"),
  /** Chat stories: whose phone/screen this is — their messages appear on the "me" side. */
  pov: text("pov").notNull().default(""),
  personaDescription: text("persona_description").notNull().default(""),
  createdAt: integer("created_at").notNull().$defaultFn(now),
  updatedAt: integer("updated_at").notNull().$defaultFn(now),
});

export const chapters = sqliteTable(
  "chapters",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    position: integer("position").notNull(),
    content: text("content", { mode: "json" }).$type<PMDoc>().notNull(),
    /** The author's ideas / beats / outline for this chapter. */
    notes: text("notes").notNull().default(""),
    /** Rolling summary used as long-range memory for other chapters. */
    summary: text("summary").notNull().default(""),
    /** Hash of the content the summary was produced from; mismatch = stale. */
    summaryHash: text("summary_hash"),
    contentHash: text("content_hash"),
    wordCount: integer("word_count").notNull().default(0),
    updatedAt: integer("updated_at").notNull().$defaultFn(now),
  },
  (t) => [index("chapters_project_idx").on(t.projectId)],
);

export const characters = sqliteTable("characters", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  card: text("card", { mode: "json" }).$type<CardData>().notNull(),
  /** data: URL of the avatar image (if imported from PNG or uploaded) */
  avatar: text("avatar"),
  createdAt: integer("created_at").notNull().$defaultFn(now),
  updatedAt: integer("updated_at").notNull().$defaultFn(now),
});

export const projectCharacters = sqliteTable(
  "project_characters",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    characterId: text("character_id")
      .notNull()
      .references(() => characters.id, { onDelete: "cascade" }),
    /** Always include full card, not just when mentioned. */
    pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.characterId] })],
);

/** Project lorebook ("World Info"): keyword-triggered context entries. */
export const loreEntries = sqliteTable(
  "lore_entries",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    keys: text("keys", { mode: "json" }).$type<string[]>().notNull(),
    content: text("content").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    /** Always included regardless of keywords. */
    constant: integer("constant", { mode: "boolean" }).notNull().default(false),
    /** Lower = earlier in the prompt; also lower = dropped first when over budget. */
    insertionOrder: integer("insertion_order").notNull().default(100),
    createdAt: integer("created_at").notNull().$defaultFn(now),
  },
  (t) => [index("lore_project_idx").on(t.projectId)],
);

export type SuggestionStatus = "pending" | "accepted" | "rejected";

export const suggestions = sqliteTable(
  "suggestions",
  {
    id: text("id").primaryKey(),
    chapterId: text("chapter_id")
      .notNull()
      .references(() => chapters.id, { onDelete: "cascade" }),
    runId: text("run_id").notNull(),
    op: text("op", { mode: "json" }).$type<SuggestionOp>().notNull(),
    /** Agent's one-line reason for the change. */
    note: text("note").notNull().default(""),
    status: text("status").$type<SuggestionStatus>().notNull().default("pending"),
    seq: integer("seq").notNull(),
    createdAt: integer("created_at").notNull().$defaultFn(now),
  },
  (t) => [index("suggestions_chapter_idx").on(t.chapterId, t.status)],
);

/** Lightweight agent log per chapter so iterative instructions have memory. */
export const agentMessages = sqliteTable(
  "agent_messages",
  {
    id: text("id").primaryKey(),
    chapterId: text("chapter_id")
      .notNull()
      .references(() => chapters.id, { onDelete: "cascade" }),
    runId: text("run_id").notNull(),
    role: text("role").$type<"user" | "assistant">().notNull(),
    content: text("content").notNull(),
    model: text("model"),
    createdAt: integer("created_at").notNull().$defaultFn(now),
  },
  (t) => [index("agent_messages_chapter_idx").on(t.chapterId)],
);
