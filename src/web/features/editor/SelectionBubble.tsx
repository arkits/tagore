import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { ArrowRight, Maximize2, Minimize2, PenLine, Sparkles, X } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { AgentMode } from "@server/ai/context";
import type { StoryFormat } from "@shared/doc";

const PRESETS = (format: StoryFormat) => ({
  shorten:
    format === "chat"
      ? "Tighten these messages: fewer, shorter texts that say the same thing. Keep each person's voice."
      : "Tighten this: cut about a third of the words without losing meaning, voice or key detail.",
  expand:
    format === "chat"
      ? "Expand this exchange: a few more messages that deepen the moment — hesitation, subtext, a follow-up."
      : "Expand this: about half again as long, adding sensory detail, interiority and beats. Don't change what happens.",
});

/**
 * Floating actions on the selected text, like a docs comment bubble.
 *  - Polish: line-edit only (wording, rhythm, clarity); meaning and events stay the same.
 *  - Rewrite…: do whatever you describe to the selection (tone, content, events).
 *  - Shorten / Expand: one-click rewrites.
 */
export function SelectionBubble({
  editor,
  format,
  running,
  onRun,
}: {
  editor: Editor;
  format: StoryFormat;
  running: boolean;
  onRun: (mode: AgentMode, instruction: string) => void;
}) {
  const [asking, setAsking] = useState(false);
  const [text, setText] = useState("");
  const [words, setWords] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const upd = () => {
      const { from, to, empty } = editor.state.selection;
      if (empty) setAsking(false);
      setWords(empty ? 0 : editor.state.doc.textBetween(from, to, " ").split(/\s+/).filter(Boolean).length);
    };
    editor.on("selectionUpdate", upd);
    return () => {
      editor.off("selectionUpdate", upd);
    };
  }, [editor]);

  useEffect(() => {
    if (asking) requestAnimationFrame(() => inputRef.current?.focus());
  }, [asking]);

  const go = (mode: AgentMode, instruction = "") => {
    onRun(mode, instruction); // reads the selection synchronously
    setAsking(false);
    setText("");
    // Close the bubble: collapse the selection; the shimmer now marks what the agent is working on.
    const { to } = editor.state.selection;
    editor.chain().setTextSelection(to).blur().run();
  };

  // The manuscript scrolls inside its own column, not the window: track that for repositioning.
  const [scroller, setScroller] = useState<HTMLElement | null>(null);
  useEffect(() => setScroller(document.getElementById("manuscript-scroll")), []);

  const Action = ({ icon: Icon, label, hint, onClick }: { icon: React.ElementType; label: string; hint: string; onClick: () => void }) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()} // keep the editor's selection
          onClick={onClick}
          className="sel-bubble-btn inline-flex items-center gap-1.5 h-8 px-2.5 rounded-full text-[13px] hover:bg-accent transition-colors"
        >
          <Icon className="size-3.5 text-oxblood" />
          {label}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-56 text-center">
        {hint}
      </TooltipContent>
    </Tooltip>
  );

  return (
    <BubbleMenu
      editor={editor}
      appendTo={() => document.body}
      options={{ placement: "top", offset: 10, flip: true, shift: { padding: 12 }, scrollTarget: scroller ?? window }}
      shouldShow={({ editor: ed, view, state, element }) => {
        if (running || !ed.isEditable) return false;
        const { from, to, empty } = state.selection;
        if (empty || state.doc.textBetween(from, to).trim().length === 0) return false;
        return view.hasFocus() || element.contains(document.activeElement);
      }}
      className="sel-bubble z-40"
    >
      <div className="flex items-center gap-0.5 rounded-full border bg-popover/95 backdrop-blur px-1 py-1 shadow-lg animate-in fade-in-0 zoom-in-95 duration-150">
        {asking ? (
          <form
            className="flex items-center gap-1 pl-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (text.trim()) go("revise", text.trim());
            }}
          >
            <PenLine className="size-3.5 text-oxblood shrink-0" />
            <input
              ref={inputRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  setAsking(false);
                  editor.commands.focus();
                }
              }}
              placeholder="How should this change?"
              className="w-64 bg-transparent text-[13.5px] outline-none placeholder:text-muted-foreground px-1"
            />
            <button
              type="submit"
              disabled={!text.trim()}
              className="size-7 rounded-full grid place-items-center bg-primary text-primary-foreground disabled:opacity-40"
              title="Rewrite (Enter)"
            >
              <ArrowRight className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={() => {
                setAsking(false);
                editor.commands.focus();
              }}
              className="size-7 rounded-full grid place-items-center text-muted-foreground hover:bg-accent"
              title="Cancel (Esc)"
            >
              <X className="size-3.5" />
            </button>
          </form>
        ) : (
          <>
            <span className="px-2 text-[11px] tabular-nums text-muted-foreground whitespace-nowrap">
              {words} word{words === 1 ? "" : "s"}
            </span>
            <span className="h-4 w-px bg-border" />
            <Action icon={Sparkles} label="Polish" hint="Line-edit only: wording, rhythm, clarity. Meaning and events stay the same." onClick={() => go("polish")} />
            <Action icon={PenLine} label="Rewrite…" hint="Describe any change — tone, content, what happens — and the agent rewrites the selection." onClick={() => setAsking(true)} />
            <span className="h-4 w-px bg-border" />
            <Action icon={Minimize2} label="Shorten" hint={PRESETS(format).shorten} onClick={() => go("revise", PRESETS(format).shorten)} />
            <Action icon={Maximize2} label="Expand" hint={PRESETS(format).expand} onClick={() => go("revise", PRESETS(format).expand)} />
          </>
        )}
      </div>
    </BubbleMenu>
  );
}
