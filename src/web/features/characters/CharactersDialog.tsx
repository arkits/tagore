import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Download, Pin, PinOff, Plus, Trash2, Upload, UserMinus, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { queryClient, trpc, type Character } from "@/lib/trpc";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Field } from "../settings/SettingsDialog";
import { cn } from "@/lib/utils";
import type { CardData, LoreEntry } from "@shared/character";

export function Avatar({ c, size = 36 }: { c: { name: string; avatar: string | null }; size?: number }) {
  return c.avatar ? (
    <img src={c.avatar} alt="" style={{ width: size, height: size }} className="rounded-full object-cover border border-rule shrink-0" />
  ) : (
    <div
      style={{ width: size, height: size, fontSize: size * 0.42 }}
      className="rounded-full bg-secondary border border-rule grid place-items-center font-display text-ink-soft shrink-0"
    >
      {c.name.slice(0, 1).toUpperCase()}
    </div>
  );
}

function readFile(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

export function CharactersDialog({
  projectId,
  open,
  onOpenChange,
  initialId,
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initialId?: string | null;
}) {
  const all = useQuery(trpc.characters.list.queryOptions());
  const cast = useQuery(trpc.characters.forProject.queryOptions(projectId));
  const [sel, setSel] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) setSel(initialId ?? cast.data?.[0]?.character.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialId]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: trpc.characters.list.queryKey() });
    queryClient.invalidateQueries({ queryKey: trpc.characters.forProject.queryKey(projectId) });
  };
  const create = useMutation(trpc.characters.create.mutationOptions({ onSuccess: (r) => (invalidate(), setSel(r.id)) }));
  const imp = useMutation(
    trpc.characters.import.mutationOptions({
      onSuccess: (r) => {
        invalidate();
        setSel(r.id);
        toast.success(`Imported ${r.name}${r.loreEntries ? ` with ${r.loreEntries} lore entries` : ""}`);
      },
      onError: (e) => toast.error(e.message),
    }),
  );
  const link = useMutation(trpc.characters.link.mutationOptions({ onSuccess: invalidate }));
  const del = useMutation(trpc.characters.delete.mutationOptions({ onSuccess: () => (invalidate(), setSel(null)) }));

  const castIds = new Set(cast.data?.map((c) => c.character.id));
  const library = all.data?.filter((c) => !castIds.has(c.id)) ?? [];
  const selected = all.data?.find((c) => c.id === sel);
  const membership = cast.data?.find((c) => c.character.id === sel);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-5xl h-[86vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b">
          <DialogTitle className="font-display text-2xl font-normal">Characters</DialogTitle>
          <DialogDescription>
            Character Card V2 compatible — import PNG or JSON cards from SillyTavern, Chub and friends. Full cards enter the agent’s context when a character is
            mentioned near the passage being written (or always, if pinned); everyone else appears in a one-line cast list.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-1 min-h-0">
          <div className="w-64 border-r flex flex-col">
            <div className="flex-1 overflow-y-auto thin-scroll p-2">
              <p className="small-caps text-xs text-muted-foreground px-2 pt-1 pb-1.5">In this story</p>
              {cast.data?.map(({ character: c, pinned }) => (
                <Row key={c.id} c={c} active={sel === c.id} onClick={() => setSel(c.id)} badge={pinned ? <Pin className="size-3 text-oxblood" /> : null} />
              ))}
              {!cast.data?.length && <p className="text-xs text-muted-foreground px-2 pb-2">No one yet.</p>}
              {library.length > 0 && <p className="small-caps text-xs text-muted-foreground px-2 pt-4 pb-1.5">Library</p>}
              {library.map((c) => (
                <Row key={c.id} c={c} active={sel === c.id} onClick={() => setSel(c.id)} muted />
              ))}
            </div>
            <div className="p-2 border-t grid grid-cols-2 gap-2">
              <Button variant="outline" size="sm" onClick={() => create.mutate({ projectId })}>
                <Plus className="size-4" /> New
              </Button>
              <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={imp.isPending}>
                <Upload className="size-4" /> Import
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept=".png,.json,image/png,application/json"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  imp.mutate({ fileName: file.name, dataUrl: await readFile(file), projectId });
                }}
              />
            </div>
          </div>

          <div className="flex-1 min-w-0 flex flex-col">
            {selected ? (
              <>
                <div className="flex items-center gap-2 px-6 py-3 border-b bg-secondary/30">
                  {membership ? (
                    <>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => link.mutate({ projectId, characterId: selected.id, linked: true, pinned: !membership.pinned })}
                        title="Pinned characters are always in full context"
                      >
                        {membership.pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
                        {membership.pinned ? "Unpin" : "Pin to context"}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => link.mutate({ projectId, characterId: selected.id, linked: false })}>
                        <UserMinus className="size-4" /> Remove from story
                      </Button>
                    </>
                  ) : (
                    <Button size="sm" onClick={() => link.mutate({ projectId, characterId: selected.id, linked: true })}>
                      <UserPlus className="size-4" /> Add to this story
                    </Button>
                  )}
                  <div className="flex-1" />
                  <Button size="sm" variant="ghost" asChild>
                    <a href={`/api/characters/${selected.id}/export.json`}>
                      <Download className="size-4" /> JSON
                    </a>
                  </Button>
                  {selected.avatar?.startsWith("data:image/png") && (
                    <Button size="sm" variant="ghost" asChild>
                      <a href={`/api/characters/${selected.id}/export.png`}>
                        <Download className="size-4" /> PNG card
                      </a>
                    </Button>
                  )}
                  <Button
                    size="icon"
                    variant="ghost"
                    title="Delete character everywhere"
                    aria-label="Delete character everywhere"
                    disabled={del.isPending}
                    onClick={() => setDeleteTarget({ id: selected.id, name: selected.name })}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
                <CardEditor key={selected.id} character={selected} onSaved={invalidate} />
              </>
            ) : (
              <div className="flex-1 grid place-items-center text-muted-foreground font-book italic text-lg">Choose or create a character.</div>
            )}
          </div>
        </div>
        <ConfirmDialog
          open={open && deleteTarget !== null}
          onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
          title="Delete character?"
          description={`“${deleteTarget?.name}” will be permanently deleted from the library and removed from all stories.`}
          action="Delete character"
          onConfirm={() => { if (deleteTarget) del.mutate(deleteTarget.id); }}
        />
      </DialogContent>
    </Dialog>
  );
}

function Row({ c, active, onClick, badge, muted }: { c: Character; active: boolean; onClick: () => void; badge?: React.ReactNode; muted?: boolean }) {
  return (
    <button onClick={onClick} className={cn("w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md hover:bg-accent text-left", active && "bg-accent", muted && "opacity-70")}>
      <Avatar c={c} size={28} />
      <span className="truncate text-sm flex-1">{c.name}</span>
      {badge}
    </button>
  );
}

function CardEditor({ character, onSaved }: { character: Character; onSaved: () => void }) {
  const [card, setCard] = useState<CardData>(character.card);
  const [avatar, setAvatar] = useState<string | null>(character.avatar);
  const dirty = useRef(false);
  const save = useMutation(trpc.characters.update.mutationOptions({ onSuccess: onSaved }));

  // Debounced autosave
  useEffect(() => {
    if (!dirty.current) return;
    const t = setTimeout(() => save.mutate({ id: character.id, card: card as any, avatar }), 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card, avatar]);

  const set = <K extends keyof CardData>(k: K, v: CardData[K]) => {
    dirty.current = true;
    setCard((c) => ({ ...c, [k]: v }));
  };
  const entries = card.character_book?.entries ?? [];
  const setEntries = (e: LoreEntry[]) => set("character_book", { ...(card.character_book ?? { extensions: {} }), entries: e });
  const ta = "font-book text-base leading-relaxed";

  return (
    <Tabs defaultValue="profile" className="flex-1 min-h-0 flex flex-col">
      <div className="px-6 pt-4">
        <div className="flex items-center gap-4 mb-4">
          <label className="cursor-pointer group relative" title="Change portrait">
            <Avatar c={{ name: card.name, avatar }} size={64} />
            <span className="absolute inset-0 rounded-full bg-black/30 opacity-0 group-hover:opacity-100 grid place-items-center text-white text-[10px]">Change</span>
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                dirty.current = true;
                setAvatar(await readFile(f));
              }}
            />
          </label>
          <div className="flex-1 grid grid-cols-[2fr_1fr] gap-3">
            <Input value={card.name} onChange={(e) => set("name", e.target.value)} className="font-display text-2xl h-12" />
            <Input value={card.nickname ?? ""} onChange={(e) => set("nickname", e.target.value || undefined)} placeholder="Nickname" className="h-12" />
          </div>
          <span className="text-xs text-muted-foreground w-14 text-right">{save.isPending ? "Saving…" : dirty.current ? "Saved" : ""}</span>
        </div>
        <TabsList>
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="voice">Voice</TabsTrigger>
          <TabsTrigger value="lore">Lore {entries.length ? `(${entries.length})` : ""}</TabsTrigger>
          <TabsTrigger value="meta">Notes & tags</TabsTrigger>
        </TabsList>
      </div>
      <div className="flex-1 overflow-y-auto thin-scroll px-6 pb-6 pt-4">
        <TabsContent value="profile" className="space-y-4 mt-0">
          <Field label="Description" hint="Appearance, history, role in the story, relationships. Use {{char}} for their name.">
            <Textarea rows={8} value={card.description} onChange={(e) => set("description", e.target.value)} className={ta} />
          </Field>
          <Field label="Personality" hint="Traits, wants, fears, contradictions.">
            <Textarea rows={4} value={card.personality} onChange={(e) => set("personality", e.target.value)} className={ta} />
          </Field>
          <Field label="Situation" hint="Where they stand right now in the story (update as the plot moves).">
            <Textarea rows={3} value={card.scenario} onChange={(e) => set("scenario", e.target.value)} className={ta} />
          </Field>
        </TabsContent>
        <TabsContent value="voice" className="space-y-4 mt-0">
          <Field label="Voice samples" hint="Example lines of dialogue — the single best way to give a character a distinct voice. Separate samples with <START>.">
            <Textarea rows={10} value={card.mes_example} onChange={(e) => set("mes_example", e.target.value)} className={ta} />
          </Field>
          <Field label="Introduction" hint="How they first appear (from a chat card’s first message). Included as a voice sample.">
            <Textarea rows={5} value={card.first_mes} onChange={(e) => set("first_mes", e.target.value)} className={ta} />
          </Field>
        </TabsContent>
        <TabsContent value="lore" className="space-y-3 mt-0">
          <p className="text-sm text-muted-foreground">Embedded lorebook (character_book). Entries trigger on their keywords, like the project lorebook.</p>
          {entries.map((e, i) => (
            <div key={i} className="rounded-md border p-3 space-y-2 bg-card">
              <div className="flex gap-2 items-center">
                <Input
                  value={e.name ?? ""}
                  placeholder="Entry name"
                  onChange={(ev) => setEntries(entries.map((x, j) => (j === i ? { ...x, name: ev.target.value } : x)))}
                  className="flex-1"
                />
                <label className="flex items-center gap-1.5 text-xs">
                  <Switch checked={e.enabled} onCheckedChange={(v) => setEntries(entries.map((x, j) => (j === i ? { ...x, enabled: v } : x)))} /> On
                </label>
                <label className="flex items-center gap-1.5 text-xs">
                  <Switch checked={!!e.constant} onCheckedChange={(v) => setEntries(entries.map((x, j) => (j === i ? { ...x, constant: v } : x)))} /> Always
                </label>
                <Button size="icon" variant="ghost" onClick={() => setEntries(entries.filter((_, j) => j !== i))}>
                  <Trash2 className="size-4" />
                </Button>
              </div>
              <Input
                value={e.keys.join(", ")}
                placeholder="keywords, comma separated"
                onChange={(ev) => setEntries(entries.map((x, j) => (j === i ? { ...x, keys: ev.target.value.split(",").map((k) => k.trim()).filter(Boolean) } : x)))}
              />
              <Textarea rows={3} value={e.content} onChange={(ev) => setEntries(entries.map((x, j) => (j === i ? { ...x, content: ev.target.value } : x)))} className={ta} />
            </div>
          ))}
          <Button
            variant="outline"
            onClick={() => setEntries([...entries, { keys: [], content: "", extensions: {}, enabled: true, insertion_order: entries.length * 10, constant: false }])}
          >
            <Plus className="size-4" /> Add lore entry
          </Button>
        </TabsContent>
        <TabsContent value="meta" className="space-y-4 mt-0">
          <Field label="Tags">
            <Input value={card.tags.join(", ")} onChange={(e) => set("tags", e.target.value.split(",").map((t) => t.trim()).filter(Boolean))} />
          </Field>
          <Field label="Creator notes" hint="For you — not sent to the AI.">
            <Textarea rows={4} value={card.creator_notes} onChange={(e) => set("creator_notes", e.target.value)} className={ta} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Creator">
              <Input value={card.creator} onChange={(e) => set("creator", e.target.value)} />
            </Field>
            <Field label="Version">
              <Input value={card.character_version} onChange={(e) => set("character_version", e.target.value)} />
            </Field>
          </div>
        </TabsContent>
      </div>
    </Tabs>
  );
}
