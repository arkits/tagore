import { test, expect, beforeAll } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.TAGORE_DB = path.join(mkdtempSync(path.join(tmpdir(), "tagore-")), "t.db");
process.env.TAGORE_MOCK = "1";

const { db, schema } = await import("../src/server/db");
const { eq } = await import("drizzle-orm");
const { runAgent } = await import("../src/server/ai/agent");
const { buildContext } = await import("../src/server/ai/context");
const { saveSettings } = await import("../src/server/settings");
const { newBlockToNode, textToBlocks } = await import("../src/shared/doc");
const { extractCardFromPng, embedCardInPng } = await import("../src/server/cards/png");

function doc(text: string) {
  return { type: "doc" as const, content: textToBlocks(text).map((b, i) => newBlockToNode(b, `blk${i}`)) };
}

beforeAll(() => {
  saveSettings({ model: "mock:writer" });
  db.insert(schema.projects).values({ id: "p1", title: "The Keeper", premise: "A woman returns to her father's lighthouse." }).run();
  db.insert(schema.chapters).values({ id: "c1", projectId: "p1", title: "One", position: 0, content: doc("Mara arrived at dusk.\nThe stairs were cold."), summary: "Mara arrives.", summaryHash: "x", contentHash: "x" }).run();
  db.insert(schema.chapters).values({ id: "c2", projectId: "p1", title: "Two", position: 1, content: doc("Morning came grey over the Varos coast.\nShe opened the logbook.") }).run();
  db.insert(schema.loreEntries).values({ id: "l1", projectId: "p1", name: "Varos", keys: ["Varos"], content: "Varos is a drowned coastal city." }).run();
  db.insert(schema.loreEntries).values({ id: "l2", projectId: "p1", name: "Unrelated", keys: ["zeppelin"], content: "Never mentioned." }).run();
  db.insert(schema.characters).values({ id: "m", name: "Mara Quell", card: { name: "Mara Quell", description: "A cartographer, 34.", personality: "Stubborn", scenario: "", first_mes: "", mes_example: "", creator_notes: "", system_prompt: "", post_history_instructions: "", alternate_greetings: [], tags: [], creator: "", character_version: "1", extensions: {} } }).run();
  db.insert(schema.projectCharacters).values({ projectId: "p1", characterId: "m" }).run();
});

test("context: triggers lore by keyword, includes summaries and character cards", () => {
  const ctx = buildContext({ chapterId: "c2", instruction: "continue", mode: "continue", budget: 20000 });
  expect(ctx.prompt).toContain("Varos is a drowned coastal city.");
  expect(ctx.prompt).not.toContain("Never mentioned.");
  expect(ctx.prompt).toContain("Mara arrives."); // summary of chapter one
  expect(ctx.prompt).toContain("Mara arrived at dusk"); // previous chapter ending
  expect(ctx.prompt).toContain("[p:blk0] Morning came grey");
  expect(ctx.sections.map((s) => s.name)).toContain("Lorebook");
});

test("context: windows large chapters around the focus", () => {
  const big = Array.from({ length: 400 }, (_, i) => `Paragraph ${i} ` + "lorem ipsum dolor sit amet ".repeat(12)).join("\n");
  db.insert(schema.chapters).values({ id: "big", projectId: "p1", title: "Big", position: 2, content: doc(big) }).run();
  const ctx = buildContext({ chapterId: "big", instruction: "", mode: "custom", focusId: "blk200", budget: 12000 });
  expect(ctx.visibleIds.has("blk200")).toBe(true);
  expect(ctx.visibleIds.size).toBeLessThan(400);
  expect(ctx.prompt).toContain("earlier blocks omitted");
  expect(ctx.totalTokens).toBeLessThan(14000);
  db.delete(schema.chapters).where(eq(schema.chapters.id, "big")).run();
});

test("agent: tool calls become validated suggestions, never document writes", async () => {
  const events: any[] = [];
  await runAgent({ chapterId: "c2", instruction: "keep going", mode: "continue" }, (e) => events.push(e), new AbortController().signal);
  const sugg = events.filter((e) => e.t === "suggestion").map((e) => e.suggestion);
  expect(sugg.map((s) => s.op.op)).toEqual(["replace_text", "insert_after"]);
  expect(sugg[0].op).toMatchObject({ blockId: "blk0", find: "Morning", replace: "*Morning*" });
  expect(sugg[1].op.blocks).toHaveLength(2);
  const failed = events.find((e) => e.t === "tool-result" && !e.ok);
  expect(failed.message).toContain("does not exist");
  expect(events.find((e) => e.t === "text")).toBeTruthy();
  expect(events.at(-1).t).toBe("done");
  // the chapter itself is untouched
  const ch = db.select().from(schema.chapters).all().find((c) => c.id === "c2")!;
  expect(ch.content.content).toHaveLength(2);
  // stale summary of chapter one was refreshed? (summaryHash 'x' == contentHash 'x' so no)
  expect(events.some((e) => e.t === "status")).toBe(false);
});

test("agent: a second run supersedes pending suggestions on the same block", async () => {
  const events: any[] = [];
  await runAgent({ chapterId: "c2", instruction: "again", mode: "continue" }, (e) => events.push(e), new AbortController().signal);
  expect(events.filter((e) => e.t === "suggestion-removed")).toHaveLength(1);
});

test("agent: draft beats are saved as chapter notes and reach the context", async () => {
  const events: any[] = [];
  await runAgent({ chapterId: "c2", instruction: "", mode: "draft", beats: "— the logbook's last page is missing" }, (e) => events.push(e), new AbortController().signal);
  const ch = db.select().from(schema.chapters).where(eq(schema.chapters.id, "c2")).get()!;
  expect(ch.notes).toBe("— the logbook's last page is missing");
  expect(buildContext({ chapterId: "c2", instruction: "", mode: "draft", budget: 20000 }).prompt).toContain("<chapter_notes>\n— the logbook's last page is missing");
});

test("png cards round-trip", () => {
  // 1x1 transparent PNG
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
  const card = { spec: "chara_card_v2", spec_version: "2.0", data: { name: "Ünïcode Ann", description: "hi" } };
  const out = embedCardInPng(new Uint8Array(png), card);
  expect(extractCardFromPng(out)).toEqual(card);
});
