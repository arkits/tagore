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

test("agent: edits stream as live drafts before becoming suggestions", async () => {
  const events: any[] = [];
  await runAgent({ chapterId: "c1", instruction: "", mode: "continue" }, (e) => events.push(e), new AbortController().signal);
  const drafts = events.filter((e) => e.t === "draft");
  expect(drafts.length).toBeGreaterThan(2);
  // the inserted passage grows as tokens arrive
  const lens = drafts.filter((d) => d.op.op === "insert_after").map((d) => JSON.stringify(d.op.blocks).length);
  expect(lens.at(-1)).toBeGreaterThan(lens[0]);
  // every draft is closed before its suggestion lands
  const firstSugg = events.findIndex((e) => e.t === "suggestion");
  expect(events.slice(0, firstSugg).some((e) => e.t === "draft-end")).toBe(true);
  expect(events.filter((e) => e.t === "draft-end").length).toBe(new Set(drafts.map((d) => d.id)).size);
});

test("chat format: {Speaker} lines round-trip through the block model", async () => {
  const { textToBlocks, blockToLine, newBlockToNode, nodeToBlock } = await import("../src/shared/doc");
  const [b] = textToBlocks("{Mara Quell} you up?");
  expect(b).toEqual({ type: "paragraph", speaker: "Mara Quell", text: "you up?" });
  const block = nodeToBlock(newBlockToNode(b!, "abc"))!;
  expect(blockToLine(block)).toBe("[p:abc] {Mara Quell} you up?");
});

test("deleted history messages are no longer sent to the model", async () => {
  const { appRouter } = await import("../src/server/router");
  const caller = appRouter.createCaller({});
  const log = await caller.agent.log("c2");
  expect(log.length).toBeGreaterThan(0);
  const victim = log.find((m) => m.role === "user")!;
  const marker = victim.content.slice(0, 40);
  const before = buildContext({ chapterId: "c2", instruction: "", mode: "custom", budget: 20000 }).prompt;
  await caller.agent.deleteMessages({ chapterId: "c2", ids: log.map((m) => m.id) });
  const after = buildContext({ chapterId: "c2", instruction: "", mode: "custom", budget: 20000 }).prompt;
  expect(before).toContain("<recent_session>");
  expect(after).not.toContain("<recent_session>");
  expect(after).not.toContain(marker);
});

test("context: the exact selected text reaches the agent", () => {
  const ctx = buildContext({ chapterId: "c2", instruction: "make it eerie", mode: "revise", selectionIds: ["blk0"], selectionText: "grey over the Varos coast", budget: 20000 });
  expect(ctx.prompt).toContain("«grey over the Varos coast»");
  expect(ctx.prompt).toContain("[p:blk0]");
  expect(ctx.prompt).toContain("prefer replace_text on exactly that span");
});

test("png cards round-trip", () => {
  // 1x1 transparent PNG
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
  const card = { spec: "chara_card_v2", spec_version: "2.0", data: { name: "Ünïcode Ann", description: "hi" } };
  const out = embedCardInPng(new Uint8Array(png), card);
  expect(extractCardFromPng(out)).toEqual(card);
});
