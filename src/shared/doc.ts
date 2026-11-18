/**
 * Shared document model.
 *
 * Chapters are stored as TipTap/ProseMirror JSON with a deliberately FLAT top level:
 * every top-level node is a "block" (paragraph, heading, horizontalRule) carrying a stable `id`.
 * The AI never sees or returns the full doc — it sees blocks tagged with ids and proposes
 * targeted operations (suggestions) against those ids. That is what makes long documents
 * editable by diff instead of by rewrite.
 */

export type StoryFormat = "prose" | "chat";

/** How many of a chapter's most recent agent-history messages are replayed to the model. */
export const CONTEXT_MESSAGES = 8;

export type PMMark = { type: string; attrs?: Record<string, unknown> };
export type PMNode = {
  type: string;
  attrs?: Record<string, any>;
  content?: PMNode[];
  text?: string;
  marks?: PMMark[];
};
export type PMDoc = { type: "doc"; content: PMNode[] };

/**
 * A block as the agent sees it. `text` uses a markdown-lite inline syntax (*em*, **strong**).
 * In chat stories each paragraph is one message and `speaker` names who sent it
 * (null = narration / system line such as "Mara left the chat").
 */
export type Block = {
  id: string;
  type: "paragraph" | "heading" | "scene_break";
  level?: number;
  speaker?: string | null;
  text: string;
};

/** A block the agent wants to create (no id yet). */
export type NewBlock = Omit<Block, "id">;

export type SuggestionOp =
  | { op: "replace_text"; blockId: string; find: string; replace: string }
  | { op: "replace_block"; blockId: string; blocks: NewBlock[] }
  | { op: "insert_after"; afterId: string | null; blocks: NewBlock[] }
  | { op: "delete_blocks"; blockIds: string[] };

export const EMPTY_DOC: PMDoc = { type: "doc", content: [{ type: "paragraph", attrs: { id: null } }] };

/** A message/paragraph as plain text, with its speaker for chat ("Mara: hi"). */
export function blockPlain(b: Block): string {
  if (b.type === "scene_break") return "* * *";
  const t = plainText(b.text);
  return b.speaker ? `${b.speaker}: ${t}` : t;
}

const ID_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";
export function blockId(len = 8): string {
  let s = "";
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  for (let i = 0; i < len; i++) s += ID_ALPHABET[bytes[i]! % ID_ALPHABET.length];
  return s;
}

/* ------------------------------------------------------------------ inline */

export function inlineToMd(nodes: PMNode[] | undefined): string {
  if (!nodes) return "";
  let out = "";
  for (const n of nodes) {
    if (n.type === "hardBreak") {
      out += "\n";
      continue;
    }
    if (n.type !== "text" || !n.text) continue;
    const bold = n.marks?.some((m) => m.type === "bold");
    const italic = n.marks?.some((m) => m.type === "italic");
    let t = n.text;
    if (italic) t = `*${t}*`;
    if (bold) t = `**${t}**`;
    out += t;
  }
  return out;
}

/** Parse markdown-lite (*em*, **strong**, _em_) into ProseMirror inline nodes. */
export function mdToInline(text: string): PMNode[] {
  const nodes: PMNode[] = [];
  const re = /(\*\*([^*]+)\*\*|\*([^*\s][^*]*?)\*|_([^_\s][^_]*?)_)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  const push = (t: string, marks?: PMMark[]) => {
    if (!t) return;
    nodes.push(marks?.length ? { type: "text", text: t, marks } : { type: "text", text: t });
  };
  while ((m = re.exec(text))) {
    push(text.slice(last, m.index));
    if (m[2] !== undefined) push(m[2], [{ type: "bold" }]);
    else push((m[3] ?? m[4])!, [{ type: "italic" }]);
    last = m.index + m[0].length;
  }
  push(text.slice(last));
  return nodes;
}

export function plainText(md: string): string {
  return md.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\*([^*]+)\*/g, "$1").replace(/_([^_]+)_/g, "$1");
}

/* ------------------------------------------------------------------ blocks */

export function nodeToBlock(n: PMNode): Block | null {
  const id = n.attrs?.id as string | undefined;
  if (!id) return null;
  if (n.type === "heading") return { id, type: "heading", level: n.attrs?.level ?? 2, text: inlineToMd(n.content) };
  if (n.type === "horizontalRule") return { id, type: "scene_break", text: "" };
  if (n.type === "paragraph")
    return { id, type: "paragraph", speaker: (n.attrs?.speaker as string) || null, text: inlineToMd(n.content) };
  return null;
}

export function docToBlocks(doc: PMDoc | null | undefined): Block[] {
  if (!doc?.content) return [];
  return doc.content.map(nodeToBlock).filter((b): b is Block => !!b);
}

export function newBlockToNode(b: NewBlock, id = blockId()): PMNode {
  if (b.type === "scene_break") return { type: "horizontalRule", attrs: { id } };
  const content = mdToInline(b.text);
  if (b.type === "heading")
    return { type: "heading", attrs: { id, level: b.level ?? 2 }, ...(content.length ? { content } : {}) };
  return { type: "paragraph", attrs: { id, speaker: b.speaker ?? null }, ...(content.length ? { content } : {}) };
}

/** Render one block as a single prompt line: `[p:id] text`. */
export function blockToLine(b: Block): string {
  if (b.type === "scene_break") return `[p:${b.id}] ***`;
  if (b.type === "heading") return `[p:${b.id}] ${"#".repeat(b.level ?? 2)} ${b.text}`;
  const who = b.speaker ? `{${b.speaker}} ` : "";
  return `[p:${b.id}] ${who}${b.text.replace(/\n/g, " ")}`;
}

/**
 * Parse agent-authored text into new blocks.
 * One paragraph per line; `#`/`##` headings; `***` scene breaks; `{Name} text` = a chat message from Name.
 */
export function textToBlocks(text: string): NewBlock[] {
  const out: NewBlock[] = [];
  for (const raw of text.replace(/\r/g, "").split("\n")) {
    let line = raw.trim();
    if (!line) continue;
    // tolerate the model echoing an id tag
    line = line.replace(/^\[p:[a-z0-9]+\]\s*/i, "");
    if (/^(\*\s*){3,}$|^-{3,}$|^#$/.test(line)) {
      out.push({ type: "scene_break", text: "" });
      continue;
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      out.push({ type: "heading", level: h[1]!.length, text: h[2]! });
      continue;
    }
    const k = /^\{([^{}]{1,60})\}\s*(.*)$/.exec(line);
    if (k) {
      out.push({ type: "paragraph", speaker: k[1]!.trim(), text: k[2]! });
      continue;
    }
    out.push({ type: "paragraph", speaker: null, text: line });
  }
  return out;
}

export function blocksWordCount(blocks: Block[]): number {
  let n = 0;
  for (const b of blocks) n += plainText(b.text).split(/\s+/).filter(Boolean).length;
  return n;
}

/** Rough token estimate (~4 chars/token for English prose). Good enough for budgeting. */
export function estimateTokens(s: string): number {
  return Math.ceil(s.length / 4);
}

export function hashString(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

export function describeOp(op: SuggestionOp): string {
  switch (op.op) {
    case "replace_text":
      return `Change “${trunc(plainText(op.find), 40)}” → “${trunc(plainText(op.replace), 40)}”`;
    case "replace_block":
      return `Rewrite paragraph (${op.blocks.length} block${op.blocks.length === 1 ? "" : "s"})`;
    case "insert_after":
      return `Insert ${op.blocks.length} block${op.blocks.length === 1 ? "" : "s"}${op.afterId ? "" : " at start"}`;
    case "delete_blocks":
      return `Delete ${op.blockIds.length} block${op.blockIds.length === 1 ? "" : "s"}`;
  }
}

function trunc(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
