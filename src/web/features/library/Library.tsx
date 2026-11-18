import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Plus, Settings2, Trash2 } from "lucide-react";
import { queryClient, trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SettingsDialog } from "../settings/SettingsDialog";
import { ModelPicker } from "../settings/ModelPicker";
import { ThemeToggle } from "@/components/ThemeToggle";
import { cn } from "@/lib/utils";

export function Library() {
  const [, navigate] = useLocation();
  const projects = useQuery(trpc.projects.list.queryOptions());
  const settings = useQuery(trpc.settings.get.queryOptions());
  const [creating, setCreating] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
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
        <span className="font-book italic text-muted-foreground text-lg mt-1.5">— a writing room with a co-author</span>
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
          {projects.data?.map((p, i) => (
            <div key={p.id} className="group relative">
              <button
                onClick={() => navigate(`/p/${p.id}`)}
                className={cn(
                  "aspect-[2/3] w-full rounded-[3px] text-left p-6 flex flex-col transition-transform group-hover:-translate-y-1",
                  "shadow-[0_1px_2px_rgba(60,40,20,.15),0_14px_30px_-14px_rgba(60,40,20,.5)]",
                )}
                style={{ background: COVERS[i % COVERS.length]!.bg, color: COVERS[i % COVERS.length]!.fg }}
              >
                <span className="small-caps text-[11px] opacity-70">{p.format === "script" ? "A screenplay" : "A novel"}</span>
                <span className="mt-auto font-display text-[26px] leading-[1.1] font-light">{p.title}</span>
                <span className="mt-3 h-px w-10 bg-current opacity-40" />
                <span className="mt-3 text-xs opacity-75">
                  {p.chapters} {p.chapters === 1 ? "chapter" : "chapters"} · {p.words.toLocaleString()} words
                </span>
              </button>
              <button
                className="absolute top-2 right-2 p-1.5 rounded opacity-0 group-hover:opacity-70 hover:!opacity-100"
                style={{ color: COVERS[i % COVERS.length]!.fg }}
                onClick={() => confirm(`Delete “${p.title}” and all its chapters?`) && del.mutate(p.id)}
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          ))}
        </div>
      </main>
      <NewStoryDialog open={creating} onOpenChange={setCreating} onCreated={(id, ch) => navigate(`/p/${id}/${ch}`)} />
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}

const COVERS = [
  { bg: "linear-gradient(160deg,#7a3520,#5a2414)", fg: "#f6e9d4" },
  { bg: "linear-gradient(160deg,#2f4a3a,#1f3328)", fg: "#efe4cc" },
  { bg: "linear-gradient(160deg,#e9dcc0,#d8c6a2)", fg: "#3a2a1c" },
  { bg: "linear-gradient(160deg,#2d3446,#1d2230)", fg: "#e9dcc4" },
  { bg: "linear-gradient(160deg,#a8743f,#7d5228)", fg: "#fbf1de" },
];

function NewStoryDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (id: string, ch: string) => void }) {
  const [title, setTitle] = useState("");
  const [premise, setPremise] = useState("");
  const [format, setFormat] = useState<"prose" | "script">("prose");
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
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl font-normal">A new story</DialogTitle>
        </DialogHeader>
        <Input autoFocus placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} className="font-display text-xl h-12" />
        <Textarea
          rows={5}
          placeholder="What’s it about? A sentence or a page — the premise stays in the agent’s mind for every chapter."
          value={premise}
          onChange={(e) => setPremise(e.target.value)}
          className="font-book text-base"
        />
        <div className="flex rounded-md border p-0.5 w-fit">
          {(["prose", "script"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setFormat(k)}
              className={cn("px-4 py-1.5 rounded text-sm", format === k ? "bg-primary text-primary-foreground" : "hover:bg-accent")}
            >
              {k === "prose" ? "Book" : "Screenplay"}
            </button>
          ))}
        </div>
        <DialogFooter>
          <Button disabled={!title.trim() || create.isPending} onClick={() => create.mutate({ title: title.trim(), premise, format })}>
            Begin
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
