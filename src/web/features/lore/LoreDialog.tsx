import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
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
  const invalidate = () => queryClient.invalidateQueries({ queryKey: trpc.lore.list.queryKey(projectId) });
  const create = useMutation(trpc.lore.create.mutationOptions({ onSuccess: (r) => (invalidate(), setSel(r.id)) }));
  const del = useMutation(trpc.lore.delete.mutationOptions({ onSuccess: () => (invalidate(), setSel(null)) }));
  const entry = list.data?.find((e) => e.id === sel) ?? null;

  useEffect(() => {
    if (!sel && list.data?.length) setSel(list.data[0]!.id);
  }, [list.data, sel]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl h-[80vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b">
          <DialogTitle className="font-display text-2xl font-normal">Lorebook</DialogTitle>
          <DialogDescription>
            World facts that enter the agent’s context only when their keywords appear near where it’s writing. “Always on” entries are always included.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-1 min-h-0">
          <div className="w-64 border-r flex flex-col">
            <div className="flex-1 overflow-y-auto thin-scroll p-2 space-y-0.5">
              {list.data?.map((e) => (
                <button
                  key={e.id}
                  onClick={() => setSel(e.id)}
                  className={cn("w-full text-left px-3 py-2 rounded-md hover:bg-accent", sel === e.id && "bg-accent", !e.enabled && "opacity-50")}
                >
                  <div className="text-sm font-medium truncate">{e.name}</div>
                  <div className="text-xs text-muted-foreground truncate">{e.constant ? "Always on" : e.keys.join(", ") || "no keys"}</div>
                </button>
              ))}
              {!list.data?.length && <p className="text-sm text-muted-foreground p-3">No entries yet.</p>}
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
