/**
 * Lorebook interchange. Accepts the shapes lorebooks circulate in:
 *  - SillyTavern / Chub "world_info" export: { entries: { "<uid>": { key, keysecondary, comment, content, constant, disable, order, … } } }
 *  - Character Card V2 `character_book`:    { name, entries: [ { keys, content, enabled, insertion_order, name|comment, constant } ] }
 *  - V3 standalone:                          { spec: "lorebook_v3", data: <character_book> }
 *  - A full character card whose data.character_book holds the entries
 * and exports SillyTavern's world_info shape, which ST, Chub and RisuAI all import.
 */

export type ImportedLoreEntry = {
  name: string;
  keys: string[];
  content: string;
  enabled: boolean;
  constant: boolean;
  insertionOrder: number;
};

export type ImportedLorebook = { name: string; entries: ImportedLoreEntry[]; skipped: number };

const strArr = (v: unknown): string[] =>
  Array.isArray(v)
    ? v.map((x) => String(x).trim()).filter(Boolean)
    : typeof v === "string"
      ? v.split(",").map((x) => x.trim()).filter(Boolean)
      : [];

export function parseLorebook(raw: unknown, fallbackName = "Imported lorebook"): ImportedLorebook {
  let book: any = raw;
  if (book?.spec === "lorebook_v3" || book?.spec === "lorebook_v2") book = book.data;
  else if (book?.data?.character_book) book = book.data.character_book;
  else if (book?.character_book) book = book.character_book;

  const rawEntries: any[] = Array.isArray(book?.entries)
    ? book.entries
    : book?.entries && typeof book.entries === "object"
      ? Object.values(book.entries)
      : Array.isArray(book)
        ? book
        : [];
  if (!rawEntries.length) throw new Error("No lorebook entries found. Expected a SillyTavern world info or Character Card lorebook JSON.");

  let skipped = 0;
  const entries: ImportedLoreEntry[] = [];
  rawEntries.forEach((e, i) => {
    const content = typeof e?.content === "string" ? e.content.trim() : "";
    if (!content) {
      skipped++;
      return;
    }
    const keys = strArr(e.keys ?? e.key);
    const name = String(e.comment || e.name || keys[0] || `Entry ${i + 1}`).trim();
    const disabled = e.disable === true || e.enabled === false;
    const order = Number(e.insertion_order ?? e.order ?? 100);
    entries.push({
      name,
      keys,
      content,
      enabled: !disabled,
      constant: e.constant === true,
      insertionOrder: Number.isFinite(order) ? Math.round(order) : 100,
    });
  });
  const name = String(book?.name && book.name !== "Exported" ? book.name : fallbackName);
  return { name, entries, skipped };
}

/** SillyTavern world_info JSON. */
export function toWorldInfo(name: string, entries: ImportedLoreEntry[]) {
  const out: Record<string, unknown> = {};
  entries.forEach((e, uid) => {
    out[String(uid)] = {
      uid,
      key: e.keys,
      keysecondary: [],
      comment: e.name,
      content: e.content,
      constant: e.constant,
      selective: true,
      selectiveLogic: 0,
      order: e.insertionOrder,
      position: 1,
      disable: !e.enabled,
      excludeRecursion: false,
      probability: 100,
      useProbability: true,
      displayIndex: uid,
    };
  });
  return { name, description: "Exported from Tagore", entries: out };
}
