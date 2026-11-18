import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { queryClient, trpc } from "@/lib/trpc";
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
  const summarize = useMutation(
    trpc.chapters.summarize.mutationOptions({
      onSuccess: (r) => {
        setSummary(r.summary);
        queryClient.invalidateQueries({ queryKey: trpc.chapters.list.queryKey(projectId) });
        queryClient.invalidateQueries({ queryKey: trpc.chapters.get.queryKey(chapterId) });
      },
      onError: (e) => toast.error(e.message),
    }),
  );

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
        {empty && !summary ? (
          <p className="text-center italic text-muted-foreground text-lg mt-16">Nothing written yet — nothing to remember.</p>
        ) : (
          <textarea
            ref={taRef}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            onBlur={() => chapter.data && summary !== chapter.data.summary && upd.mutate({ id: chapterId, summary })}
            placeholder="No summary yet. Turn to it after writing, or let the agent make one when another chapter needs it."
            spellCheck
            className={cn(
              "w-full resize-none overflow-hidden bg-transparent outline-none text-[1.18rem] leading-[1.75] text-ink",
              "placeholder:italic placeholder:text-muted-foreground/70",
              summarize.isPending && "opacity-40",
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
          onClick={() => summarize.mutate(chapterId)}
          disabled={summarize.isPending || empty}
          className="ml-auto inline-flex items-center gap-1.5 rounded-full border px-3 h-7 hover:bg-accent hover:text-ink disabled:opacity-40 disabled:pointer-events-none transition-colors"
        >
          {summarize.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
          {summary ? "Rewrite summary" : "Summarize"}
        </button>
      </footer>
    </div>
  );
}
