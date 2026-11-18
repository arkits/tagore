import { useEffect, useRef } from "react";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Bold, Clock3, Heading2, Italic, Minus, Pilcrow, Redo2, Undo2, UserRound } from "lucide-react";
import { BlockIds, SpeakerParagraph } from "./extensions";
import { Suggestions } from "./suggestions";
import { StoryDecor, refreshStoryDecor } from "./storyDecor";
import type { PMDoc, StoryFormat } from "@shared/doc";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export type SuggestionHandlers = {
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
  onFocus?: (id: string) => void;
};

export function Manuscript({
  initial,
  format,
  pov,
  speakers,
  handlers,
  onChange,
  onReady,
}: {
  initial: PMDoc;
  format: StoryFormat;
  /** Chat: whose screen this is. */
  pov: string;
  /** Chat: names available as senders. */
  speakers: string[];
  handlers: { current: SuggestionHandlers };
  onChange: (doc: PMDoc) => void;
  onReady: (editor: Editor | null) => void;
}) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const cfgRef = useRef({ format, pov });
  cfgRef.current = { format, pov };

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        paragraph: false,
        blockquote: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        listKeymap: false,
        codeBlock: false,
        code: false,
        link: false,
        underline: false,
        heading: { levels: [1, 2, 3] },
      }),
      SpeakerParagraph,
      BlockIds,
      StoryDecor.configure({ getConfig: () => cfgRef.current }),
      Suggestions.configure({ getHandlers: () => handlers.current }),
      Placeholder.configure({
        placeholder: () =>
          cfgRef.current.format === "chat"
            ? "Start the conversation below — or give the agent your beats and press Draft…"
            : "Begin here — or type your ideas in the agent panel and press Draft…",
      }),
    ],
    content: initial,
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    editorProps: { attributes: { spellcheck: "true" } },
    onUpdate: ({ editor, transaction }) => {
      if (transaction.docChanged) onChangeRef.current(editor.getJSON() as PMDoc);
    },
  });

  useEffect(() => {
    onReady(editor);
    return () => onReady(null);
  }, [editor, onReady]);

  // Re-tag messages when the POV or format changes.
  useEffect(() => {
    if (editor && !editor.isDestroyed) refreshStoryDecor(editor.view);
  }, [editor, format, pov]);

  return (
    <div className="relative">
      {editor && <Toolbar editor={editor} format={format} speakers={speakers} pov={pov} />}
      <div className={cn("manuscript", format === "chat" ? "chat-format" : "prose-format")}>
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

function Toolbar({ editor, format, speakers, pov }: { editor: Editor; format: StoryFormat; speakers: string[]; pov: string }) {
  const s = useEditorState({
    editor,
    selector: ({ editor }) => ({
      bold: editor.isActive("bold"),
      italic: editor.isActive("italic"),
      h: editor.isActive("heading"),
      speaker: (editor.getAttributes("paragraph").speaker as string | null) ?? null,
      canUndo: editor.can().undo(),
      canRedo: editor.can().redo(),
    }),
  });

  const Btn = ({ on, label, active, disabled, children }: { on: () => void; label: string; active?: boolean; disabled?: boolean; children: React.ReactNode }) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          onMouseDown={(e) => {
            e.preventDefault();
            on();
          }}
          className={cn(
            "h-7 min-w-7 px-1.5 rounded inline-flex items-center justify-center text-ink-soft hover:bg-accent disabled:opacity-35",
            active && "bg-accent text-ink",
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );

  const chat = format === "chat";
  const setSpeaker = (name: string | null) => editor.chain().focus().setParagraph().updateAttributes("paragraph", { speaker: name }).run();

  return (
    <div className="editor-toolbar sticky top-3 z-10 -mx-4 mb-8 flex justify-center pointer-events-none">
      <div className="pointer-events-auto flex items-center gap-0.5 rounded-full border bg-popover/90 backdrop-blur px-2 py-1 shadow-sm">
        <Btn label="Undo (⌘Z)" on={() => editor.chain().focus().undo().run()} disabled={!s.canUndo}>
          <Undo2 className="size-3.5" />
        </Btn>
        <Btn label="Redo (⇧⌘Z)" on={() => editor.chain().focus().redo().run()} disabled={!s.canRedo}>
          <Redo2 className="size-3.5" />
        </Btn>
        <div className="mx-1 h-4 w-px bg-border" />
        <Btn label="Bold (⌘B)" active={s.bold} on={() => editor.chain().focus().toggleBold().run()}>
          <Bold className="size-3.5" />
        </Btn>
        <Btn label="Italic (⌘I)" active={s.italic} on={() => editor.chain().focus().toggleItalic().run()}>
          <Italic className="size-3.5" />
        </Btn>
        <div className="mx-1 h-4 w-px bg-border" />
        {chat ? (
          <>
            <DropdownMenu>
              <DropdownMenuTrigger
                onMouseDown={(e) => e.preventDefault()}
                className="h-7 px-2 rounded inline-flex items-center gap-1.5 text-[13px] text-ink-soft hover:bg-accent max-w-40"
              >
                <UserRound className="size-3.5 shrink-0" />
                <span className="truncate">{s.h ? "Divider" : s.speaker || "System line"}</span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="center" onCloseAutoFocus={(e) => e.preventDefault()}>
                <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">This message is from…</DropdownMenuLabel>
                {speakers.map((n) => (
                  <DropdownMenuItem key={n} onSelect={() => setSpeaker(n)}>
                    {n}
                    {n === pov && <span className="ml-auto text-[11px] text-muted-foreground">me</span>}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setSpeaker(null)}>System line</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Btn label="Time divider" active={s.h} on={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
              <Clock3 className="size-3.5" />
            </Btn>
          </>
        ) : (
          <>
            <Btn label="Body text" active={!s.h} on={() => editor.chain().focus().setParagraph().run()}>
              <Pilcrow className="size-3.5" />
            </Btn>
            <Btn label="Heading" active={s.h} on={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
              <Heading2 className="size-3.5" />
            </Btn>
            <Btn label="Scene break" on={() => editor.chain().focus().setHorizontalRule().run()}>
              <Minus className="size-3.5" />
            </Btn>
          </>
        )}
      </div>
    </div>
  );
}
