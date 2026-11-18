import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, UserRound, Download, Pin, PinOff, Plus, Trash2, Upload, UserMinus, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { queryClient, trpc, type Character } from "@/lib/trpc";
import { Link, useLocation, useSearch } from "wouter";
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
      aria-hidden="true"
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

export function CharactersPage({
  projectId,
  manuscriptHref,
}: {
  projectId: string;
  manuscriptHref: string;
}) {
  const all = useQuery(trpc.characters.list.queryOptions());
  const cast = useQuery(trpc.characters.forProject.queryOptions(projectId));
  const project = useQuery(trpc.projects.get.queryOptions(projectId));
  const search = useSearch();
  const params = new URLSearchParams(search);
  const [, navigate] = useLocation();
  const chat = project.data?.format === "chat";
  const sel = params.get("character") ?? (chat ? "persona" : cast.data?.[0]?.character.id ?? all.data?.[0]?.id);
  const setSel = (id: string | null) => {
    const next = new URLSearchParams(search);
    if (id) next.set("character", id);
    else next.delete("character");
    const query = next.toString();
    navigate(`/p/${projectId}/characters${query ? `?${query}` : ""}`, { replace: true });
  };

  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: trpc.characters.list.queryKey() });
    queryClient.invalidateQueries({ queryKey: trpc.characters.forProject.queryKey(projectId) });
  };
  const onError = (e: { message: string }) => toast.error(e.message);
  const create = useMutation(trpc.characters.create.mutationOptions({ onSuccess: invalidate, onError }));
  const imp = useMutation(
    trpc.characters.import.mutationOptions({
      onSuccess: (r) => {
        invalidate();
        toast.success(`Imported ${r.name}${r.loreEntries ? ` with ${r.loreEntries} lore entries` : ""}`);
      },
      onError: (e) => toast.error(e.message),
    }),
  );
  const link = useMutation(trpc.characters.link.mutationOptions({ onSuccess: invalidate, onError }));
  const del = useMutation(trpc.characters.delete.mutationOptions({ onSuccess: invalidate, onError }));

  const castIds = new Set(cast.data?.map((c) => c.character.id));
  const library = all.data?.filter((c) => !castIds.has(c.id)) ?? [];
  const selected = all.data?.find((c) => c.id === sel);
  const membership = cast.data?.find((c) => c.character.id === sel);

  return (
    <main className="flex-1 min-w-0 overflow-y-auto thin-scroll bg-background" aria-labelledby="characters-title">
      <div className="@container mx-auto max-w-6xl px-4 py-6 sm:px-8 sm:py-9">
        <Link href={manuscriptHref} className="inline-flex items-center gap-2 text-sm text-ink-soft hover:text-oxblood">
          <ArrowLeft className="size-4" /> Back to manuscript
        </Link>
        <header className="flex flex-wrap items-end justify-between gap-4 border-b border-rule pb-5 pt-4">
          <h1 id="characters-title" className="font-display text-4xl tracking-tight text-ink sm:text-5xl">Characters</h1>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" disabled={create.isPending} onClick={() => create.mutate({ projectId }, { onSuccess: (r) => setSel(r.id) })}>
              <Plus className="size-4" /> New character
            </Button>
            <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={imp.isPending}>
              <Upload className="size-4" /> Import card
            </Button>
            <input ref={fileRef} type="file" accept=".png,.json,image/png,application/json" className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                try {
                  imp.mutate({ fileName: file.name, dataUrl: await readFile(file), projectId }, { onSuccess: (r) => setSel(r.id) });
                } catch {
                  toast.error("Could not read the character card");
                }
              }}
            />
          </div>
        </header>
        <div className="grid items-start gap-5 pt-5 @3xl:grid-cols-[14rem_minmax(0,1fr)]">
          <aside aria-label="Character roster" className="max-h-64 overflow-y-auto thin-scroll rounded-md border border-rule bg-sidebar/50 p-2 @3xl:max-h-none">
            {chat && (
              <button type="button" aria-pressed={sel === "persona"} onClick={() => setSel("persona")}
                className={cn("mb-3 flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left hover:bg-accent", sel === "persona" && "bg-accent")}>
                <UserRound className="size-7 rounded-full border border-rule p-1.5 text-oxblood" />
                <span className="flex-1 text-sm">My persona</span>
                <span className="text-xs text-muted-foreground">Me</span>
              </button>
            )}
            <p className="small-caps px-2 pb-1.5 pt-1 text-xs text-muted-foreground">In this story</p>
            {cast.data?.map(({ character: c, pinned }) => (
              <Row key={c.id} c={c} active={sel === c.id} onClick={() => setSel(c.id)} badge={pinned ? <Pin className="size-3 text-oxblood" /> : null} />
            ))}
            {cast.isSuccess && !cast.data.length && <p className="text-xs text-muted-foreground px-2 pb-2">No one yet.</p>}
            {library.length > 0 && <p className="small-caps text-xs text-muted-foreground px-2 pt-4 pb-1.5">Library</p>}
            {library.map((c) => (
              <Row key={c.id} c={c} active={sel === c.id} onClick={() => setSel(c.id)} muted />
            ))}
          </aside>

          <section aria-label="Character details" className="min-w-0 rounded-md border border-rule bg-card">
            {sel === "persona" && chat && project.data ? (
              <PersonaEditor key={projectId} project={project.data} />
            ) : selected ? (
              <>
                <div className="flex flex-wrap items-center gap-2 px-3 sm:px-6 py-3 border-b bg-secondary/30">
                  {membership ? (
                    <>
                      <Button
                        size="sm"
                        disabled={link.isPending}
                        variant="ghost"
                        onClick={() => link.mutate({ projectId, characterId: selected.id, linked: true, pinned: !membership.pinned })}
                        title="Pinned characters are always in full context"
                      >
                        {membership.pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
                        {membership.pinned ? "Unpin" : "Pin to context"}
                      </Button>
                      <Button size="sm" variant="ghost" disabled={link.isPending} onClick={() => link.mutate({ projectId, characterId: selected.id, linked: false })}>
                        <UserMinus className="size-4" /> Remove from story
                      </Button>
                    </>
                  ) : (
                    <Button size="sm" disabled={link.isPending} onClick={() => link.mutate({ projectId, characterId: selected.id, linked: true })}>
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
              <p className="p-8 text-center font-book text-lg italic text-muted-foreground">
                {all.isError || cast.isError ? "Could not load characters." : all.isPending || cast.isPending ? "Loading characters…" : "Choose or create a character."}
              </p>
            )}
          </section>
        </div>
        <ConfirmDialog
          open={deleteTarget !== null}
          onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
          title="Delete character?"
          description={`“${deleteTarget?.name}” will be permanently deleted from the library and removed from all stories.`}
          action="Delete character"
          onConfirm={() => { if (deleteTarget) del.mutate(deleteTarget.id, { onSuccess: () => setSel(null) }); }}
        />
      </div>
    </main>
  );
}

function PersonaEditor({ project }: { project: { id: string; pov: string; personaDescription: string } }) {
  const [name, setName] = useState(project.pov);
  const [description, setDescription] = useState(project.personaDescription);
  const pov = name.trim();
  const personaDescription = description.trim();
  const changed = pov !== project.pov || personaDescription !== project.personaDescription;
  const save = useMutation(trpc.projects.update.mutationOptions({
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: trpc.projects.get.queryKey(project.id) }),
        queryClient.invalidateQueries({ queryKey: trpc.projects.list.queryKey() }),
      ]);
      toast.success("Persona saved");
    },
    onError: (e) => toast.error(e.message),
  }));

  return (
    <form className="space-y-5 p-4 sm:p-6" onSubmit={(e) => {
      e.preventDefault();
      if (changed && !save.isPending) save.mutate({ id: project.id, pov, personaDescription });
    }}>
      <div className="flex items-center gap-3 border-b border-rule pb-4">
        <Avatar c={{ name: pov || "Me", avatar: null }} size={48} />
        <div>
          <h2 className="font-display text-2xl text-ink">My persona</h2>
          <p className="text-sm text-muted-foreground">The person on the “me” side of this story’s chat.</p>
        </div>
      </div>
      <div className="space-y-1.5">
        <label htmlFor="persona-name" className="text-sm font-medium">Sender name</label>
        <Input id="persona-name" value={name} maxLength={80} placeholder="Me" aria-describedby="persona-name-hint" onChange={(e) => setName(e.target.value)} />
        <p id="persona-name-hint" className="text-xs text-muted-foreground">Leave blank to use “Me”. Existing messages keep their original sender names.</p>
      </div>
      <div className="space-y-1.5">
        <label htmlFor="persona-description" className="text-sm font-medium">Persona description</label>
        <Textarea id="persona-description" rows={7} value={description} maxLength={4000} onChange={(e) => setDescription(e.target.value)}
          aria-describedby="persona-description-hint" className="font-book text-base leading-relaxed" />
        <p id="persona-description-hint" className="text-xs text-muted-foreground">Give the co-author details about your persona’s background, personality, or texting voice.</p>
      </div>
      <Button type="submit" disabled={!changed || save.isPending}>{save.isPending ? "Saving…" : "Save persona"}</Button>
    </form>
  );
}

function Row({ c, active, onClick, badge, muted }: { c: Character; active: boolean; onClick: () => void; badge?: React.ReactNode; muted?: boolean }) {
  return (
    <button aria-pressed={active} onClick={onClick} className={cn("w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md hover:bg-accent text-left", active && "bg-accent", muted && "opacity-70")}>
      <Avatar c={c} size={28} />
      <span className="truncate text-sm flex-1">{c.name}</span>
      {badge}
    </button>
  );
}

function CardEditor({ character, onSaved }: { character: Character; onSaved: () => void }) {
  const [card, setCard] = useState<CardData>(character.card);
  const [avatar, setAvatar] = useState<string | null>(character.avatar);
  const [edited, setEdited] = useState(false);
  const queued = useRef<(() => void) | null>(null);
  const save = useMutation(trpc.characters.update.mutationOptions({
    scope: { id: character.id },
    onSuccess: ({ character: updated }) => {
      if (updated) {
        queryClient.setQueryData(trpc.characters.list.queryOptions().queryKey, (list) =>
          list?.map((entry) => entry.id === updated.id ? updated : entry),
        );
      }
      onSaved();
    },
    onError: (e) => toast.error(e.message),
  }));
  const { mutate } = save;
  const unsaved = save.variables?.card !== card || save.variables?.avatar !== avatar;
  const saveStatus = !edited ? "" : save.isPending || unsaved ? "Saving…" : save.isError ? "Save failed" : "Saved";

  useEffect(() => {
    if (!edited) return;
    const submit = () => {
      queued.current = null;
      mutate({ id: character.id, card, avatar });
    };
    queued.current = submit;
    const timer = setTimeout(submit, 600);
    return () => clearTimeout(timer);
  }, [edited, character.id, card, avatar, mutate]);

  useEffect(() => () => queued.current?.(), []);

  const set = <K extends keyof CardData>(k: K, v: CardData[K]) => {
    setEdited(true);
    setCard((c) => ({ ...c, [k]: v }));
  };
  const entries = card.character_book?.entries ?? [];
  const setEntries = (e: LoreEntry[]) => set("character_book", { ...(card.character_book ?? { extensions: {} }), entries: e });
  const ta = "font-book text-base leading-relaxed";

  return (
    <Tabs defaultValue="profile" className="flex-1 min-h-0 flex flex-col">
      <div className="px-3 sm:px-6 pt-4">
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <label className="cursor-pointer group relative" title="Change portrait">
            <Avatar c={{ name: card.name, avatar }} size={64} />
            <span className="absolute inset-0 rounded-full bg-black/30 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 grid place-items-center text-white text-[10px]">Change</span>
            <input
              type="file"
              accept="image/*"
              aria-label="Change portrait"
              className="sr-only"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                try {
                  const portrait = await readFile(f);
                  setEdited(true);
                  setAvatar(portrait);
                } catch {
                  toast.error("Could not read the portrait");
                }
              }}
            />
          </label>
          <div className="flex-1 min-w-44 grid sm:grid-cols-[2fr_1fr] gap-3">
            <Input aria-label="Character name" value={card.name} onChange={(e) => set("name", e.target.value)} className="font-display text-2xl h-12" />
            <Input aria-label="Nickname" value={card.nickname ?? ""} onChange={(e) => set("nickname", e.target.value || undefined)} placeholder="Nickname" className="h-12" />
          </div>
          <span role="status" className="text-xs text-muted-foreground w-16 text-right">{saveStatus}</span>
        </div>
        <TabsList className="h-auto max-w-full flex-wrap">
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="voice">Voice</TabsTrigger>
          <TabsTrigger value="lore">Lore {entries.length ? `(${entries.length})` : ""}</TabsTrigger>
          <TabsTrigger value="meta">Notes & tags</TabsTrigger>
        </TabsList>
      </div>
      <div className="px-3 sm:px-6 pb-6 pt-4">
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
