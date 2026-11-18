import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { BookOpen, Loader2, PenLine, Send, Square, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { queryClient, trpc } from "@/lib/trpc";
import { CONTEXT_MESSAGES } from "@shared/doc";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { AgentMode } from "@server/ai/context";
import type { AgentEvent } from "@/lib/agent";

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
  usage?: Extract<AgentEvent, { t: "done" }>["usage"];
  elapsedMs?: number;
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
  const [confirmClear, setConfirmClear] = useState(false);
  const log = useQuery(trpc.agent.log.queryOptions(chapterId));
  const history = (log.data ?? []).filter((m) => !(live?.runId && m.runId === live.runId));
  // Mirrors the context builder: only the most recent messages are replayed to the model.
  const firstInContext = Math.max(0, (log.data?.length ?? 0) - CONTEXT_MESSAGES);
  const invalidateLog = () => queryClient.invalidateQueries({ queryKey: trpc.agent.log.queryKey(chapterId) });
  const remove = useMutation(
    trpc.agent.deleteMessages.mutationOptions({
      onMutate: ({ ids }) => {
        const key = trpc.agent.log.queryKey(chapterId);
        const prev = queryClient.getQueryData(key);
        queryClient.setQueryData(key, (old: typeof log.data) => old?.filter((m) => !ids.includes(m.id)));
        return { prev };
      },
      onError: (_e, _v, ctx) => ctx?.prev && queryClient.setQueryData(trpc.agent.log.queryKey(chapterId), ctx.prev),
      onSettled: invalidateLog,
    }),
  );
  const clearLog = useMutation(trpc.agent.clearLog.mutationOptions({ onSettled: invalidateLog }));
  const chapter = useQuery(trpc.chapters.get.queryOptions(chapterId));
  const savedBeats = chapter.data?.notes.trim() ?? "";
  const clearBeats = useMutation(trpc.chapters.update.mutationOptions({
    onSuccess: async () => {
      queryClient.setQueryData(trpc.chapters.get.queryKey(chapterId), (old) => old && { ...old, notes: "" });
      setText((current) => current.trim() === savedBeats ? "" : current);
      await queryClient.invalidateQueries({ queryKey: trpc.chapters.get.queryKey(chapterId) });
    },
    onError: (error) => toast.error(`Couldn’t clear saved beats: ${error.message}`),
  }));
  const showContinue = !running && (live ? live.done : history.at(-1)?.role === "assistant");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [live?.text, live?.tools.length, live?.status.length, showContinue, log.data?.length]);

  const submit = (mode: "continue" | "custom" | "revise") => {
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
              Describe what you’d like to write or change. Edits arrive as tracked suggestions you can accept or reject.
            </p>
          </div>
        )}
        {!!history.length && (
          <div className="flex items-center justify-between text-[11px] text-muted-foreground -mt-1">
            <span className="small-caps tracking-wide">History</span>
            <button
              onClick={() => setConfirmClear(true)}
              disabled={running || clearLog.isPending}
              className="inline-flex items-center gap-1 hover:text-destructive disabled:opacity-40"
            >
              <Trash2 className="size-3" /> Clear
            </button>
          </div>
        )}
        {history.map((m, i) => (
          <div key={m.id}>
            {i === firstInContext && i > 0 && (
              <div className="flex items-center gap-2 text-[10.5px] text-muted-foreground my-1" title={`The last ${CONTEXT_MESSAGES} messages are sent to the agent with every request.`}>
                <span className="h-px flex-1 bg-border" />
                <span className="italic">agent sees from here</span>
                <span className="h-px flex-1 bg-border" />
              </div>
            )}
            <div className={cn("group relative", i < firstInContext && "opacity-55")}>
              {m.role === "user" ? (
                <UserBubble text={m.content} />
              ) : (
                <p className="font-book text-[15px] leading-relaxed text-ink pr-6">{m.content}</p>
              )}
              <button
                onClick={() => remove.mutate({ chapterId, ids: [m.id] })}
                disabled={running}
                title="Delete this message — the agent stops seeing it"
                aria-label="Delete message"
                className={cn(
                  "absolute top-1 size-6 rounded-full grid place-items-center text-muted-foreground bg-popover/90 border shadow-sm",
                  "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-destructive transition-opacity disabled:hidden",
                  m.role === "user" ? "-left-1" : "right-0",
                )}
              >
                <X className="size-3.5" />
              </button>
            </div>
          </div>
        ))}
        {live && <LiveRunView run={live} running={running} />}
        {showContinue && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            title="Carry the story forward from the end"
            onClick={() => submit("continue")}
          >
            <PenLine className="size-3.5 text-oxblood" /> Continue
          </Button>
        )}
        <div ref={endRef} />
      </div>

      <div className="border-t p-3 space-y-2 bg-sidebar/40">
        {hasSelection && (
          <p className="flex items-center gap-1.5 rounded-md bg-oxblood/8 px-2.5 py-1.5 text-[12px] text-ink-soft">
            <span className="size-1.5 rounded-full bg-oxblood shrink-0" />
            Text is selected: requests below apply to it. Use the bubble over the selection for quick edits.
          </p>
        )}
        {savedBeats && (
          <div className="flex items-center rounded-md border border-dashed">
            <button
              onClick={() => setText(savedBeats)}
              title={savedBeats}
              className="min-w-0 flex flex-1 items-baseline gap-2 px-2.5 py-1.5 rounded-l-md text-left text-[12.5px] hover:bg-accent/40"
            >
              <span className="small-caps text-[11px] text-oxblood shrink-0">beats</span>
              <span className="font-book italic text-ink-soft truncate flex-1">{savedBeats.replace(/\s+/g, " ")}</span>
              <span className="text-muted-foreground shrink-0">use as prompt</span>
            </button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7 mr-0.5 shrink-0 text-muted-foreground hover:text-destructive"
              title="Clear saved beats"
              aria-label="Clear saved beats"
              disabled={running || clearBeats.isPending}
              onClick={() => clearBeats.mutate({ id: chapterId, notes: "" })}
            >
              <X className="size-3.5" />
            </Button>
          </div>
        )}
        <div className="relative">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(hasSelection ? "revise" : "custom");
            }}
            rows={4}
            placeholder={
              hasSelection
                ? "What should change in the selection?"
                : "Give the agent a direction (⌘↵ to send)"
            }
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
      </div>
      <ConfirmDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title="Clear agent history?"
        description="This deletes the agent history for this chapter. The agent will no longer see those messages."
        action="Clear history"
        onConfirm={() => clearLog.mutate(chapterId)}
      />
    </div>
  );
}

function UserBubble({ text }: { text: string }) {
  const m = /^\[(\w+)\]\s*(.*)$/s.exec(text);
  const mode = m?.[1];
  const body = (m?.[2] ?? text).replace(/^\((\w+)\)$/, "").trim()
    || (mode === "polish" ? "Polish the wording, rhythm, and clarity." : "");
  return (
    <div className="ml-6 rounded-lg rounded-tr-sm bg-secondary/80 px-3 py-2 text-sm">
      {mode && mode !== "custom" && <span className="small-caps text-[11px] text-oxblood mr-1.5">{mode}</span>}
      {body}
    </div>
  );
}

function LiveRunView({ run, running }: { run: LiveRun; running: boolean }) {
  const cost = run.usage?.estimatedCostUsd;
  const duration = run.elapsedMs === undefined ? null : run.elapsedMs < 60_000
    ? `${(run.elapsedMs / 1000).toFixed(1)}s`
    : `${Math.floor(run.elapsedMs / 60_000)}m ${Math.floor(run.elapsedMs / 1000) % 60}s`;
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
          {(run.usage?.inputTokens !== undefined || run.usage?.outputTokens !== undefined)
            && ` · ${run.usage.inputTokens?.toLocaleString() ?? "—"} in / ${run.usage.outputTokens?.toLocaleString() ?? "—"} out tokens`}
          {" · "}
          <span title="Estimated USD cost at catalog input and output rates">{cost === undefined ? "Cost unavailable" : cost === 0 ? "$0.00 est." : cost < 0.0001 ? "<$0.0001 est." : `$${cost.toFixed(4)} est.`}</span>
          {duration && ` · ${duration}`}
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
