import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { queryClient, trpc } from "@/lib/trpc";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "../settings/SettingsDialog";
import { cn } from "@/lib/utils";

export function StoryBibleDialog({ projectId, open, onOpenChange }: { projectId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const project = useQuery(trpc.projects.get.queryOptions(projectId));
  const [f, setF] = useState({ title: "", format: "prose" as "prose" | "script", premise: "", styleGuide: "", authorsNote: "" });
  useEffect(() => {
    if (project.data && open)
      setF({
        title: project.data.title,
        format: project.data.format,
        premise: project.data.premise,
        styleGuide: project.data.styleGuide,
        authorsNote: project.data.authorsNote,
      });
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto thin-scroll">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl font-normal">Story bible</DialogTitle>
          <DialogDescription>Always in the agent’s context. Keep it tight — every word here is paid for on every request.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-[1fr_auto] gap-3 items-end">
          <Field label="Title">
            <Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} className="font-display text-lg" />
          </Field>
          <div className="flex rounded-md border p-0.5 h-9">
            {(["prose", "script"] as const).map((k) => (
              <button
                key={k}
                onClick={() => setF({ ...f, format: k })}
                className={cn("px-3 rounded text-sm capitalize", f.format === k ? "bg-primary text-primary-foreground" : "hover:bg-accent")}
              >
                {k === "prose" ? "Book" : "Script"}
              </button>
            ))}
          </div>
        </div>
        <Field label="Premise" hint="What the story is about: setup, stakes, the shape of the arc.">
          <Textarea rows={5} value={f.premise} onChange={(e) => setF({ ...f, premise: e.target.value })} className="font-book text-base" />
        </Field>
        <Field label="Style guide" hint="POV, tense, voice, tone, references, things to avoid.">
          <Textarea
            rows={4}
            value={f.styleGuide}
            onChange={(e) => setF({ ...f, styleGuide: e.target.value })}
            placeholder="Close third person, past tense. Spare and wry, like early le Carré. No adverbs on dialogue tags."
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
