import { Extension } from "@tiptap/core";
import Paragraph from "@tiptap/extension-paragraph";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { blockId } from "@shared/doc";

const BLOCK_TYPES = ["paragraph", "heading", "horizontalRule"];

/**
 * Gives every top-level block a stable `id` attribute and keeps ids unique
 * (splitting a paragraph copies attrs, so the second half gets a fresh id).
 * These ids are the addresses the agent's suggestions point at.
 */
export const BlockIds = Extension.create({
  name: "blockIds",
  addGlobalAttributes() {
    return [
      {
        types: BLOCK_TYPES,
        attributes: {
          id: {
            default: null,
            keepOnSplit: false,
            parseHTML: (el) => el.getAttribute("data-id"),
            renderHTML: (attrs) => (attrs.id ? { "data-id": attrs.id } : {}),
          },
        },
      },
    ];
  },
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("blockIds"),
        appendTransaction: (trs, _old, state) => {
          if (!trs.some((t) => t.docChanged) && _old.doc.childCount === state.doc.childCount && state.doc.firstChild?.attrs.id)
            return null;
          const seen = new Set<string>();
          let tr = state.tr;
          let changed = false;
          state.doc.forEach((node, pos) => {
            if (!BLOCK_TYPES.includes(node.type.name)) return;
            const id = node.attrs.id as string | null;
            if (!id || seen.has(id)) {
              const fresh = blockId();
              tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, id: fresh });
              seen.add(fresh);
              changed = true;
            } else seen.add(id);
          });
          if (!changed) return null;
          tr.setMeta("addToHistory", false);
          return tr;
        },
      }),
    ];
  },
});

/** Paragraph with a screenplay `kind` (scene, action, character, …). */
export const KindParagraph = Paragraph.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      kind: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-kind"),
        renderHTML: (attrs) => (attrs.kind ? { "data-kind": attrs.kind } : {}),
      },
    };
  },
});
