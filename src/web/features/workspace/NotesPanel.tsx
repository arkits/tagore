import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { queryClient, trpc } from "@/lib/trpc";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

/** Chapter notes (the author's ideas/beats) and the AI-maintained continuity summary. */
export function NotesPanel({ chapterId, projectId }: { chapterId: string; projectId: string }) {
  const chapter = useQuery(trpc.chapters.get.queryOptions(chapterId));
  const list = useQuery(trpc.chapters.list.queryOptions(projectId));
  const meta = list.data?.find((c) => c.id === chapterId);
  const [notes, setNotes] = useState("");
  const [summary, setSummary] = useState("");
  const loaded = useRef(false);

  useEffect(() => {
    if (chapter.data && !loaded.current) {
      setNotes(chapter.data.notes);
      setSummary(chapter.data.summary);
      loaded.current = true;
    }
  }, [chapter.data]);

  const upd = useMutation(trpc.chapters.update.mutationOptions());
  const dirtyNotes = useRef(false);
  useEffect(() => {
    if (!dirtyNotes.current) return;
    const t = setTimeout(() => upd.mutate({ id: chapterId, notes }), 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes]);

  const summarize = useMutation(
    trpc.chapters.summarize.mutationOptions({
      onSuccess: (r) => {
        setSummary(r.summary);
        queryClient.invalidateQueries({ queryKey: trpc.chapters.list.queryKey(projectId) });
      },
      onError: (e) => toast.error(e.message),
    }),
  );

  return (
    <div className="h-full overflow-y-auto thin-scroll p-4 space-y-6">
      <section className="space-y-2">
        <div>
          <h3 className="font-display text-lg">Ideas & beats</h3>
          <p className="text-xs text-muted-foreground">Sketch what should happen here. The agent drafts from these notes.</p>
        </div>
        <Textarea
          value={notes}
          onChange={(e) => {
            dirtyNotes.current = true;
            setNotes(e.target.value);
          }}
          rows={14}
          placeholder={"— Mara arrives at the lighthouse at dusk\n— She finds her father's logbook, last entry torn out\n— Ends: a light comes on that shouldn't"}
          className="font-book text-[15px] leading-relaxed bg-paper"
        />
      </section>
      <section className="space-y-2">
        <div className="flex items-end justify-between gap-2">
          <div>
            <h3 className="font-display text-lg">Summary</h3>
            <p className="text-xs text-muted-foreground">
              Long-range memory: other chapters see this instead of the full text.
              {meta?.stale && meta.wordCount > 0 && <span className="text-oxblood"> Out of date.</span>}
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => summarize.mutate(chapterId)} disabled={summarize.isPending}>
            {summarize.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            Refresh
          </Button>
        </div>
        <Textarea
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          onBlur={() => chapter.data && summary !== chapter.data.summary && upd.mutate({ id: chapterId, summary })}
          rows={10}
          placeholder="Generated automatically when another chapter needs it, or press Refresh."
          className="font-book text-[15px] leading-relaxed bg-paper"
        />
      </section>
    </div>
  );
}
