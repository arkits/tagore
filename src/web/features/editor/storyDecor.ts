/**
 * Presentation decorations that themes hook into. Nothing here changes the document.
 *
 * Chat stories: every paragraph is a message. We tag it me/them, first/last of a run
 * (for tails, avatars and names), a per-speaker hue, a fake clock time, and "buzz".
 * Prose: dialogue paragraphs (opening with a quote mark) get `dlg`, alternating sides,
 * so e.g. the Manga theme can draw speech balloons.
 */
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { StoryFormat } from "@shared/doc";
import { speakerHue } from "@/lib/themes";

export type StoryConfig = { format: StoryFormat; pov: string };

let current: () => StoryConfig = () => ({ format: "prose", pov: "" });

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

export function isMe(speaker: string | null | undefined, cfg = current()): boolean {
  return !!speaker && !!cfg.pov && norm(speaker) === norm(cfg.pov);
}

/** Classes/attrs for a chat message element; shared with suggestion widgets so pending messages look real. */
export function messageAttrs(speaker: string | null | undefined, opts: { first?: boolean; last?: boolean; time?: string } = {}) {
  const cfg = current();
  if (cfg.format !== "chat") return { class: "" };
  if (!speaker) return { class: "msg-system" };
  const me = isMe(speaker, cfg);
  return {
    class: ["msg", me ? "msg-me" : "msg-them", opts.first !== false && "msg-first", opts.last !== false && "msg-last"].filter(Boolean).join(" "),
    style: `--hue:${speakerHue(speaker)}`,
    "data-initial": speaker.trim().slice(0, 1).toUpperCase(),
    ...(opts.time ? { "data-time": opts.time } : {}),
  };
}

/** Sender name as a real element, so themes keep ::before/::after for tails, ticks and timestamps. */
export function nameTag(speaker: string): HTMLElement {
  const el = document.createElement("span");
  el.className = "msg-name";
  el.contentEditable = "false";
  el.textContent = speaker;
  return el;
}

function clock(i: number) {
  const mins = 21 * 60 + 41 + i; // starts 9:41 PM
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

const QUOTE = /^[“"«「『‘'—]/;

function build(doc: PMNode, cfg: StoryConfig): DecorationSet {
  const decos: Decoration[] = [];
  const nodes: { node: PMNode; pos: number }[] = [];
  doc.forEach((node, pos) => nodes.push({ node, pos }));

  if (cfg.format === "chat") {
    let lastMe = -1;
    nodes.forEach(({ node }, i) => {
      if (node.type.name === "paragraph" && node.attrs.speaker && isMe(node.attrs.speaker, cfg)) lastMe = i;
    });
    let msgIndex = 0;
    nodes.forEach(({ node, pos }, i) => {
      const end = pos + node.nodeSize;
      if (node.type.name === "heading") {
        decos.push(Decoration.node(pos, end, { class: "msg-divider" }));
        return;
      }
      if (node.type.name !== "paragraph") return;
      const sp: string | null = node.attrs.speaker || null;
      const prev = nodes[i - 1]?.node;
      const next = nodes[i + 1]?.node;
      const same = (n?: PMNode) => !!n && n.type.name === "paragraph" && norm(n.attrs.speaker) === norm(sp) && !!sp;
      const a = messageAttrs(sp, { first: !same(prev), last: !same(next), time: sp ? clock(msgIndex++) : undefined }) as Record<string, string>;
      let cls = a.class;
      if (i === lastMe) cls += " msg-final-me";
      if (/\bbuzz\b/i.test(node.textContent)) cls += " msg-buzz";
      if (!node.content.size) cls += " msg-empty";
      decos.push(Decoration.node(pos, end, { ...a, class: cls }));
      if (sp)
        decos.push(
          Decoration.widget(pos + 1, () => nameTag(sp), { side: -1, key: `name-${sp}`, ignoreSelection: true, marks: [] }),
        );
    });
  } else {
    let k = 0;
    for (const { node, pos } of nodes) {
      if (node.type.name !== "paragraph") continue;
      if (QUOTE.test(node.textContent.trimStart())) {
        decos.push(Decoration.node(pos, pos + node.nodeSize, { class: `dlg ${k++ % 2 ? "dlg-r" : "dlg-l"}` }));
      } else k = 0;
    }
  }
  return DecorationSet.create(doc, decos);
}

export const StoryDecor = Extension.create<{ getConfig: () => StoryConfig }>({
  name: "storyDecor",
  addOptions() {
    return { getConfig: () => ({ format: "prose", pov: "" }) };
  },
  addProseMirrorPlugins() {
    const getConfig = this.options.getConfig;
    current = getConfig;
    let cache: { doc: PMNode; key: string; set: DecorationSet } | null = null;
    return [
      new Plugin({
        key: new PluginKey("storyDecor"),
        props: {
          decorations(state) {
            const cfg = getConfig();
            const key = `${cfg.format}|${cfg.pov}`;
            if (cache && cache.doc === state.doc && cache.key === key) return cache.set;
            cache = { doc: state.doc, key, set: build(state.doc, cfg) };
            return cache.set;
          },
        },
      }),
    ];
  },
});

/** Force a decoration refresh after the config (e.g. POV) changes. */
export function refreshStoryDecor(view: { dispatch: (tr: any) => void; state: { tr: any } }) {
  view.dispatch(view.state.tr.setMeta("storyDecor", Date.now()).setMeta("addToHistory", false));
}
