import { useEffect, useRef } from "react";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Bold, Heading2, Italic, Minus, Pilcrow, Redo2, Undo2 } from "lucide-react";
import { BlockIds, KindParagraph } from "./extensions";
import { Suggestions } from "./suggestions";
import { SCRIPT_KINDS, type PMDoc, type ScriptKind, type StoryFormat } from "@shared/doc";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export type SuggestionHandlers = {
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
  onFocus?: (id: string) => void;
};

export function Manuscript({
  initial,
  format,
  handlers,
  onChange,
  onReady,
}: {
  initial: PMDoc;
  format: StoryFormat;
  handlers: { current: SuggestionHandlers };
  onChange: (doc: PMDoc) => void;
  onReady: (editor: Editor | null) => void;
}) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

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
      KindParagraph,
      BlockIds,
      Suggestions.configure({ getHandlers: () => handlers.current }),
      Placeholder.configure({
        placeholder:
          format === "script"
            ? "INT. SOMEWHERE – NIGHT. Start writing, or give the agent your beats and press Draft…"
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

  return (
    <div className="relative">
      {editor && <Toolbar editor={editor} format={format} />}
      <div className={cn("manuscript", format === "script" ? "script-format" : "prose-format")}>
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

const KIND_LABEL: Record<ScriptKind, string> = {
  scene: "Scene heading",
  action: "Action",
  character: "Character",
  parenthetical: "Parenthetical",
  dialogue: "Dialogue",
  transition: "Transition",
};

function Toolbar({ editor, format }: { editor: Editor; format: StoryFormat }) {
  const s = useEditorState({
    editor,
    selector: ({ editor }) => ({
      bold: editor.isActive("bold"),
      italic: editor.isActive("italic"),
      h: editor.isActive("heading"),
      kind: (editor.getAttributes("paragraph").kind as ScriptKind | null) ?? null,
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

  return (
    <div className="sticky top-3 z-10 -mx-4 mb-8 flex justify-center pointer-events-none">
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
        <Btn label="Body text" active={!s.h && !s.kind} on={() => editor.chain().focus().setParagraph().updateAttributes("paragraph", { kind: null }).run()}>
          <Pilcrow className="size-3.5" />
        </Btn>
        <Btn label="Heading" active={s.h} on={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
          <Heading2 className="size-3.5" />
        </Btn>
        <Btn label="Scene break" on={() => editor.chain().focus().setHorizontalRule().run()}>
          <Minus className="size-3.5" />
        </Btn>
        {format === "script" && (
          <>
            <div className="mx-1 h-4 w-px bg-border" />
            {SCRIPT_KINDS.map((k) => (
              <Btn
                key={k}
                label={KIND_LABEL[k]}
                active={s.kind === k}
                on={() => editor.chain().focus().setParagraph().updateAttributes("paragraph", { kind: k }).run()}
              >
                <span className="font-script text-[11px] uppercase">{k.slice(0, 4)}</span>
              </Btn>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
