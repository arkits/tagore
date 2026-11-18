import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { ArrowUp, Sparkles } from "lucide-react";
import { speakerHue } from "@/lib/themes";
import { cn } from "@/lib/utils";
import { blockId } from "@shared/doc";

export type Participant = { name: string; avatar: string | null };

const TITLE: Record<string, (who: string) => string> = {
  aim: (w) => `${w} - Instant Message`,
  yahoo: (w) => `${w} -- Instant Message`,
  skype: (w) => `Skype™ — ${w}`,
};
const STATUS: Record<string, string> = { whatsapp: "online", skype: "Online", imessage: "iMessage" };

function Avatar({ p, size = 36 }: { p: Participant; size?: number }) {
  return p.avatar ? (
    <img src={p.avatar} alt="" className="chat-avatar" style={{ width: size, height: size }} />
  ) : (
    <span className="chat-avatar chat-avatar-initial" style={{ width: size, height: size, ["--hue" as any]: speakerHue(p.name) }}>
      {p.name.slice(0, 1).toUpperCase()}
    </span>
  );
}

/** The thread's header: phone contact bar, or a desktop messenger's title bar. Themes decide which parts show. */
export function ChatHeader({ theme, others, pov }: { theme: string; others: Participant[]; pov: string }) {
  const who = others.length ? others.map((o) => o.name).join(", ") : "New conversation";
  const title = (TITLE[theme] ?? ((w: string) => w))(who);
  return (
    <div className="chat-header" contentEditable={false}>
      <div className="chat-titlebar">
        <span className="chat-logo" aria-hidden />
        <span className="chat-title">{title}</span>
        <span className="chat-winbtns" aria-hidden>
          <i>_</i>
          <i>□</i>
          <i>×</i>
        </span>
      </div>
      <div className="chat-menubar" aria-hidden>
        <span>File</span>
        <span>Edit</span>
        <span>Insert</span>
        <span>People</span>
      </div>
      <div className="chat-contact">
        <span className="chat-back" aria-hidden>
          ‹
        </span>
        <span className="chat-avatars">
          {others.slice(0, 3).map((o) => (
            <Avatar key={o.name} p={o} />
          ))}
          {!others.length && <Avatar p={{ name: "?", avatar: null }} />}
        </span>
        <span className="chat-who">
          <b>{who}</b>
          <small className="chat-status">{others.length > 1 ? `${others.length + 1} people` : STATUS[theme] ?? ""}</small>
        </span>
        {pov && <span className="chat-pov">as {pov}</span>}
      </div>
    </div>
  );
}

/**
 * Compose box at the foot of the thread. Sending appends a real message (it's the author's own
 * writing). Sending from the phone’s owner also asks the agent for a reply.
 */
export function ChatComposer({
  editor,
  speakers,
  pov,
  theme,
  busy,
  awaitingReply,
  onReply,
}: {
  editor: Editor | null;
  speakers: string[];
  pov: string;
  theme: string;
  busy: boolean;
  awaitingReply: boolean;
  onReply: () => void;
}) {
  const [as, setAs] = useState(pov || speakers[0] || "Me");
  const [text, setText] = useState("");
  const taRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (pov) setAs(pov);
  }, [pov]);
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "0px";
    ta.style.height = `${Math.min(ta.scrollHeight, 140)}px`;
  }, [text]);

  const send = () => {
    const t = text.trim();
    if (!editor || !t || busy) return;
    const doc = editor.state.doc;
    const last = doc.lastChild;
    const nodes = t.split(/\n+/).map((line) => ({
      type: "paragraph",
      attrs: { id: blockId(), speaker: as === "__system" ? null : as },
      content: [{ type: "text", text: line }],
    }));
    const chain = editor.chain();
    if (last && last.type.name === "paragraph" && last.content.size === 0) {
      chain.insertContentAt({ from: doc.content.size - last.nodeSize, to: doc.content.size }, nodes);
    } else chain.insertContentAt(doc.content.size, nodes);
    if (!chain.run()) return;
    setText("");
    taRef.current?.focus();
    if (as === pov) onReply();
    requestAnimationFrame(() => {
      const el = editor.view.dom.lastElementChild as HTMLElement | null;
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  };

  const sendLabel = theme === "aim" || theme === "yahoo" || theme === "skype" ? "Send" : "";

  return (
    <div className="chat-composer">
      <div className="chat-fmtbar" aria-hidden>
        <b>A</b>
        <b className="small">A</b>
        <b>B</b>
        <i>I</i>
        <u>U</u>
        <span>link</span>
        <span>☺</span>
      </div>
      <div role="status" className="sr-only">{awaitingReply ? "Typing…" : ""}</div>
      {awaitingReply && (
        <div className="chat-typing-bubble" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      )}
      <div className="chat-compose-row">
        <select className="chat-as" value={as} onChange={(e) => setAs(e.target.value)} title="Send as">
          {speakers.map((n) => (
            <option key={n} value={n}>
              {n}
              {n === pov ? " (me)" : ""}
            </option>
          ))}
          <option value="__system">— system line —</option>
        </select>
        <textarea
          ref={taRef}
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
          placeholder={theme === "imessage" ? "iMessage" : theme === "whatsapp" ? "Message" : `Type as ${as === "__system" ? "system" : as}…`}
          className="chat-input"
        />
        <button className={cn("chat-send", !text.trim() && "is-empty")} onClick={send} disabled={busy || !text.trim()} title="Send (Enter)">
          {sendLabel || <ArrowUp className="size-4" strokeWidth={2.75} />}
        </button>
        <button className="chat-reply" onClick={onReply} disabled={busy} title="Let them reply (agent continues the conversation)">
          <Sparkles className="size-4" />
        </button>
      </div>
    </div>
  );
}
