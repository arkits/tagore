import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import type { Editor } from "@tiptap/react";
import { toast } from "sonner";
import { CheckCheck, PanelLeftClose, PanelLeftOpen, RotateCcw, ScrollText, Settings2, X } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { queryClient, trpc, type Suggestion } from "@/lib/trpc";
import { runAgent, type AgentEvent } from "@/lib/agent";
import { Manuscript, type SuggestionHandlers } from "../editor/Manuscript";
import { applySuggestion, isApplicable, revealSuggestion, setSuggestions, type EditorSuggestion } from "../editor/suggestions";
import { AgentPanel, type LiveRun } from "../agent/AgentPanel";
import { ChangesPanel } from "../agent/ChangesPanel";
import { SummaryPage } from "./SummaryPage";
import { Sidebar } from "./Sidebar";
import { ModelPicker } from "../settings/ModelPicker";
import { ThemeToggle } from "@/components/ThemeToggle";
import { SettingsDialog } from "../settings/SettingsDialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import type { AgentMode } from "@server/ai/context";
import type { PMDoc } from "@shared/doc";
import { cn } from "@/lib/utils";

type SaveState = "saved" | "dirty" | "saving" | "error";

export function Workspace({ projectId, chapterId }: { projectId: string; chapterId?: string }) {
  const [, navigate] = useLocation();
  const project = useQuery(trpc.projects.get.queryOptions(projectId));
  const chapters = useQuery(trpc.chapters.list.queryOptions(projectId));

  useEffect(() => {
    if (!chapterId && chapters.data?.length) navigate(`/p/${projectId}/${chapters.data[0]!.id}`, { replace: true });
  }, [chapterId, chapters.data, projectId, navigate]);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    try {
      return localStorage.getItem("tagore.sidebar") !== "closed";
    } catch {
      return true;
    }
  });
  const toggleSidebar = useCallback(() => {
    setSidebarOpen((o) => {
      try {
        localStorage.setItem("tagore.sidebar", o ? "closed" : "open");
      } catch {}
      return !o;
    });
  }, []);
  // ⌘\ / Ctrl+\ toggles the sidebar (works while typing in the manuscript too).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "\\" || e.code === "Backslash")) {
        e.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleSidebar]);

  return (
    <div className="h-full flex flex-col">
      <header className="h-12 shrink-0 flex items-center gap-3 px-4 border-b bg-sidebar/60 backdrop-blur">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={toggleSidebar}
              aria-label={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
              aria-expanded={sidebarOpen}
              className="-ml-1.5 size-8 rounded-md grid place-items-center text-ink-soft hover:bg-accent hover:text-ink transition-colors"
            >
              {sidebarOpen ? <PanelLeftClose className="size-4" /> : <PanelLeftOpen className="size-4" />}
            </button>
          </TooltipTrigger>
          <TooltipContent>
            {sidebarOpen ? "Hide sidebar" : "Show sidebar"} <kbd className="ml-1 opacity-70">⌘\</kbd>
          </TooltipContent>
        </Tooltip>
        <Link href="/" className="font-display text-xl tracking-tight text-oxblood hover:opacity-80">
          Tagore
        </Link>
        <span className="text-muted-foreground">/</span>
        <span className="font-display text-[17px] truncate">{project.data?.title}</span>
        <div className="flex-1" />
        <ModelPicker compact />
        <ThemeToggle />
        <Button variant="ghost" size="icon" onClick={() => setSettingsOpen(true)} title="Settings">
          <Settings2 className="size-4" />
        </Button>
      </header>
      <div className="flex-1 flex min-h-0">
        <div
          inert={!sidebarOpen}
          className={cn(
            "shrink-0 overflow-hidden flex transition-[width,opacity] duration-300 ease-[cubic-bezier(0.2,0.7,0.2,1)]",
            sidebarOpen ? "w-64 opacity-100" : "w-0 opacity-0",
          )}
        >
          <Sidebar projectId={projectId} chapterId={chapterId} />
        </div>
        {chapterId && project.data ? (
          <ChapterSession key={chapterId} projectId={projectId} chapterId={chapterId} format={project.data.format} />
        ) : (
          <div className="flex-1" />
        )}
      </div>
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}

function toEditorSuggestion(s: Suggestion): EditorSuggestion {
  return { id: s.id, op: s.op, note: s.note };
}

function ChapterSession({ projectId, chapterId, format }: { projectId: string; chapterId: string; format: "prose" | "script" }) {
  const chapter = useQuery({ ...trpc.chapters.get.queryOptions(chapterId), staleTime: Infinity });
  const pending = useQuery({ ...trpc.suggestions.pending.queryOptions(chapterId), staleTime: Infinity });
  const [editor, setEditor] = useState<Editor | null>(null);
  const [list, setList] = useState<EditorSuggestion[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [tab, setTab] = useState("agent");
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [words, setWords] = useState<number | null>(null);
  const [live, setLive] = useState<LiveRun | null>(null);
  const [running, setRunning] = useState(false);
  const [hasSelection, setHasSelection] = useState(false);
  const [docVersion, setDocVersion] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const listRef = useRef(list);
  listRef.current = list;

  /* -------------------------------------------------- saving */
  const saveContent = useMutation(trpc.chapters.saveContent.mutationOptions()).mutateAsync;
  const pendingDoc = useRef<PMDoc | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = useRef<Promise<unknown> | null>(null);

  const flush = useCallback(async () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    if (inflight.current) await inflight.current.catch(() => {});
    const doc = pendingDoc.current;
    if (!doc) return;
    pendingDoc.current = null;
    setSaveState("saving");
    const p = saveContent({ id: chapterId, content: doc })
      .then((r) => {
        setWords(r.wordCount);
        setSaveState(pendingDoc.current ? "dirty" : "saved");
        queryClient.invalidateQueries({ queryKey: trpc.chapters.list.queryKey(projectId) });
      })
      .catch((e) => {
        pendingDoc.current ??= doc;
        setSaveState("error");
        toast.error(`Save failed: ${e.message}`);
      });
    inflight.current = p;
    await p;
    inflight.current = null;
  }, [chapterId, projectId, saveContent]);

  const onChange = useCallback(
    (doc: PMDoc) => {
      pendingDoc.current = doc;
      setSaveState("dirty");
      setDocVersion((v) => v + 1);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(flush, 800);
    },
    [flush],
  );

  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => {
    const before = () => {
      if (pendingDoc.current) void flushRef.current();
    };
    window.addEventListener("beforeunload", before);
    return () => {
      // Runs only on unmount (chapter switch / leaving the project).
      window.removeEventListener("beforeunload", before);
      before();
      abortRef.current?.abort();
    };
  }, []);

  /* -------------------------------------------------- suggestions */
  useEffect(() => {
    if (pending.data) setList(pending.data.map(toEditorSuggestion));
  }, [pending.data]);

  useEffect(() => {
    if (editor) setSuggestions(editor, list, active);
  }, [editor, list, active]);

  useEffect(() => {
    if (!editor) return;
    const upd = () => setHasSelection(!editor.state.selection.empty);
    editor.on("selectionUpdate", upd);
    return () => {
      editor.off("selectionUpdate", upd);
    };
  }, [editor]);

  const stale = useMemo(() => {
    const s = new Set<string>();
    if (editor) for (const x of list) if (!isApplicable(editor.state.doc, x.op)) s.add(x.id);
    return s;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, editor, docVersion]);

  const resolveMutate = useMutation(trpc.suggestions.resolve.mutationOptions()).mutate;
  const resolve = useCallback(
    (ids: string[], status: "accepted" | "rejected") => {
      if (!ids.length) return;
      setList((l) => l.filter((s) => !ids.includes(s.id)));
      resolveMutate({ ids, status });
    },
    [resolveMutate],
  );

  const accept = useCallback(
    (id: string) => {
      const s = listRef.current.find((x) => x.id === id);
      if (!s || !editor) return;
      const ok = applySuggestion(editor, s.op);
      if (!ok) toast.message("That suggestion no longer matches the text — dismissed.");
      resolve([id], ok ? "accepted" : "rejected");
    },
    [editor, resolve],
  );
  const reject = useCallback((id: string) => resolve([id], "rejected"), [resolve]);
  const acceptAll = useCallback(() => {
    if (!editor) return;
    const ok: string[] = [];
    const bad: string[] = [];
    for (const s of listRef.current) (applySuggestion(editor, s.op) ? ok : bad).push(s.id);
    resolve(ok, "accepted");
    resolve(bad, "rejected");
    if (bad.length) toast.message(`${bad.length} outdated suggestion${bad.length > 1 ? "s" : ""} skipped.`);
  }, [editor, resolve]);
  const rejectAll = useCallback(() => resolve(listRef.current.map((s) => s.id), "rejected"), [resolve]);
  const focus = useCallback(
    (id: string) => {
      setActive(id);
      if (editor) requestAnimationFrame(() => revealSuggestion(editor, id));
    },
    [editor],
  );

  const handlers = useRef<SuggestionHandlers>({ onAccept: accept, onReject: reject, onFocus: focus });
  handlers.current = { onAccept: accept, onReject: reject, onFocus: (id) => (setActive(id), setTab("changes")) };

  /* -------------------------------------------------- agent */
  const run = useCallback(
    async (mode: AgentMode, instruction: string, beats?: string) => {
      if (!editor || running) return;
      await flush();
      const { from, to, empty } = editor.state.selection;
      const selectionIds: string[] = [];
      let focusId: string | null = null;
      editor.state.doc.forEach((node, pos) => {
        const end = pos + node.nodeSize;
        if (!empty && end > from && pos < to && node.attrs.id) selectionIds.push(node.attrs.id);
        if (from >= pos && from <= end && node.attrs.id) focusId ??= node.attrs.id;
      });
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setRunning(true);
      setTab("agent");
      setLive({ mode, instruction: instruction || beats || "", status: [], text: "", tools: [], suggestions: 0 });
      const seen = new Set<string>();
      const onEvent = (e: AgentEvent) => {
        switch (e.t) {
          case "status":
            setLive((l) => l && { ...l, status: [...l.status, e.message] });
            break;
          case "context":
            setLive((l) => l && { ...l, context: e });
            break;
          case "text":
            setLive((l) => l && { ...l, text: l.text + e.delta });
            break;
          case "tool-start":
            setLive((l) => l && { ...l, tools: [...l.tools, { id: e.id, name: e.name, chars: 0 }] });
            break;
          case "tool-progress":
            setLive((l) => l && { ...l, tools: l.tools.map((t) => (t.id === e.id ? { ...t, chars: e.chars } : t)) });
            break;
          case "tool-result":
            setLive(
              (l) =>
                l && {
                  ...l,
                  tools: l.tools.some((t) => t.id === e.id)
                    ? l.tools.map((t) => (t.id === e.id ? { ...t, done: true, ok: e.ok, message: e.message } : t))
                    : [...l.tools, { id: e.id, name: e.name, chars: 0, done: true, ok: e.ok, message: e.message }],
                },
            );
            break;
          case "suggestion": {
            const s = toEditorSuggestion(e.suggestion);
            if (!seen.has(s.id)) {
              seen.add(s.id);
              setLive((l) => l && { ...l, suggestions: l.suggestions + 1 });
            }
            setList((l) => (l.some((x) => x.id === s.id) ? l.map((x) => (x.id === s.id ? s : x)) : [...l, s]));
            break;
          }
          case "suggestion-removed":
            setList((l) => l.filter((x) => x.id !== e.id));
            break;
          case "error":
            setLive((l) => l && { ...l, error: e.message });
            break;
          case "done":
            setLive((l) => l && { ...l, done: true, usage: e.usage, runId: e.runId });
            break;
        }
      };
      try {
        await runAgent({ chapterId, instruction, mode, selectionIds, focusId, beats }, onEvent, ctrl.signal);
      } catch (err: any) {
        if (!ctrl.signal.aborted) setLive((l) => l && { ...l, error: err.message });
        else setLive((l) => l && { ...l, error: "Stopped." });
      } finally {
        setRunning(false);
        abortRef.current = null;
        queryClient.invalidateQueries({ queryKey: trpc.agent.log.queryKey(chapterId) });
        queryClient.invalidateQueries({ queryKey: trpc.chapters.list.queryKey(projectId) });
        if (beats) queryClient.invalidateQueries({ queryKey: trpc.chapters.get.queryKey(chapterId) });
      }
    },
    [editor, running, flush, chapterId, projectId],
  );

  /* -------------------------------------------------- page turn (summary on the verso) */
  const [flipped, setFlipped] = useState(false);
  const [flipCount, setFlipCount] = useState(0);
  const turnPage = useCallback(() => {
    setFlipped((f) => !f);
    setFlipCount((n) => n + 1);
    document.getElementById("manuscript-scroll")?.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  if (!chapter.data) return <div className="flex-1" />;

  return (
    <>
      <main className="flex-1 min-w-0 overflow-y-auto thin-scroll" id="manuscript-scroll">
        <div className="mx-auto max-w-[780px] px-6 pt-8 pb-40">
          <div className="relative">
            <ChapterTitle chapterId={chapterId} projectId={projectId} title={chapter.data.title} />
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={turnPage}
                  aria-pressed={flipped}
                  className={cn(
                    "absolute right-0 top-1/2 -translate-y-[calc(50%+12px)] inline-flex items-center gap-1.5 rounded-full border px-3 h-8 text-[13px] transition-colors",
                    flipped ? "bg-primary text-primary-foreground border-primary" : "bg-popover/60 text-ink-soft hover:bg-accent hover:text-ink",
                  )}
                >
                  {flipped ? <RotateCcw className="size-3.5" /> : <ScrollText className="size-3.5" />}
                  {flipped ? "Text" : "Summary"}
                </button>
              </TooltipTrigger>
              <TooltipContent>{flipped ? "Turn back to the manuscript" : "Turn the page to read the chapter summary"}</TooltipContent>
            </Tooltip>
          </div>
          <div className="page-flip" data-flipped={flipped} data-animate={flipCount > 0}>
            <div className="page-inner">
              <article className="page-face paper rounded-[3px] px-[72px] pt-10 pb-24 min-h-[80vh]" inert={flipped}>
                <Manuscript initial={chapter.data.content} format={format} handlers={handlers} onChange={onChange} onReady={setEditor} />
              </article>
              <article className="page-face page-back paper rounded-[3px] px-[72px] pt-12 pb-16" inert={!flipped}>
                <SummaryPage chapterId={chapterId} projectId={projectId} title={chapter.data.title} visible={flipped} />
              </article>
            </div>
          </div>
          <div className="flex justify-between text-xs text-muted-foreground mt-3 px-1">
            <span>{(words ?? chapter.data.wordCount).toLocaleString()} words</span>
            <span className={cn(saveState === "error" && "text-destructive")}>
              {saveState === "saved" ? "Saved" : saveState === "saving" ? "Saving…" : saveState === "dirty" ? "Edited" : "Not saved"}
            </span>
          </div>
        </div>
        {list.length > 0 && (
          <div className="sticky bottom-5 flex justify-center pointer-events-none">
            <div className="pointer-events-auto flex items-center gap-2 rounded-full border bg-popover/95 backdrop-blur pl-4 pr-1.5 py-1.5 shadow-lg">
              <span className="text-sm">
                {list.length} suggestion{list.length === 1 ? "" : "s"}
                {running && <span className="text-muted-foreground"> · writing…</span>}
              </span>
              <Button size="sm" variant="ghost" className="rounded-full" onClick={() => setTab("changes")}>
                Review
              </Button>
              <Button size="sm" variant="ghost" className="rounded-full" onClick={rejectAll} disabled={running}>
                <X className="size-3.5" /> Reject all
              </Button>
              <Button size="sm" className="rounded-full" onClick={acceptAll} disabled={running}>
                <CheckCheck className="size-3.5" /> Accept all
              </Button>
            </div>
          </div>
        )}
      </main>

      <aside className="w-[380px] shrink-0 border-l bg-sidebar/50 flex flex-col min-h-0">
        <Tabs value={tab} onValueChange={setTab} className="flex-1 flex flex-col min-h-0 gap-0">
          <div className="px-3 pt-3 pb-2 border-b">
            <TabsList className="w-full">
              <TabsTrigger value="agent">Agent</TabsTrigger>
              <TabsTrigger value="changes">
                Changes{list.length ? <span className="ml-1 rounded-full bg-oxblood text-primary-foreground text-[10px] px-1.5">{list.length}</span> : null}
              </TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="agent" className="flex-1 min-h-0 mt-0">
            <AgentPanel
              chapterId={chapterId}
              live={live}
              running={running}
              hasSelection={hasSelection}
              onRun={run}
              onStop={() => abortRef.current?.abort()}
            />
          </TabsContent>
          <TabsContent value="changes" className="flex-1 min-h-0 mt-0">
            <ChangesPanel
              list={list}
              stale={stale}
              active={active}
              onAccept={accept}
              onReject={reject}
              onAcceptAll={acceptAll}
              onRejectAll={rejectAll}
              onFocus={focus}
            />
          </TabsContent>
        </Tabs>
      </aside>
    </>
  );
}

function ChapterTitle({ chapterId, projectId, title }: { chapterId: string; projectId: string; title: string }) {
  const [v, setV] = useState(title);
  const upd = useMutation(
    trpc.chapters.update.mutationOptions({ onSuccess: () => queryClient.invalidateQueries({ queryKey: trpc.chapters.list.queryKey(projectId) }) }),
  );
  return (
    <input
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v.trim() && v !== title && upd.mutate({ id: chapterId, title: v.trim() })}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      className="w-full bg-transparent text-center font-display text-[34px] font-light tracking-tight text-ink outline-none mb-6 placeholder:text-muted-foreground"
      placeholder="Untitled chapter"
    />
  );
}
