import { test, expect } from "bun:test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.TAGORE_DB = path.join(mkdtempSync(path.join(tmpdir(), "tagore-lore-")), "t.db");

const { parseLorebook, toWorldInfo } = await import("../src/shared/lorebook");
const { appRouter } = await import("../src/server/router");
const { buildContext } = await import("../src/server/ai/context");

const worldInfo = {
  name: "Exported",
  entries: {
    "1": { uid: 1, key: ["Umbrella Corporation"], keysecondary: [], comment: "Umbrella Corporation", content: "A conglomerate.", constant: false, order: 100, disable: false },
    "2": { uid: 2, key: ["T-Virus", "Tyrant Virus"], comment: "Tyrant Virus", content: "A mutagenic virus.", constant: true, order: 50, disable: false },
    "3": { uid: 3, key: ["Off"], comment: "Disabled", content: "Hidden.", disable: true, order: 100 },
    "4": { uid: 4, key: ["Empty"], comment: "Empty", content: "   " },
  },
};

test("parses SillyTavern world_info (uid-keyed object)", () => {
  const b = parseLorebook(worldInfo, "RE lore");
  expect(b.name).toBe("RE lore"); // "Exported" is a placeholder name
  expect(b.entries).toHaveLength(3);
  expect(b.skipped).toBe(1);
  expect(b.entries[1]).toEqual({ name: "Tyrant Virus", keys: ["T-Virus", "Tyrant Virus"], content: "A mutagenic virus.", enabled: true, constant: true, insertionOrder: 50 });
  expect(b.entries[2]!.enabled).toBe(false);
});

test("parses Character Card V2 character_book, V3 wrapper, and a full card", () => {
  const book = { name: "Book", entries: [{ keys: ["a"], content: "A", enabled: true, insertion_order: 3, name: "Alpha" }] };
  expect(parseLorebook(book).entries[0]).toMatchObject({ name: "Alpha", keys: ["a"], insertionOrder: 3 });
  expect(parseLorebook({ spec: "lorebook_v3", data: book }).name).toBe("Book");
  expect(parseLorebook({ spec: "chara_card_v2", data: { name: "X", character_book: book } }).entries).toHaveLength(1);
  expect(() => parseLorebook({ foo: 1 })).toThrow(/No lorebook entries/);
});

test("export round-trips through import", () => {
  const b = parseLorebook(worldInfo);
  expect(parseLorebook(toWorldInfo("x", b.entries)).entries).toEqual(b.entries);
});

test("import endpoint stores entries, skips duplicates, and entries trigger in context", async () => {
  const caller = appRouter.createCaller({});
  const { id: projectId, chapterId } = await caller.projects.create({ title: "Raccoon", format: "prose", premise: "" });
  const text = JSON.stringify(worldInfo);
  const r1 = await caller.lore.import({ projectId, fileName: "re.json", text });
  expect(r1).toMatchObject({ imported: 3, duplicates: 0, skipped: 1 });
  const r2 = await caller.lore.import({ projectId, fileName: "re.json", text });
  expect(r2).toMatchObject({ imported: 0, duplicates: 3 });
  await expect(caller.lore.import({ projectId, fileName: "bad.json", text: "{nope" })).rejects.toThrow(/valid JSON/);

  await caller.chapters.update({ id: chapterId, notes: "They reach the Umbrella Corporation gates." });
  const ctx = buildContext({ chapterId, instruction: "", mode: "custom", budget: 20000 });
  expect(ctx.prompt).toContain("A conglomerate."); // keyword-triggered
  expect(ctx.prompt).toContain("A mutagenic virus."); // constant
  expect(ctx.prompt).not.toContain("Hidden."); // disabled
});

const real = "/Users/archit/Downloads/main_Resident evil lorebook _world_info.json";
test.skipIf(!existsSync(real))("parses the real Chub Resident Evil export", () => {
  const b = parseLorebook(JSON.parse(readFileSync(real, "utf8")), "Resident Evil");
  expect(b.entries.length).toBe(22);
  expect(b.entries.find((e) => e.name === "Oswell E. Spencer")?.keys).toEqual(["Oswell E. Spencer", "Earl Spencer"]);
});
