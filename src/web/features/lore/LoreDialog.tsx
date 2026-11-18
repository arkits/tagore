import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Download, Plus, Search, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { queryClient, trpc, type Outputs } from "@/lib/trpc";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type Entry = Outputs["lore"]["list"][number];

export function LoreDialog({ projectId, open, onOpenChange }: { projectId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const list = useQuery(trpc.lore.list.queryOptions(projectId));
  const [sel, setSel] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const invalidate = () => queryClient.invalidateQueries({ queryKey: trpc.lore.list.queryKey(projectId) });
  const create = useMutation(trpc.lore.create.mutationOptions({ onSuccess: (r) => (invalidate(), setSel(r.id)) }));
  const del = useMutation(trpc.lore.delete.mutationOptions({ onSuccess: () => (invalidate(), setSel(null)) }));
  const imp = useMutation(
    trpc.lore.import.mutationOptions({
      onSuccess: (r) => {
        invalidate();
        const extra = [r.duplicates && `${r.duplicates} already present`, r.skipped && `${r.skipped} empty skipped`].filter(Boolean).join(", ");
        toast.success(`Imported ${r.imported} entr${r.imported === 1 ? "y" : "ies"} from “${r.name}”${extra ? ` (${extra})` : ""}`);
      },
      onError: (e) => toast.error(e.message),
    }),
  );
  const importFiles = async (files: FileList | File[] | null) => {
    for (const file of Array.from(files ?? [])) {
      if (!/\.json$/i.test(file.name) && file.type !== "application/json") {
        toast.error(`${file.name}: lorebooks are JSON files.`);
        continue;
      }
      await imp.mutateAsync({ projectId, fileName: file.name, text: await file.text() }).catch(() => {});
    }
  };
  const q = filter.trim().toLowerCase();
  const shown = (list.data ?? []).filter(
    (e) => !q || e.name.toLowerCase().includes(q) || e.keys.some((k) => k.toLowerCase().includes(q)) || e.content.toLowerCase().includes(q),
  );
  const entry = list.data?.find((e) => e.id === sel) ?? null;

  useEffect(() => {
    if (!sel && list.data?.length) setSel(list.data[0]!.id);
  }, [list.data, sel]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl h-[80vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b">
          <div className="flex items-end gap-4 pr-8">
            <div className="flex-1">
              <DialogTitle className="font-display text-2xl font-normal">Lorebook</DialogTitle>
              <DialogDescription className="mt-1.5">
                World facts that enter the agent’s context only when their keywords appear near where it’s writing. “Always on” entries are always included.
              </DialogDescription>
            </div>
            <div className="flex gap-2 shrink-0">
              <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={imp.isPending}>
                <Upload className="size-4" /> Import
              </Button>
              <Button variant="ghost" size="sm" asChild disabled={!list.data?.length}>
                <a href={`/api/projects/${projectId}/lorebook.json`} aria-disabled={!list.data?.length}>
                  <Download className="size-4" /> Export
                </a>
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept=".json,application/json"
                multiple
                className="hidden"
                onChange={(e) => {
                  importFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </div>
          </div>
        </DialogHeader>
        <div
          className="relative flex flex-1 min-h-0"
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes("Files")) return;
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            importFiles(e.dataTransfer.files);
          }}
        >
          {dragging && (
            <div className="absolute inset-3 z-20 rounded-md border-2 border-dashed border-oxblood bg-paper/90 grid place-items-center pointer-events-none">
              <div className="text-center">
                <Upload className="size-6 mx-auto text-oxblood" />
                <p className="font-display text-xl mt-2">Drop to import</p>
                <p className="text-sm text-muted-foreground italic">SillyTavern world info, Chub lorebooks, or character-card books</p>
              </div>
            </div>
          )}
          <div className="w-64 border-r flex flex-col">
            {(list.data?.length ?? 0) > 6 && (
              <div className="relative border-b">
                <Search className="size-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder={`Filter ${list.data?.length} entries…`}
                  className="w-full bg-transparent pl-8 pr-3 py-2.5 text-sm outline-none placeholder:text-muted-foreground/70"
                />
              </div>
            )}
            <div className="flex-1 overflow-y-auto thin-scroll p-2 space-y-0.5">
              {shown.map((e) => (
                <button
                  key={e.id}
                  onClick={() => setSel(e.id)}
                  className={cn("w-full text-left px-3 py-2 rounded-md hover:bg-accent", sel === e.id && "bg-accent", !e.enabled && "opacity-50")}
                >
                  <div className="text-sm font-medium truncate">{e.name}</div>
                  <div className="text-xs text-muted-foreground truncate">{e.constant ? "Always on" : e.keys.join(", ") || "no keys"}</div>
                </button>
              ))}
              {!list.data?.length && (
                <button
                  onClick={() => fileRef.current?.click()}
                  className="w-full rounded-md border border-dashed p-4 text-left text-sm text-muted-foreground hover:border-ring hover:text-ink"
                >
                  No entries yet. <span className="italic">Drop a lorebook JSON here, or click to import one.</span>
                </button>
              )}
              {!!list.data?.length && !shown.length && <p className="text-sm text-muted-foreground p-3 italic">Nothing matches.</p>}
            </div>
            <div className="p-2 border-t">
              <Button variant="outline" className="w-full" onClick={() => create.mutate({ projectId })}>
                <Plus className="size-4" /> New entry
              </Button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto thin-scroll">
            {entry ? <EntryEditor key={entry.id} entry={entry} onSaved={invalidate} onDelete={() => del.mutate(entry.id)} /> : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EntryEditor({ entry, onSaved, onDelete }: { entry: Entry; onSaved: () => void; onDelete: () => void }) {
  const [f, setF] = useState({ ...entry, keysText: entry.keys.join(", ") });
  const upd = useMutation(trpc.lore.update.mutationOptions({ onSuccess: onSaved }));
  const commit = (patch: Partial<typeof f> = {}) => {
    const next = { ...f, ...patch };
    setF(next);
    upd.mutate({
      id: entry.id,
      name: next.name,
      keys: next.keysText.split(",").map((k) => k.trim()).filter(Boolean),
      content: next.content,
      enabled: next.enabled,
      constant: next.constant,
      insertionOrder: Number(next.insertionOrder) || 0,
    });
  };
  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-3">
        <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} onBlur={() => commit()} className="font-display text-xl h-11" />
        <Button variant="ghost" size="icon" onClick={onDelete} title="Delete entry">
          <Trash2 className="size-4" />
        </Button>
      </div>
      <div className="space-y-1.5">
        <Label>Keywords</Label>
        <Input
          value={f.keysText}
          onChange={(e) => setF({ ...f, keysText: e.target.value })}
          onBlur={() => commit()}
          placeholder="Varos, the Iron City, /iron\s+city/i"
        />
        <p className="text-xs text-muted-foreground">Comma-separated, whole-word, case-insensitive. Wrap in /…/ for a regex.</p>
      </div>
      <div className="space-y-1.5">
        <Label>Content</Label>
        <Textarea rows={12} value={f.content} onChange={(e) => setF({ ...f, content: e.target.value })} onBlur={() => commit()} className="font-book text-base" />
      </div>
      <div className="flex items-center gap-6">
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={f.enabled} onCheckedChange={(v) => commit({ enabled: v })} /> Enabled
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={f.constant} onCheckedChange={(v) => commit({ constant: v })} /> Always on
        </label>
        <label className="flex items-center gap-2 text-sm">
          Order
          <Input type="number" className="w-20 h-8" value={f.insertionOrder} onChange={(e) => setF({ ...f, insertionOrder: Number(e.target.value) })} onBlur={() => commit()} />
        </label>
      </div>
    </div>
  );
}
