import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { queryClient, trpc } from "@/lib/trpc";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ModelPicker } from "./ModelPicker";

type Form = {
  openrouterKey: string;
  openaiKey: string;
  openaiBase: string;
  anthropicKey: string;
  customName: string;
  customBase: string;
  customKey: string;
  summaryModel: string;
  contextBudget: number;
  temperature: number;
};

export function SettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const settings = useQuery(trpc.settings.get.queryOptions());
  const [f, setF] = useState<Form | null>(null);

  useEffect(() => {
    const s = settings.data;
    if (!s || !open) return;
    setF({
      openrouterKey: s.providers.openrouter.apiKey,
      openaiKey: s.providers.openai.apiKey,
      openaiBase: s.providers.openai.baseURL,
      anthropicKey: s.providers.anthropic.apiKey,
      customName: s.providers.custom.name,
      customBase: s.providers.custom.baseURL,
      customKey: s.providers.custom.apiKey,
      summaryModel: s.summaryModel,
      contextBudget: s.contextBudget,
      temperature: s.temperature,
    });
  }, [settings.data, open]);

  const save = useMutation(
    trpc.settings.update.mutationOptions({
      onSuccess: (s) => {
        queryClient.setQueryData(trpc.settings.get.queryKey(), s);
        queryClient.invalidateQueries({ queryKey: trpc.settings.models.queryKey() });
        toast.success("Settings saved");
        onOpenChange(false);
      },
      onError: (e) => toast.error(e.message),
    }),
  );

  if (!f) return null;
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF({ ...f, [k]: v });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[88vh] overflow-y-auto thin-scroll">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl font-normal">Settings</DialogTitle>
          <DialogDescription>Keys are stored in your local Tagore database and never leave this machine except to call the provider.</DialogDescription>
        </DialogHeader>

        <section className="space-y-4">
          <h3 className="small-caps text-sm text-muted-foreground">Providers</h3>
          <Field label="OpenRouter API key" hint="One key, hundreds of models. openrouter.ai/keys">
            <Input type="password" value={f.openrouterKey} onChange={(e) => set("openrouterKey", e.target.value)} placeholder="sk-or-…" />
          </Field>
          <Field label="Anthropic API key">
            <Input type="password" value={f.anthropicKey} onChange={(e) => set("anthropicKey", e.target.value)} placeholder="sk-ant-…" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="OpenAI API key">
              <Input type="password" value={f.openaiKey} onChange={(e) => set("openaiKey", e.target.value)} placeholder="sk-…" />
            </Field>
            <Field label="OpenAI base URL" hint="Optional">
              <Input value={f.openaiBase} onChange={(e) => set("openaiBase", e.target.value)} placeholder="https://api.openai.com/v1" />
            </Field>
          </div>
          <div className="rounded-md border border-dashed p-3 space-y-3">
            <p className="text-sm text-muted-foreground">Local or custom OpenAI-compatible endpoint (Ollama, LM Studio, llama.cpp, vLLM…)</p>
            <div className="grid grid-cols-[1fr_2fr] gap-3">
              <Field label="Name">
                <Input value={f.customName} onChange={(e) => set("customName", e.target.value)} />
              </Field>
              <Field label="Base URL">
                <Input value={f.customBase} onChange={(e) => set("customBase", e.target.value)} placeholder="http://localhost:11434/v1" />
              </Field>
            </div>
            <Field label="API key" hint="Optional">
              <Input type="password" value={f.customKey} onChange={(e) => set("customKey", e.target.value)} />
            </Field>
          </div>
        </section>

        <section className="space-y-4 pt-2">
          <h3 className="small-caps text-sm text-muted-foreground">Generation</h3>
          <Field label="Summary model" hint="Used to keep chapter summaries fresh. A cheaper, fast model works well. Blank = same as the writing model.">
            <div className="flex gap-2 items-center">
              <ModelPicker value={f.summaryModel || undefined} onChange={(r) => set("summaryModel", r)} className="max-w-none flex-1 justify-between" />
              {f.summaryModel && (
                <Button variant="ghost" size="sm" onClick={() => set("summaryModel", "")}>
                  Clear
                </Button>
              )}
            </div>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Context budget (tokens)" hint="Upper bound for what the agent is shown. Clamped to the model's window.">
              <Input type="number" step={1000} value={f.contextBudget} onChange={(e) => set("contextBudget", Number(e.target.value))} />
            </Field>
            <Field label={`Temperature · ${f.temperature.toFixed(2)}`}>
              <input
                type="range"
                min={0}
                max={1.5}
                step={0.05}
                value={f.temperature}
                onChange={(e) => set("temperature", Number(e.target.value))}
                className="w-full accent-[var(--oxblood)] mt-2"
              />
            </Field>
          </div>
        </section>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={save.isPending}
            onClick={() =>
              save.mutate({
                summaryModel: f.summaryModel,
                contextBudget: f.contextBudget,
                temperature: f.temperature,
                providers: {
                  openrouter: { apiKey: f.openrouterKey },
                  openai: { apiKey: f.openaiKey, baseURL: f.openaiBase },
                  anthropic: { apiKey: f.anthropicKey },
                  custom: { name: f.customName, baseURL: f.customBase, apiKey: f.customKey },
                },
              })
            }
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[13px] font-medium">{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
