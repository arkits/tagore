/**
 * Tracked-change rendering + application for agent suggestions.
 *
 * Suggestions live outside the document (in SQLite and React state) and are drawn as
 * ProseMirror decorations, so the manuscript is never touched until the author accepts.
 * Every lookup re-resolves the target block by id, which keeps suggestions valid while the
 * author keeps typing elsewhere — and lets us detect when they've gone stale.
 */
import { Extension, type Editor } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { Fragment, type Node as PMNode, type Schema } from "@tiptap/pm/model";
import { mdToInline, newBlockToNode, plainText, type NewBlock, type SuggestionOp } from "@shared/doc";
import { messageAttrs, nameTag } from "./storyDecor";

export type EditorSuggestion = { id: string; op: SuggestionOp; note: string };

type Handlers = {
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
  onFocus?: (id: string) => void;
};

export const suggestionKey = new PluginKey("suggestions");

/* ----------------------------------------------------------------- lookup */

export function findBlock(doc: PMNode, id: string): { node: PMNode; pos: number } | null {
  let found: { node: PMNode; pos: number } | null = null;
  doc.forEach((node, pos) => {
    if (!found && node.attrs.id === id) found = { node, pos };
  });
  return found;
}

/** Map a plain-text offset inside a textblock to an absolute doc position. */
function textOffsetToPos(block: PMNode, blockPos: number, offset: number): number {
  let acc = 0;
  let result = blockPos + 1 + block.content.size;
  let done = false;
  block.descendants((child, childPos) => {
    if (done) return false;
    if (child.isText) {
      const len = child.text!.length;
      if (offset <= acc + len) {
        result = blockPos + 1 + childPos + (offset - acc);
        done = true;
        return false;
      }
      acc += len;
    } else if (child.isLeaf) {
      acc += child.type.name === "hardBreak" ? 1 : 0;
    }
    return true;
  });
  return result;
}

function locateReplaceText(doc: PMNode, op: Extract<SuggestionOp, { op: "replace_text" }>) {
  const b = findBlock(doc, op.blockId);
  if (!b) return null;
  const text = textWithBreaks(b.node);
  const i = text.indexOf(op.find);
  if (i < 0) return null;
  return { from: textOffsetToPos(b.node, b.pos, i), to: textOffsetToPos(b.node, b.pos, i + op.find.length) };
}

function textWithBreaks(node: PMNode): string {
  let s = "";
  node.descendants((c) => {
    if (c.isText) s += c.text;
    else if (c.type.name === "hardBreak") s += "\n";
    return true;
  });
  return s;
}

/** Is this suggestion still applicable to the current document? */
export function isApplicable(doc: PMNode, op: SuggestionOp): boolean {
  switch (op.op) {
    case "replace_text":
      return !!locateReplaceText(doc, op);
    case "replace_block":
      return !!findBlock(doc, op.blockId);
    case "insert_after":
      return op.afterId === null || !!findBlock(doc, op.afterId);
    case "delete_blocks":
      return op.blockIds.some((id) => !!findBlock(doc, id));
  }
}

/* ------------------------------------------------------------- rendering */

function renderInline(md: string, into: HTMLElement) {
  for (const n of mdToInline(md)) {
    let el: Node = document.createTextNode(n.text ?? "");
    for (const m of n.marks ?? []) {
      const w = document.createElement(m.type === "bold" ? "strong" : "em");
      w.appendChild(el);
      el = w;
    }
    into.appendChild(el);
  }
}

let getHandlers: (() => Handlers) | null = null;

export const isDraftId = (id: string) => id.startsWith("draft-");

function actions(id: string, label?: string): HTMLElement {
  const wrap = document.createElement("span");
  wrap.className = "sg-actions";
  wrap.contentEditable = "false";
  if (isDraftId(id)) {
    const l = document.createElement("span");
    l.className = "sg-label sg-writing";
    l.textContent = label ? `${label} · writing…` : "writing…";
    wrap.appendChild(l);
    return wrap;
  }
  if (label) {
    const l = document.createElement("span");
    l.className = "sg-label";
    l.textContent = label;
    wrap.appendChild(l);
  }
  for (const [action, glyph, title] of [
    ["accept", "✓", "Accept"],
    ["reject", "✕", "Reject"],
  ] as const) {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.sgAction = action;
    b.dataset.sgId = id;
    b.title = title;
    b.textContent = glyph;
    b.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    b.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const h = getHandlers?.();
      if (action === "accept") h?.onAccept(id);
      else h?.onReject(id);
    });
    wrap.appendChild(b);
  }
  return wrap;
}

function blockWidget(id: string, blocks: NewBlock[], label: string, note: string, active: boolean): HTMLElement {
  const box = document.createElement("div");
  box.className = isDraftId(id) ? "sg-block sg-streaming" : "sg-block";
  box.dataset.sgId = id;
  box.dataset.active = String(active);
  box.contentEditable = "false";
  if (note) box.title = note;
  box.addEventListener("click", () => getHandlers?.().onFocus?.(id));
  box.appendChild(actions(id, label));
  blocks.forEach((b, i) => {
    if (b.type === "scene_break") {
      const hr = document.createElement("p");
      hr.className = "sg-hr";
      hr.textContent = "⁂";
      box.appendChild(hr);
      return;
    }
    const el = document.createElement(b.type === "heading" ? `h${b.level ?? 2}` : "p");
    if (b.type === "heading") el.className = "msg-divider";
    else {
      const prev = blocks[i - 1];
      const next = blocks[i + 1];
      const same = (x?: NewBlock) => !!x && x.type === "paragraph" && !!b.speaker && x.speaker === b.speaker;
      const attrs = messageAttrs(b.speaker, { first: !same(prev), last: !same(next) }) as Record<string, string>;
      for (const [k, v] of Object.entries(attrs)) if (v) el.setAttribute(k, v);
      if (b.speaker) {
        el.dataset.speaker = b.speaker;
        el.appendChild(nameTag(b.speaker));
      }
    }
    renderInline(b.text, el);
    box.appendChild(el);
  });
  return box;
}

function buildDecorations(state: EditorState, list: EditorSuggestion[], active: string | null): DecorationSet {
  const doc = state.doc;
  const decos: Decoration[] = [];
  for (const s of list) {
    const op = s.op;
    const isActive = active === s.id;
    const ver = `${isActive}-${JSON.stringify(op).length}`;
    if (op.op === "replace_text") {
      const r = locateReplaceText(doc, op);
      if (!r) continue;
      if (r.to > r.from) decos.push(Decoration.inline(r.from, r.to, { class: "sg-del", "data-sg-id": s.id }));
      decos.push(
        Decoration.widget(
          r.to,
          () => {
            const w = document.createElement("span");
            w.className = "sg-inline-wrap";
            w.dataset.active = String(isActive);
            w.dataset.sgId = s.id;
            if (s.note) w.title = s.note;
            if (op.replace) {
              const ins = document.createElement("span");
              ins.className = isDraftId(s.id) ? "sg-ins sg-streaming-ins" : "sg-ins";
              renderInline(op.replace, ins);
              w.appendChild(ins);
            }
            w.appendChild(actions(s.id));
            return w;
          },
          { side: 1, key: `sg-${s.id}-${ver}`, ignoreSelection: true, stopEvent: () => true },
        ),
      );
    } else if (op.op === "replace_block") {
      const b = findBlock(doc, op.blockId);
      if (!b) continue;
      decos.push(Decoration.node(b.pos, b.pos + b.node.nodeSize, { class: "sg-del-block" }));
      decos.push(
        Decoration.widget(b.pos + b.node.nodeSize, () => blockWidget(s.id, op.blocks, "Rewrite", s.note, isActive), {
          side: -1,
          key: `sg-${s.id}-${ver}`,
          ignoreSelection: true,
          stopEvent: () => true,
        }),
      );
    } else if (op.op === "insert_after") {
      let pos = 0;
      if (op.afterId) {
        const b = findBlock(doc, op.afterId);
        if (!b) continue;
        pos = b.pos + b.node.nodeSize;
      }
      const words = op.blocks.reduce((n, b) => n + plainText(b.text).split(/\s+/).filter(Boolean).length, 0);
      decos.push(
        Decoration.widget(pos, () => blockWidget(s.id, op.blocks, `+${words} words`, s.note, isActive), {
          side: op.afterId ? -1 : 1,
          key: `sg-${s.id}-${ver}`,
          ignoreSelection: true,
          stopEvent: () => true,
        }),
      );
    } else if (op.op === "delete_blocks") {
      let last: { node: PMNode; pos: number } | null = null;
      for (const id of op.blockIds) {
        const b = findBlock(doc, id);
        if (!b) continue;
        decos.push(Decoration.node(b.pos, b.pos + b.node.nodeSize, { class: "sg-del-block" }));
        if (!last || b.pos > last.pos) last = b;
      }
      if (last) {
        const end = last.pos + last.node.nodeSize;
        decos.push(
          Decoration.widget(
            end,
            () => {
              const w = document.createElement("div");
              w.style.textAlign = "right";
              w.style.textIndent = "0";
              w.contentEditable = "false";
              if (s.note) w.title = s.note;
              w.appendChild(actions(s.id, `Delete ${op.blockIds.length}`));
              return w;
            },
            { side: -1, key: `sg-${s.id}-${ver}`, ignoreSelection: true, stopEvent: () => true },
          ),
        );
      }
    }
  }
  return DecorationSet.create(doc, decos);
}

/* ------------------------------------------------------------- extension */

/** `getHandlers` is a function (not a ref object) because TipTap deep-clones plain option objects. */
export const Suggestions = Extension.create<{ getHandlers: () => Handlers }>({
  name: "suggestions",
  addOptions() {
    return { getHandlers: () => ({ onAccept: () => {}, onReject: () => {} }) };
  },
  addProseMirrorPlugins() {
    const handlers = this.options.getHandlers;
    getHandlers = handlers;
    const editor = this.editor;
    // The list lives outside plugin state: TipTap reconfigures plugins when the React component
    // re-renders, which would otherwise silently wipe every pending suggestion.
    let cache: { doc: unknown; s: SuggestionView; set: DecorationSet | null } | null = null;
    return [
      new Plugin({
        key: suggestionKey,
        props: {
          decorations(state) {
            const s = store.get(editor);
            if (!s?.list.length) return null;
            if (cache && cache.doc === state.doc && cache.s === s) return cache.set;
            cache = { doc: state.doc, s, set: buildDecorations(state, s.list, s.active) };
            return cache.set;
          },
          handleDOMEvents: {
            mousedown(_view, event) {
              const box = (event.target as HTMLElement).closest<HTMLElement>("[data-sg-id]");
              if (box) handlers().onFocus?.(box.dataset.sgId!);
              return false;
            },
          },
        },
      }),
    ];
  },
});

type SuggestionView = { list: EditorSuggestion[]; active: string | null };
const store = new WeakMap<Editor, SuggestionView>();

export function setSuggestions(editor: Editor, list: EditorSuggestion[], active: string | null = null) {
  if (editor.isDestroyed) return;
  store.set(editor, { list, active });
  // An empty, history-free transaction makes the view re-read decorations.
  editor.view.dispatch(editor.state.tr.setMeta(suggestionKey, true).setMeta("addToHistory", false));
}

/* ------------------------------------------------------------- apply */

function nodesFor(schema: Schema, blocks: NewBlock[]): PMNode[] {
  return blocks.map((b) => schema.nodeFromJSON(newBlockToNode(b)));
}

function isEmptyPara(n: PMNode) {
  return n.type.name === "paragraph" && n.content.size === 0;
}

/** Apply one suggestion as a single undoable transaction. Returns false if it no longer applies. */
export function applySuggestion(editor: Editor, op: SuggestionOp): boolean {
  const { state } = editor;
  const { schema, doc } = state;
  const tr = state.tr;
  switch (op.op) {
    case "replace_text": {
      const r = locateReplaceText(doc, op);
      if (!r) return false;
      const $from = doc.resolve(r.from);
      const inherited = $from.marks().filter((m) => m.type.name !== "bold" && m.type.name !== "italic");
      const inline = mdToInline(op.replace).map((n) => {
        const node = schema.nodeFromJSON(n);
        return inherited.length ? node.mark([...node.marks, ...inherited]) : node;
      });
      if (inline.length) tr.replaceWith(r.from, r.to, Fragment.from(inline));
      else tr.delete(r.from, r.to);
      break;
    }
    case "replace_block": {
      const b = findBlock(doc, op.blockId);
      if (!b) return false;
      const nodes = nodesFor(schema, op.blocks);
      // Keep the original id on the last new block so later "insert after" anchors still resolve.
      const lastIdx = nodes.length - 1;
      nodes[lastIdx] = nodes[lastIdx]!.type.create({ ...nodes[lastIdx]!.attrs, id: op.blockId }, nodes[lastIdx]!.content);
      tr.replaceWith(b.pos, b.pos + b.node.nodeSize, nodes);
      break;
    }
    case "insert_after": {
      const nodes = nodesFor(schema, op.blocks);
      if (op.afterId === null) {
        const first = doc.firstChild;
        if (first && isEmptyPara(first)) tr.replaceWith(0, first.nodeSize, nodes);
        else tr.insert(0, nodes);
      } else {
        const b = findBlock(doc, op.afterId);
        if (!b) return false;
        // Drafting into an empty paragraph replaces it rather than leaving a blank line.
        if (isEmptyPara(b.node)) tr.replaceWith(b.pos, b.pos + b.node.nodeSize, nodes);
        else tr.insert(b.pos + b.node.nodeSize, nodes);
      }
      break;
    }
    case "delete_blocks": {
      const targets = op.blockIds
        .map((id) => findBlock(doc, id))
        .filter((x): x is { node: PMNode; pos: number } => !!x)
        .sort((a, b) => b.pos - a.pos);
      if (!targets.length) return false;
      for (const t of targets) tr.delete(t.pos, t.pos + t.node.nodeSize);
      if (tr.doc.childCount === 0) tr.insert(0, schema.nodes.paragraph!.create());
      break;
    }
  }
  editor.view.dispatch(tr);
  return true;
}

/** Scroll a suggestion into view. */
export function revealSuggestion(editor: Editor, id: string) {
  const el = editor.view.dom.querySelector(`[data-sg-id="${id}"]`);
  el?.scrollIntoView({ behavior: "smooth", block: "center" });
}
