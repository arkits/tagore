import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { BookOpen, MessagesSquare } from "lucide-react";
import { queryClient, trpc } from "@/lib/trpc";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "../settings/SettingsDialog";
import { ThemePicker } from "./ThemePicker";
import { DEFAULT_THEME, getTheme } from "@/lib/themes";
import type { StoryFormat } from "@shared/doc";
import { cn } from "@/lib/utils";

export function FormatToggle({ value, onChange }: { value: StoryFormat; onChange: (f: StoryFormat) => void }) {
  const opts: { id: StoryFormat; label: string; icon: React.ElementType; note: string }[] = [
    { id: "prose", label: "Book", icon: BookOpen, note: "Prose on the page" },
    { id: "chat", label: "Chat", icon: MessagesSquare, note: "Told in messages" },
  ];
  return (
    <div className="grid grid-cols-2 gap-2">
      {opts.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          className={cn(
            "flex items-center gap-3 rounded-md border px-3 py-2 text-left transition-colors",
            value === o.id ? "border-oxblood bg-oxblood/5" : "hover:bg-accent",
          )}
        >
          <o.icon className={cn("size-4", value === o.id ? "text-oxblood" : "text-ink-soft")} />
          <span>
            <span className="block text-sm font-medium">{o.label}</span>
            <span className="block text-xs text-muted-foreground">{o.note}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

export function StoryBibleDialog({ projectId, open, onOpenChange }: { projectId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const project = useQuery(trpc.projects.get.queryOptions(projectId));
  const cast = useQuery(trpc.characters.forProject.queryOptions(projectId));
  const [f, setF] = useState({ title: "", format: "prose" as StoryFormat, theme: "folio", pov: "", premise: "", styleGuide: "", authorsNote: "" });
  useEffect(() => {
    if (project.data && open) {
      const format: StoryFormat = project.data.format === "chat" ? "chat" : "prose";
      setF({
        title: project.data.title,
        format,
        theme: getTheme(project.data.theme, format).id,
        pov: project.data.pov,
        premise: project.data.premise,
        styleGuide: project.data.styleGuide,
        authorsNote: project.data.authorsNote,
      });
    }
  }, [project.data, open]);

  const save = useMutation(
    trpc.projects.update.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: trpc.projects.get.queryKey(projectId) });
        queryClient.invalidateQueries({ queryKey: trpc.projects.list.queryKey() });
        onOpenChange(false);
        toast.success("Story bible saved");
      },
    }),
  );

  const names = cast.data?.map((c) => c.character.card.nickname || c.character.name) ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto thin-scroll">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl font-normal">Story bible</DialogTitle>
          <DialogDescription>Always in the agent’s context. Keep it tight — every word here is paid for on every request.</DialogDescription>
        </DialogHeader>
        <Field label="Title">
          <Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} className="font-display text-lg" />
        </Field>

        <Field label="Form">
          <FormatToggle value={f.format} onChange={(format) => setF({ ...f, format, theme: format === f.format ? f.theme : DEFAULT_THEME[format] })} />
        </Field>
        <Field label="Look" hint="Each theme restyles the whole workspace for this story — fonts, page, colours, motion.">
          <ThemePicker format={f.format} value={f.theme} onChange={(theme) => setF({ ...f, theme })} />
        </Field>
        {f.format === "chat" && (
          <Field label="Whose screen is it?" hint="This character’s messages sit on the “me” side of the thread.">
            <Input list="pov-names" value={f.pov} onChange={(e) => setF({ ...f, pov: e.target.value })} placeholder={names[0] ?? "Me"} />
            <datalist id="pov-names">
              {names.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
          </Field>
        )}

        <Field label="Premise" hint="What the story is about: setup, stakes, the shape of the arc.">
          <Textarea rows={5} value={f.premise} onChange={(e) => setF({ ...f, premise: e.target.value })} className="font-book text-base" />
        </Field>
        <Field label="Style guide" hint="POV, tense, voice, tone, references, things to avoid.">
          <Textarea
            rows={4}
            value={f.styleGuide}
            onChange={(e) => setF({ ...f, styleGuide: e.target.value })}
            placeholder={
              f.format === "chat"
                ? "Jonah texts in lowercase with no punctuation. Mara over-explains, then deletes. Long silences matter."
                : "Close third person, past tense. Spare and wry, like early le Carré. No adverbs on dialogue tags."
            }
            className="font-book text-base"
          />
        </Field>
        <Field label="Author’s note" hint="Short, high-priority steering placed right before every instruction — e.g. the current mood or what to emphasise.">
          <Textarea rows={2} value={f.authorsNote} onChange={(e) => setF({ ...f, authorsNote: e.target.value })} className="font-book text-base" />
        </Field>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate({ id: projectId, ...f })} disabled={save.isPending}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
