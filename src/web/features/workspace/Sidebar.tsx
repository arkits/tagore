import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { ArrowDown, ArrowUp, BookMarked, Globe2, MoreHorizontal, Plus, ScrollText, Trash2, Users } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { queryClient, trpc } from "@/lib/trpc";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { StoryBibleDialog } from "../project/StoryBibleDialog";
import { CharactersDialog, Avatar } from "../characters/CharactersDialog";
import { LoreDialog } from "../lore/LoreDialog";

export function Sidebar({ projectId, chapterId }: { projectId: string; chapterId?: string }) {
  const [, navigate] = useLocation();
  const chapters = useQuery(trpc.chapters.list.queryOptions(projectId));
  const cast = useQuery(trpc.characters.forProject.queryOptions(projectId));
  const lore = useQuery(trpc.lore.list.queryOptions(projectId));
  const [bible, setBible] = useState(false);
  const [chars, setChars] = useState<{ open: boolean; id?: string | null }>({ open: false });
  const [loreOpen, setLoreOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string; trigger: HTMLElement | null } | null>(null);

  const inval = () => queryClient.invalidateQueries({ queryKey: trpc.chapters.list.queryKey(projectId) });
  const create = useMutation(trpc.chapters.create.mutationOptions({ onSuccess: (r) => (inval(), navigate(`/p/${projectId}/${r.id}`)) }));
  const reorder = useMutation(trpc.chapters.reorder.mutationOptions({ onSuccess: inval }));
  const del = useMutation(
    trpc.chapters.delete.mutationOptions({
      onSuccess: (_r, id) => {
        inval();
        if (id === chapterId) {
          const next = chapters.data?.find((c) => c.id !== id);
          navigate(next ? `/p/${projectId}/${next.id}` : `/p/${projectId}`);
        }
      },
    }),
  );

  const move = (i: number, d: -1 | 1) => {
    const ids = chapters.data!.map((c) => c.id);
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    reorder.mutate({ projectId, ids });
  };

  const total = chapters.data?.reduce((n, c) => n + c.wordCount, 0) ?? 0;

  return (
    <nav className="w-64 shrink-0 border-r bg-sidebar/50 flex flex-col min-h-0 h-full">
      <div className="flex-1 overflow-y-auto thin-scroll py-3">
        <SectionHead label="Manuscript" action={() => create.mutate({ projectId })} />
        <ol className="px-2 space-y-px">
          {chapters.data?.map((c, i) => (
            <li key={c.id} className="group relative">
              <Link
                href={`/p/${projectId}/${c.id}`}
                className={cn(
                  "flex items-baseline gap-2 rounded-md px-2.5 py-1.5 pr-8 hover:bg-accent/70",
                  c.id === chapterId && "bg-accent text-ink",
                )}
              >
                <span className="font-display text-xs text-muted-foreground tabular-nums w-4 shrink-0">{i + 1}</span>
                <span className="flex-1 min-w-0">
                  <span className="block truncate text-[14px]">{c.title}</span>
                  <span className="block text-[11px] text-muted-foreground">
                    {c.wordCount.toLocaleString()} words
                    {c.stale && c.wordCount > 30 ? " · summary pending" : ""}
                  </span>
                </span>
              </Link>
              <DropdownMenu>
                <DropdownMenuTrigger id={`chapter-actions-${c.id}`} aria-label={`Chapter actions for “${c.title}”`} className="absolute right-1.5 top-2 p-1 rounded opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 hover:bg-background/60">
                  <MoreHorizontal className="size-3.5" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem onClick={() => move(i, -1)} disabled={i === 0}>
                    <ArrowUp /> Move up
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => move(i, 1)} disabled={i === (chapters.data?.length ?? 0) - 1}>
                    <ArrowDown /> Move down
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    disabled={del.isPending}
                    onSelect={() => setDeleteTarget({ id: c.id, name: c.title, trigger: document.getElementById(`chapter-actions-${c.id}`) })}
                  >
                    <Trash2 /> Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          ))}
        </ol>
        <p className="px-5 pt-2 text-[11px] text-muted-foreground">{total.toLocaleString()} words in all</p>

        <SectionHead label="Story" />
        <div className="px-2 space-y-px">
          <NavButton icon={ScrollText} label="Story bible" onClick={() => setBible(true)} />
          <NavButton icon={Globe2} label="Lorebook" meta={lore.data?.length ? String(lore.data.length) : undefined} onClick={() => setLoreOpen(true)} />
        </div>

        <SectionHead label="Cast" action={() => setChars({ open: true, id: null })} actionIcon={Users} />
        <div className="px-2 space-y-px">
          {cast.data?.map(({ character: c, pinned }) => (
            <button
              key={c.id}
              onClick={() => setChars({ open: true, id: c.id })}
              className="w-full flex items-center gap-2.5 rounded-md px-2.5 py-1.5 hover:bg-accent/70 text-left"
            >
              <Avatar c={c} size={24} />
              <span className="truncate text-[14px] flex-1">{c.name}</span>
              {pinned && <BookMarked className="size-3 text-oxblood" />}
            </button>
          ))}
          {!cast.data?.length && (
            <button onClick={() => setChars({ open: true, id: null })} className="w-full text-left px-2.5 py-1.5 text-[13px] text-muted-foreground italic hover:text-ink">
              Add or import characters…
            </button>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title="Delete chapter?"
        description={`“${deleteTarget?.name}” will be permanently deleted.`}
        action="Delete chapter"
        returnFocusTo={deleteTarget?.trigger}
        onConfirm={() => { if (deleteTarget) del.mutate(deleteTarget.id); }}
      />
      <StoryBibleDialog projectId={projectId} open={bible} onOpenChange={setBible} />
      <CharactersDialog projectId={projectId} open={chars.open} initialId={chars.id} onOpenChange={(o) => setChars({ open: o })} />
      <LoreDialog projectId={projectId} open={loreOpen} onOpenChange={setLoreOpen} />
    </nav>
  );
}

function SectionHead({ label, action, actionIcon: Icon = Plus }: { label: string; action?: () => void; actionIcon?: React.ElementType }) {
  return (
    <div className="flex items-center justify-between px-5 pt-4 pb-1.5 first:pt-1">
      <span className="small-caps text-[12px] text-muted-foreground">{label}</span>
      {action && (
        <button onClick={action} className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-ink" title={`Add ${label.toLowerCase()}`}>
          <Icon className="size-3.5" />
        </button>
      )}
    </div>
  );
}

function NavButton({ icon: Icon, label, meta, onClick }: { icon: React.ElementType; label: string; meta?: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="w-full flex items-center gap-2.5 rounded-md px-2.5 py-1.5 hover:bg-accent/70 text-left text-[14px]">
      <Icon className="size-4 text-ink-soft" />
      <span className="flex-1">{label}</span>
      {meta && <span className="text-[11px] text-muted-foreground">{meta}</span>}
    </button>
  );
}
