import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { queryClient, trpc } from "@/lib/trpc";
import { attachSummary, streamSummary } from "@/lib/agent";
import { cn } from "@/lib/utils";

/**
 * The verso of the manuscript page: the chapter's continuity summary — the long-range memory
 * other chapters see instead of the full text. Editable in place; refreshable by the model.
 */
export function SummaryPage({ chapterId, projectId, title, visible }: { chapterId: string; projectId: string; title: string; visible: boolean }) {
  const chapter = useQuery(trpc.chapters.get.queryOptions(chapterId));
  const list = useQuery(trpc.chapters.list.queryOptions(projectId));
  const meta = list.data?.find((c) => c.id === chapterId);
  const index = list.data?.findIndex((c) => c.id === chapterId) ?? -1;
  const [summary, setSummary] = useState("");
  const loaded = useRef(false);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (chapter.data && !loaded.current) {
      setSummary(chapter.data.summary);
      loaded.current = true;
    }
  }, [chapter.data]);

  // Grow the textarea with its content so the verso reads like a page, not a form.
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "0px";
    ta.style.height = `${ta.scrollHeight}px`;
  }, [summary, visible]);

  const upd = useMutation(
    trpc.chapters.update.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: trpc.chapters.list.queryKey(projectId) });
        queryClient.invalidateQueries({ queryKey: trpc.chapters.get.queryKey(chapterId) });
      },
    }),
  );
  // Stream the summary onto the page as it's written.
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  // The summary is written on the server; leaving the page only stops listening to it.
  const follow = async (
    connect: (onDelta: (d: string) => void, signal: AbortSignal) => Promise<string | null>,
  ) => {
    if (abortRef.current) return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    let started = false;
    const onDelta = (d: string) => {
      if (!started) {
        started = true;
        loaded.current = true; // don't let the saved (older) summary overwrite the one being written
        setStreaming(true);
        setSummary("");
      }
      setSummary((s) => s + d);
    };
    try {
      if ((await connect(onDelta, ctrl.signal)) === null) return;
      loaded.current = true;
      queryClient.invalidateQueries({ queryKey: trpc.chapters.list.queryKey(projectId) });
      queryClient.invalidateQueries({ queryKey: trpc.chapters.get.queryKey(chapterId) });
    } catch (e: any) {
      if (!ctrl.signal.aborted) {
        toast.error(e.message);
        setSummary(chapter.data?.summary ?? "");
      }
    } finally {
      if (abortRef.current === ctrl) {
        abortRef.current = null;
        setStreaming(false);
      }
    }
  };
  useEffect(() => {
    void follow((onDelta, signal) => attachSummary(chapterId, onDelta, signal));
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterId]);
  const summarize = () => {
    if (streaming) return;
    setStreaming(true);
    setSummary("");
    void follow(async (onDelta, signal) => streamSummary(chapterId, onDelta, signal));
  };

  const stale = !!meta?.stale && (meta?.wordCount ?? 0) > 0;
  const empty = (meta?.wordCount ?? 0) === 0;
  const words = summary.trim() ? summary.trim().split(/\s+/).length : 0;

  return (
    <div className="font-book">
      <header className="text-center">
        <p className="small-caps text-[12px] tracking-[0.18em] text-muted-foreground font-sans">
          {index >= 0 ? `Chapter ${index + 1} · ` : ""}in brief
        </p>
        <h2 className="font-display italic font-light text-[30px] leading-tight mt-2 text-ink">{title}</h2>
        <div className="mx-auto mt-4 flex items-center justify-center gap-3 text-ink-soft/60">
          <span className="h-px w-12 bg-current" />
          <span className="text-sm">❦</span>
          <span className="h-px w-12 bg-current" />
        </div>
      </header>

      <div className="mt-8">
        {empty && !summary && !streaming ? (
          <p className="text-center italic text-muted-foreground text-lg mt-16">Nothing written yet — nothing to remember.</p>
        ) : (
          <textarea
            ref={taRef}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            readOnly={streaming}
            onBlur={() => !streaming && chapter.data && summary !== chapter.data.summary && upd.mutate({ id: chapterId, summary })}
            placeholder="No summary yet. Turn to it after writing, or let the agent make one when another chapter needs it."
            spellCheck
            className={cn(
              "w-full resize-none overflow-hidden bg-transparent outline-none text-[1.18rem] leading-[1.75] text-ink",
              "placeholder:italic placeholder:text-muted-foreground/70",
              streaming && "caret-line",
            )}
          />
        )}
      </div>

      <footer className="mt-10 pt-4 border-t border-rule/70 flex items-center gap-3 font-sans text-[12.5px] text-muted-foreground">
        <span className="italic">
          {stale ? (
            <span className="text-oxblood not-italic">The chapter has changed since this was written.</span>
          ) : summary ? (
            `${words} words · the agent’s memory of this chapter`
          ) : (
            "The agent’s memory of this chapter"
          )}
        </span>
        <button
          onClick={summarize}
          disabled={streaming || empty}
          className="ml-auto inline-flex items-center gap-1.5 rounded-full border px-3 h-7 hover:bg-accent hover:text-ink disabled:opacity-40 disabled:pointer-events-none transition-colors"
        >
          {streaming ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
          {streaming ? "Writing…" : summary ? "Rewrite summary" : "Summarize"}
        </button>
      </footer>
    </div>
  );
}
