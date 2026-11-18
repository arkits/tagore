import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Plus, Settings2, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { queryClient, trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SettingsDialog } from "../settings/SettingsDialog";
import { ModelPicker } from "../settings/ModelPicker";
import { ThemeToggle } from "@/components/ThemeToggle";
import { cn } from "@/lib/utils";
import { DEFAULT_THEME, getTheme } from "@/lib/themes";
import { ThemePicker } from "../project/ThemePicker";
import { FormatToggle } from "../project/StoryBibleDialog";
import type { StoryFormat } from "@shared/doc";

export function Library() {
  const [, navigate] = useLocation();
  const projects = useQuery(trpc.projects.list.queryOptions());
  const settings = useQuery(trpc.settings.get.queryOptions());
  const [creating, setCreating] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const del = useMutation(trpc.projects.delete.mutationOptions({ onSuccess: () => queryClient.invalidateQueries({ queryKey: trpc.projects.list.queryKey() }) }));
  const noKey =
    settings.data &&
    !settings.data.providers.openrouter.apiKey &&
    !settings.data.providers.anthropic.apiKey &&
    !settings.data.providers.openai.apiKey &&
    !settings.data.model.startsWith("custom:");

  return (
    <div className="h-full overflow-y-auto thin-scroll">
      <header className="max-w-5xl mx-auto px-8 pt-10 flex items-center gap-3">
        <h1 className="font-display text-4xl font-light tracking-tight text-oxblood">Tagore</h1>
        <div className="flex-1" />
        <ModelPicker compact />
        <ThemeToggle />
        <Button variant="ghost" size="icon" onClick={() => setSettingsOpen(true)}>
          <Settings2 className="size-4" />
        </Button>
      </header>

      {noKey && (
        <div className="max-w-5xl mx-auto px-8 mt-6">
          <button onClick={() => setSettingsOpen(true)} className="w-full text-left rounded-md border border-oxblood/30 bg-oxblood/5 px-4 py-3 text-sm">
            <span className="font-medium">Connect a model to begin.</span> Add an OpenRouter key (or Anthropic / OpenAI / a local endpoint) in Settings.
          </button>
        </div>
      )}

      <main className="max-w-5xl mx-auto px-8 py-10">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-8">
          <button
            onClick={() => setCreating(true)}
            className="aspect-[2/3] rounded-[3px] border-2 border-dashed border-rule hover:border-ring hover:bg-paper/50 grid place-items-center text-muted-foreground transition-colors"
          >
            <span className="flex flex-col items-center gap-2">
              <Plus className="size-6" />
              <span className="font-display text-lg">New story</span>
            </span>
          </button>
          {projects.data?.map((p) => {
            const t = getTheme(p.theme, p.format === "chat" ? "chat" : "prose");
            return (
              <div key={p.id} className="group relative">
                <button
                  onClick={() => navigate(`/p/${p.id}`)}
                  className={cn(
                    "aspect-[2/3] w-full rounded-[3px] text-left p-6 flex flex-col transition-transform group-hover:-translate-y-1 overflow-hidden",
                    "shadow-[0_1px_2px_rgba(60,40,20,.15),0_14px_30px_-14px_rgba(60,40,20,.5)]",
                    `cover-${t.id}`,
                  )}
                  style={{ background: t.cover.bg, color: t.cover.fg }}
                >
                  <span className="text-[11px] tracking-[0.12em] uppercase opacity-80" style={{ fontFamily: t.cover.font }}>
                    {t.cover.kicker}
                  </span>
                  <span className="mt-auto text-[26px] leading-[1.1]" style={{ fontFamily: t.cover.font }}>
                    {p.title}
                  </span>
                  <span className="mt-3 h-px w-10 bg-current opacity-40" />
                  <span className="mt-3 text-xs opacity-80">
                    {t.name} · {p.chapters} {p.format === "chat" ? (p.chapters === 1 ? "part" : "parts") : p.chapters === 1 ? "chapter" : "chapters"} ·{" "}
                    {p.words.toLocaleString()} words
                  </span>
                </button>
                <button
                  className="absolute top-2 right-2 p-1.5 rounded opacity-0 group-hover:opacity-70 focus-visible:opacity-100 hover:!opacity-100"
                  style={{ color: t.cover.fg }}
                  aria-label={`Delete story “${p.title}”`}
                  disabled={del.isPending}
                  onClick={() => setDeleteTarget({ id: p.id, name: p.title })}
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            );
          })}
        </div>
      </main>
      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title="Delete story?"
        description={`“${deleteTarget?.name}” and all its chapters will be permanently deleted.`}
        action="Delete story"
        onConfirm={() => { if (deleteTarget) del.mutate(deleteTarget.id); }}
      />
      <NewStoryDialog open={creating} onOpenChange={setCreating} onCreated={(id, ch) => navigate(`/p/${id}/${ch}`)} />
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}

function NewStoryDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (id: string, ch: string) => void }) {
  const [title, setTitle] = useState("");
  const [premise, setPremise] = useState("");
  const [format, setFormat] = useState<StoryFormat>("prose");
  const [theme, setTheme] = useState(DEFAULT_THEME.prose);
  const create = useMutation(
    trpc.projects.create.mutationOptions({
      onSuccess: (r) => {
        queryClient.invalidateQueries({ queryKey: trpc.projects.list.queryKey() });
        onOpenChange(false);
        setTitle("");
        setPremise("");
        onCreated(r.id, r.chapterId);
      },
    }),
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[92vh] overflow-y-auto thin-scroll">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl font-normal">A new story</DialogTitle>
        </DialogHeader>
        <Input autoFocus placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} className="font-display text-xl h-12" />
        <Textarea
          rows={4}
          placeholder="What’s it about? A sentence or a page — the premise stays in the agent’s mind for every chapter."
          value={premise}
          onChange={(e) => setPremise(e.target.value)}
          className="font-book text-base"
        />
        <FormatToggle
          value={format}
          onChange={(f) => {
            setFormat(f);
            setTheme(DEFAULT_THEME[f]);
          }}
        />
        <ThemePicker format={format} value={theme} onChange={setTheme} compact />
        <DialogFooter>
          <Button disabled={!title.trim() || create.isPending} onClick={() => create.mutate({ title: title.trim(), premise, format, theme })}>
            Begin
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
