import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, Feather, Loader2, PenLine, Send, Sparkles, Square, Wand2, Eye } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { AgentMode } from "@server/ai/context";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export type LiveRun = {
  mode: AgentMode;
  instruction: string;
  status: string[];
  text: string;
  tools: { id: string; name: string; chars: number; done?: boolean; ok?: boolean; message?: string }[];
  context?: { sections: { name: string; tokens: number; detail?: string }[]; total: number; budget: number; model: string };
  error?: string;
  done?: boolean;
  suggestions: number;
  usage?: { inputTokens?: number; outputTokens?: number };
  runId?: string;
};

const TOOL_VERB: Record<string, string> = {
  insert_after: "Writing new passage",
  rewrite_block: "Rewriting paragraph",
  replace_text: "Line edit",
  delete_blocks: "Marking cuts",
  read_blocks: "Re-reading the chapter",
  read_chapter: "Reading another chapter",
  search_manuscript: "Searching the manuscript",
};

const QUICK: { mode: AgentMode; label: string; icon: React.ElementType; hint: string }[] = [
  { mode: "draft", label: "Draft from notes", icon: Feather, hint: "Write the chapter from your notes & ideas" },
  { mode: "continue", label: "Continue", icon: PenLine, hint: "Carry the story forward from the end" },
  { mode: "polish", label: "Polish", icon: Sparkles, hint: "Line-edit prose (selection or chapter)" },
  { mode: "revise", label: "Revise selection", icon: Wand2, hint: "Rework the selected passage per your note" },
];

export function AgentPanel({
  chapterId,
  live,
  running,
  hasSelection,
  onRun,
  onStop,
}: {
  chapterId: string;
  live: LiveRun | null;
  running: boolean;
  hasSelection: boolean;
  onRun: (mode: AgentMode, instruction: string) => void;
  onStop: () => void;
}) {
  const [text, setText] = useState("");
  const [preview, setPreview] = useState(false);
  const log = useQuery(trpc.agent.log.queryOptions(chapterId));
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [live?.text, live?.tools.length, live?.status.length, log.data?.length]);

  const submit = (mode: AgentMode) => {
    if (running) return;
    onRun(mode, text);
    setText("");
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex-1 overflow-y-auto thin-scroll px-4 py-4 space-y-4">
        {!log.data?.length && !live && (
          <div className="text-center px-4 pt-8 pb-4">
            <p className="font-display text-xl text-ink-soft">Your co-author</p>
            <p className="font-book text-[15px] text-muted-foreground mt-2 leading-relaxed">
              Write your ideas in <em>Notes</em>, then ask for a draft. Every change arrives as a tracked suggestion you can accept or reject.
            </p>
          </div>
        )}
        {log.data
          ?.filter((m) => !(live?.runId && m.runId === live.runId))
          .map((m) =>
            m.role === "user" ? (
              <UserBubble key={m.id} text={m.content} />
            ) : (
              <p key={m.id} className="font-book text-[15px] leading-relaxed text-ink">
                {m.content}
              </p>
            ),
          )}
        {live && <LiveRunView run={live} running={running} />}
        <div ref={endRef} />
      </div>

      <div className="border-t p-3 space-y-2 bg-sidebar/40">
        <div className="grid grid-cols-2 gap-1.5">
          {QUICK.map((q) => (
            <button
              key={q.mode}
              title={q.hint}
              disabled={running || (q.mode === "revise" && !hasSelection)}
              onClick={() => submit(q.mode)}
              className="flex items-center gap-2 rounded-md border bg-popover/60 px-2.5 py-1.5 text-[13px] hover:bg-accent disabled:opacity-40 disabled:pointer-events-none text-left"
            >
              <q.icon className="size-3.5 text-oxblood shrink-0" />
              {q.label}
            </button>
          ))}
        </div>
        <div className="relative">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(hasSelection ? "revise" : "custom");
            }}
            rows={3}
            placeholder={hasSelection ? "What should change in the selection?" : "Direct the agent… (⌘↵ to send)"}
            className="pr-11 resize-none font-book text-[15px] bg-popover/70"
          />
          {running ? (
            <Button size="icon" variant="secondary" className="absolute right-2 bottom-2 size-8" onClick={onStop} title="Stop">
              <Square className="size-3.5 fill-current" />
            </Button>
          ) : (
            <Button
              size="icon"
              className="absolute right-2 bottom-2 size-8"
              disabled={!text.trim()}
              onClick={() => submit(hasSelection ? "revise" : "custom")}
              title="Send"
            >
              <Send className="size-3.5" />
            </Button>
          )}
        </div>
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>{hasSelection ? "Selection will be the focus." : "Applies to this chapter."}</span>
          <button className="inline-flex items-center gap-1 hover:text-ink" onClick={() => setPreview(true)}>
            <Eye className="size-3" /> What the agent sees
          </button>
        </div>
      </div>
      <ContextPreview chapterId={chapterId} open={preview} onOpenChange={setPreview} instruction={text} />
    </div>
  );
}

function UserBubble({ text }: { text: string }) {
  const m = /^\[(\w+)\]\s*(.*)$/s.exec(text);
  const mode = m?.[1];
  const body = m?.[2] ?? text;
  return (
    <div className="ml-6 rounded-lg rounded-tr-sm bg-secondary/80 px-3 py-2 text-sm">
      {mode && mode !== "custom" && <span className="small-caps text-[11px] text-oxblood mr-1.5">{mode}</span>}
      {body.replace(/^\((\w+)\)$/, "")}
    </div>
  );
}

function LiveRunView({ run, running }: { run: LiveRun; running: boolean }) {
  return (
    <div className="space-y-2.5">
      <UserBubble text={`[${run.mode}] ${run.instruction || ""}`} />
      {run.context && <ContextMeter ctx={run.context} />}
      {run.status.map((s, i) => (
        <p key={i} className="text-xs text-muted-foreground italic">
          {s}
        </p>
      ))}
      {run.tools.map((t) => (
        <div key={t.id} className={cn("flex items-center gap-2 text-[13px]", t.ok === false ? "text-destructive" : "text-ink-soft")}>
          {!t.done ? <Loader2 className="size-3.5 animate-spin" /> : t.ok ? <span className="text-sage">✓</span> : <span>✕</span>}
          <span>{TOOL_VERB[t.name] ?? t.name}</span>
          {!t.done && t.chars > 200 && <span className="text-xs text-muted-foreground tabular-nums">~{Math.round(t.chars / 6)} words</span>}
          {t.done && t.ok === false && <span className="text-xs truncate" title={t.message}>{t.message}</span>}
        </div>
      ))}
      {run.text && <p className={cn("font-book text-[15px] leading-relaxed", running && "caret")}>{run.text}</p>}
      {running && !run.text && !run.tools.some((t) => !t.done) && (
        <p className="text-sm text-muted-foreground italic flex items-center gap-2">
          <Loader2 className="size-3.5 animate-spin" /> Thinking…
        </p>
      )}
      {run.error && <p className="text-sm text-destructive rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">{run.error}</p>}
      {run.done && (
        <p className="text-xs text-muted-foreground">
          {run.suggestions} suggestion{run.suggestions === 1 ? "" : "s"}
          {run.usage?.inputTokens ? ` · ${run.usage.inputTokens.toLocaleString()} in / ${run.usage.outputTokens?.toLocaleString()} out tokens` : ""}
        </p>
      )}
    </div>
  );
}

const SECTION_COLORS = ["#8a3b22", "#a8673d", "#c79a5b", "#7b8a4a", "#4d6a3c", "#5b6f80", "#7a5c80", "#9c8b70", "#3f3a35"];

function ContextMeter({ ctx }: { ctx: NonNullable<LiveRun["context"]> }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-md border bg-popover/50 px-2.5 py-2">
      <button className="w-full flex items-center gap-2 text-[11px] text-muted-foreground" onClick={() => setOpen(!open)}>
        <BookOpen className="size-3" />
        <span>
          Context {ctx.total.toLocaleString()} / {ctx.budget.toLocaleString()} tokens
        </span>
        <span className="ml-auto truncate max-w-[50%]">{ctx.model.split(":").slice(1).join(":")}</span>
      </button>
      <div className="mt-1.5 flex h-1.5 rounded-full overflow-hidden bg-secondary">
        {ctx.sections.map((s, i) => (
          <div key={s.name} title={`${s.name}: ${s.tokens}`} style={{ width: `${(s.tokens / ctx.budget) * 100}%`, background: SECTION_COLORS[i % SECTION_COLORS.length] }} />
        ))}
      </div>
      {open && (
        <ul className="mt-2 space-y-0.5">
          {ctx.sections.map((s, i) => (
            <li key={s.name} className="flex items-center gap-2 text-[11px]">
              <span className="size-2 rounded-sm" style={{ background: SECTION_COLORS[i % SECTION_COLORS.length] }} />
              <span>{s.name}</span>
              {s.detail && <span className="text-muted-foreground">· {s.detail}</span>}
              <span className="ml-auto tabular-nums text-muted-foreground">{s.tokens.toLocaleString()}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ContextPreview({ chapterId, open, onOpenChange, instruction }: { chapterId: string; open: boolean; onOpenChange: (o: boolean) => void; instruction: string }) {
  const q = useQuery({ ...trpc.chapters.contextPreview.queryOptions({ chapterId, mode: "custom", instruction }), enabled: open });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="font-display font-normal text-2xl">What the agent sees</DialogTitle>
        </DialogHeader>
        {q.data && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {q.data.sections.map((s) => (
              <span key={s.name}>
                {s.name} <span className="tabular-nums text-ink">{s.tokens.toLocaleString()}</span>
                {s.detail ? ` (${s.detail})` : ""}
              </span>
            ))}
            <span className="font-medium text-ink">Total ≈ {q.data.total.toLocaleString()} tokens</span>
          </div>
        )}
        <pre className="flex-1 overflow-auto thin-scroll rounded-md border bg-paper p-4 text-xs whitespace-pre-wrap font-script leading-relaxed">
          {q.isLoading ? "Loading…" : q.error ? q.error.message : `${q.data?.system}\n\n────────────────────────────────────────\n\n${q.data?.prompt}`}
        </pre>
      </DialogContent>
    </Dialog>
  );
}
