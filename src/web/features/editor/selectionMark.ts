/**
 * Keeps the author's selection visible when focus moves elsewhere (the selection bubble's input,
 * the agent panel), and marks the passage the agent is working on with a shimmer until it's done.
 * State lives outside ProseMirror plugin state (TipTap reconfigures plugins on re-render).
 */
import { Extension, type Editor } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

type Range = { from: number; to: number };
const working = new WeakMap<Editor, Range | null>();
const key = new PluginKey("selectionMark");

const redraw = (editor: Editor) => {
  if (!editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(key, true).setMeta("addToHistory", false));
};

/** Highlight [from, to) as "the agent is working here"; pass null to clear. */
export function setWorkingRange(editor: Editor, range: Range | null) {
  working.set(editor, range && range.to > range.from ? range : null);
  redraw(editor);
}

export const SelectionMark = Extension.create({
  name: "selectionMark",
  onFocus() {
    redraw(this.editor);
  },
  onBlur() {
    redraw(this.editor);
  },
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        key,
        // Keep the working range attached to the same text as the document changes.
        appendTransaction(trs) {
          const r = working.get(editor);
          if (!r || !trs.some((t) => t.docChanged)) return null;
          let { from, to } = r;
          for (const t of trs) {
            from = t.mapping.map(from, 1);
            to = t.mapping.map(to, -1);
          }
          working.set(editor, to > from ? { from, to } : null);
          return null;
        },
        props: {
          decorations(state) {
            const decos: Decoration[] = [];
            const r = working.get(editor);
            const size = state.doc.content.size;
            if (r && r.to <= size) decos.push(Decoration.inline(r.from, r.to, { class: "sel-working" }));
            const { from, to, empty } = state.selection;
            if (!empty && !editor.view.hasFocus() && !r) decos.push(Decoration.inline(from, to, { class: "sel-ghost" }));
            return decos.length ? DecorationSet.create(state.doc, decos) : null;
          },
        },
      }),
    ];
  },
});
