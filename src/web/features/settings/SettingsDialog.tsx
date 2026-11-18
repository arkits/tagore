/**
 * Settings — styled like a library catalogue drawer: a contents rail with roman-numeral
 * sections on the left, index-card provider entries with rubber-stamp status on the right.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowUpRight, Download, Eye, EyeOff, Loader2, Lock, Monitor, Moon, PlugZap, Sun } from "lucide-react";
import { queryClient, trpc, type Project } from "@/lib/trpc";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ThemeSwitcher } from "../project/ThemeSwitcher";
import { ModelPicker } from "./ModelPicker";
import { useTheme, type ThemePref } from "@/lib/theme";
import { cn } from "@/lib/utils";

type ProviderId = "openrouter" | "anthropic" | "openai" | "custom";

type Form = {
  openrouter: { apiKey: string };
  anthropic: { apiKey: string };
  openai: { apiKey: string; baseURL: string };
  custom: { name: string; baseURL: string; apiKey: string };
  model: string;
  summaryModel: string;
  contextBudget: number;
  temperature: number;
  openRouterReasoning: boolean | null;
};

type TestState = { status: "idle" | "testing" | "ok" | "fail"; message?: string; detail?: string; ms?: number };

const SECTIONS = [
  { id: "providers", numeral: "I", title: "Providers" },
  { id: "models", numeral: "II", title: "Models" },
  { id: "generation", numeral: "III", title: "Generation" },
  { id: "appearance", numeral: "IV", title: "Appearance" },
] as const;

const PROVIDERS: { id: ProviderId; name: string; mark: string; blurb: string; href?: string }[] = [
  { id: "openrouter", name: "OpenRouter", mark: "O", blurb: "One key, hundreds of models — the easiest start.", href: "https://openrouter.ai/keys" },
  { id: "anthropic", name: "Anthropic", mark: "A", blurb: "Claude, directly.", href: "https://console.anthropic.com/settings/keys" },
  { id: "openai", name: "OpenAI", mark: "◎", blurb: "GPT models, or any service speaking the OpenAI dialect.", href: "https://platform.openai.com/api-keys" },
  { id: "custom", name: "Local & custom", mark: "⌂", blurb: "Ollama, LM Studio, llama.cpp, vLLM — anything OpenAI-compatible." },
];

const STORY_SECTION = { id: "story", numeral: "V", title: "Story" } as const;

export function SettingsDialog({
  open,
  onOpenChange,
  story,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  story?: { project: Project; onExport: () => Promise<void> };
}) {
  const sections = story ? [...SECTIONS, STORY_SECTION] : SECTIONS;
  const settings = useQuery(trpc.settings.get.queryOptions());
  const [f, setF] = useState<Form | null>(null);
  const [initial, setInitial] = useState("");
  const [tests, setTests] = useState<Partial<Record<ProviderId, TestState>>>({});
  const [active, setActive] = useState<string>("providers");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const s = settings.data;
    if (!s || !open) return;
    const form: Form = {
      openrouter: { ...s.providers.openrouter },
      anthropic: { ...s.providers.anthropic },
      openai: { ...s.providers.openai },
      custom: { ...s.providers.custom },
      model: s.model,
      summaryModel: s.summaryModel,
      contextBudget: s.contextBudget,
      temperature: s.temperature,
      openRouterReasoning: s.openRouterReasoning,
    };
    setF(form);
    setInitial(JSON.stringify(form));
    setTests({});
    setActive("providers");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, settings.data === undefined]);

  // Scroll-spy for the contents rail: the last section whose heading has passed the top third.
  const onScroll = () => {
    const root = scrollRef.current;
    if (!root) return;
    const top = root.getBoundingClientRect().top + root.clientHeight * 0.33;
    let current: string = SECTIONS[0].id;
    for (const sec of sections) {
      const el = root.querySelector(`#${sec.id}`);
      if (el && el.getBoundingClientRect().top <= top) current = sec.id;
    }
    if (root.scrollTop + root.clientHeight >= root.scrollHeight - 4) current = sections.at(-1)!.id;
    setActive(current);
  };

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
  const testMut = useMutation(trpc.settings.testProvider.mutationOptions());

  const dirty = useMemo(() => !!f && JSON.stringify(f) !== initial, [f, initial]);
  if (!f) return null;

  const setProvider = <P extends ProviderId>(id: P, patch: Partial<Form[P]>) => {
    setF({ ...f, [id]: { ...f[id], ...patch } });
    setTests((t) => ({ ...t, [id]: { status: "idle" } }));
  };

  const runTest = async (id: ProviderId) => {
    setTests((t) => ({ ...t, [id]: { status: "testing" } }));
    const p = f[id] as { apiKey?: string; baseURL?: string };
    try {
      const r = await testMut.mutateAsync({ provider: id, apiKey: p.apiKey, baseURL: p.baseURL });
      setTests((t) => ({ ...t, [id]: { status: r.ok ? "ok" : "fail", message: r.message, detail: r.detail, ms: r.ms } }));
    } catch (e: any) {
      setTests((t) => ({ ...t, [id]: { status: "fail", message: "Error", detail: e.message } }));
    }
  };

  const jump = (id: string) => {
    setActive(id);
    scrollRef.current?.querySelector(`#${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton
        className="sm:max-w-[940px] p-0 gap-0 overflow-hidden h-[min(740px,90vh)] grid grid-cols-[232px_1fr] grid-rows-1 bg-paper"
      >
        {/* ---------------------------------------------------------------- rail */}
        <aside className="relative bg-sidebar border-r flex flex-col overflow-hidden">
          <span aria-hidden className="pointer-events-none absolute -bottom-16 -left-6 font-display text-[260px] leading-none text-ink/[0.04] select-none">
            §
          </span>
          <div className="px-7 pt-8 pb-6">
            <p className="small-caps text-[11px] text-muted-foreground">Tagore</p>
            <DialogTitle className="font-display text-[34px] leading-[1.05] font-light italic tracking-tight mt-1">Settings</DialogTitle>
            <DialogDescription className="sr-only">Providers, models, generation, appearance{story ? ", and story settings." : "."}</DialogDescription>
          </div>
          <nav className="px-4 space-y-0.5">
            {sections.map((s) => (
              <button
                key={s.id}
                onClick={() => jump(s.id)}
                className={cn(
                  "group relative w-full flex items-baseline gap-3 rounded-sm pl-4 pr-3 py-2 text-left transition-colors",
                  active === s.id ? "text-ink" : "text-muted-foreground hover:text-ink",
                )}
              >
                <span
                  className={cn(
                    "absolute left-0 top-2 bottom-2 w-[2px] rounded-full bg-oxblood transition-all duration-300",
                    active === s.id ? "opacity-100" : "opacity-0 scale-y-50",
                  )}
                />
                <span className={cn("font-display text-[13px] w-6 tabular-nums transition-colors", active === s.id && "text-oxblood")}>{s.numeral}.</span>
                <span className="text-[15px]">{s.title}</span>
              </button>
            ))}
          </nav>
          <div className="mt-auto px-7 pb-7 relative">
            <div className="h-px w-8 bg-rule mb-4" />
            <p className="flex gap-2 text-[12.5px] leading-snug text-muted-foreground italic">
              <Lock className="size-3.5 shrink-0 mt-0.5 not-italic" />
              Keys live in your local database and travel only to their own provider.
            </p>
          </div>
        </aside>

        {/* ------------------------------------------------------------- content */}
        <div className="flex flex-col min-h-0">
          <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto thin-scroll px-10 pt-9 pb-10 space-y-14">
            <Section id="providers" numeral="I" title="Providers" lede="Connect at least one. Test before you save — nothing is spent, we only ask who you are.">
              <div className="space-y-4">
                {PROVIDERS.map((p, i) => (
                  <ProviderCard
                    key={p.id}
                    meta={p}
                    test={tests[p.id]}
                    onTest={() => runTest(p.id)}
                    index={i}
                    configured={p.id === "custom" ? !!f.custom.baseURL : !!f[p.id].apiKey}
                  >
                    {p.id === "custom" ? (
                      <div className="grid grid-cols-[1fr_2fr] gap-x-4 gap-y-3">
                        <CardField label="Label">
                          <Ledger value={f.custom.name} onChange={(v) => setProvider("custom", { name: v })} placeholder="Local" />
                        </CardField>
                        <CardField label="Base URL">
                          <Ledger mono value={f.custom.baseURL} onChange={(v) => setProvider("custom", { baseURL: v })} placeholder="http://localhost:11434/v1" />
                        </CardField>
                        <CardField label="API key" hint="optional" className="col-span-2">
                          <SecretField value={f.custom.apiKey} onChange={(v) => setProvider("custom", { apiKey: v })} />
                        </CardField>
                      </div>
                    ) : p.id === "openai" ? (
                      <div className="grid grid-cols-[3fr_2fr] gap-x-4">
                        <CardField label="API key">
                          <SecretField value={f.openai.apiKey} onChange={(v) => setProvider("openai", { apiKey: v })} placeholder="sk-…" />
                        </CardField>
                        <CardField label="Base URL" hint="optional">
                          <Ledger mono value={f.openai.baseURL} onChange={(v) => setProvider("openai", { baseURL: v })} placeholder="api.openai.com/v1" />
                        </CardField>
                      </div>
                    ) : (
                      <CardField label="API key">
                        <SecretField
                          value={f[p.id].apiKey}
                          onChange={(v) => setProvider(p.id, { apiKey: v })}
                          placeholder={p.id === "openrouter" ? "sk-or-v1-…" : "sk-ant-…"}
                        />
                      </CardField>
                    )}
                  </ProviderCard>
                ))}
              </div>
            </Section>

            <Section id="models" numeral="II" title="Models" lede="Choose the models for writing and chapter summaries.">
              <div className="divide-y divide-rule border-y border-rule">
                <LedgerRow title="Writing model" note="Drafts, continues and revises. The stronger, the better the prose.">
                  <ModelPicker value={f.model} onChange={(r) => setF({ ...f, model: r })} className="w-full max-w-none justify-between h-10" />
                </LedgerRow>
                <LedgerRow title="Summary model" note="Keeps chapter summaries — the agent’s long memory — current. A small, fast model is plenty.">
                  <div className="flex gap-2">
                    <ModelPicker
                      value={f.summaryModel || f.model}
                      onChange={(r) => setF({ ...f, summaryModel: r })}
                      className="flex-1 max-w-none justify-between h-10"
                    />
                    {f.summaryModel && (
                      <Button variant="ghost" size="sm" className="h-10" onClick={() => setF({ ...f, summaryModel: "" })}>
                        Use writing model
                      </Button>
                    )}
                  </div>
                  {!f.summaryModel && <p className="text-xs italic text-muted-foreground mt-1.5">Currently the writing model.</p>}
                </LedgerRow>
              </div>
            </Section>

            <Section id="generation" numeral="III" title="Generation" lede="How much the agent reads before it writes, and how freely it writes.">
              <div className="divide-y divide-rule border-y border-rule">
                <LedgerRow title="OpenRouter thinking" note="Applies to writing and summaries when the model supports optional thinking.">
                  <div role="group" aria-label="OpenRouter thinking" className="flex flex-wrap gap-1.5">
                    {([
                      { value: null, label: "Model default" },
                      { value: true, label: "On" },
                      { value: false, label: "Off" },
                    ] as const).map(({ value, label }) => (
                      <Button
                        key={label}
                        type="button"
                        size="sm"
                        variant={f.openRouterReasoning === value ? "default" : "outline"}
                        aria-pressed={f.openRouterReasoning === value}
                        onClick={() => setF({ ...f, openRouterReasoning: value })}
                      >
                        {label}
                      </Button>
                    ))}
                  </div>
                </LedgerRow>
                <LedgerRow
                  title="Context budget"
                  note="The most the agent is shown per request. Larger reads more of your book — and costs more. Always clamped to the model’s window."
                >
                  <BudgetPicker value={f.contextBudget} onChange={(v) => setF({ ...f, contextBudget: v })} />
                </LedgerRow>
                <LedgerRow title="Temperature" note="Lower is careful and consistent; higher takes more risks with phrasing and plot.">
                  <TemperatureDial value={f.temperature} onChange={(v) => setF({ ...f, temperature: v })} />
                </LedgerRow>
              </div>
            </Section>

            <Section id="appearance" numeral="IV" title="Appearance" lede="Saved instantly, on this device.">
              <ThemeTiles />
            </Section>

            {story && (
              <Section {...STORY_SECTION} lede={story.project.title}>
                <div className="divide-y divide-rule border-y border-rule">
                  <div className="space-y-3 py-5">
                    <div>
                      <h3 className="font-display text-[17px] leading-tight">Story theme</h3>
                      <p className="text-[13px] text-muted-foreground mt-1">Applies immediately to this story.</p>
                    </div>
                    <ThemeSwitcher project={story.project} />
                  </div>
                  <LedgerRow title="Export manuscript" note="Download all chapters in order as a Markdown file.">
                    <Button variant="outline" onClick={story.onExport}>
                      <Download className="size-4" /> Export story as Markdown
                    </Button>
                  </LedgerRow>
                </div>
              </Section>
            )}
          </div>

          <footer className="shrink-0 flex items-center gap-3 border-t bg-sidebar/60 px-10 py-3.5">
            <span className={cn("flex items-center gap-2 text-sm transition-opacity", dirty ? "opacity-100" : "opacity-0")}>
              <span className="size-1.5 rounded-full bg-oxblood animate-pulse" />
              <span className="italic text-muted-foreground">Unsaved changes</span>
            </span>
            <div className="flex-1" />
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              {dirty ? "Discard" : "Close"}
            </Button>
            <Button
              disabled={!dirty || save.isPending}
              className="min-w-24"
              onClick={() =>
                save.mutate({
                  model: f.model,
                  summaryModel: f.summaryModel,
                  contextBudget: f.contextBudget,
                  temperature: f.temperature,
                  openRouterReasoning: f.openRouterReasoning,
                  providers: { openrouter: f.openrouter, openai: f.openai, anthropic: f.anthropic, custom: f.custom },
                })
              }
            >
              {save.isPending ? <Loader2 className="size-4 animate-spin" /> : "Save"}
            </Button>
          </footer>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ================================================================= pieces */

function Section({ id, numeral, title, lede, children }: { id: string; numeral: string; title: string; lede: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-6">
      <header className="mb-6">
        <div className="flex items-baseline gap-3">
          <span className="font-display text-oxblood text-lg">{numeral}.</span>
          <h2 className="font-display text-[28px] font-light tracking-tight leading-none">{title}</h2>
        </div>
        <p className="mt-2 text-[15px] italic text-muted-foreground max-w-[52ch]">{lede}</p>
      </header>
      {children}
    </section>
  );
}

function StatusStamp({ test, configured }: { test?: TestState; configured: boolean }) {
  const s = test?.status ?? "idle";
  if (s === "testing")
    return (
      <span className="inline-flex items-center gap-1.5 text-xs italic text-muted-foreground">
        <Loader2 className="size-3 animate-spin" /> Asking…
      </span>
    );
  if (s === "ok" || s === "fail")
    return (
      <span
        key={s + (test?.ms ?? "")}
        style={{ "--r": s === "ok" ? "-3deg" : "2deg" } as React.CSSProperties}
        className={cn(
          "stamp inline-block rounded-[3px] border-[1.5px] px-2 py-[1px] font-display text-[11px] uppercase tracking-[0.14em]",
          s === "ok" ? "border-sage text-sage" : "border-oxblood text-oxblood",
        )}
      >
        {test?.message}
      </span>
    );
  return (
    <span className={cn("text-[11px] small-caps", configured ? "text-ink-soft" : "text-muted-foreground/70")}>{configured ? "on file" : "not set"}</span>
  );
}

function ProviderCard({
  meta,
  test,
  onTest,
  index,
  configured,
  children,
}: {
  meta: (typeof PROVIDERS)[number];
  test?: TestState;
  onTest: () => void;
  index: number;
  configured: boolean;
  children: React.ReactNode;
}) {
  return (
    <article
      style={{ animationDelay: `${index * 60}ms` }}
      className={cn(
        "card-in relative rounded-[3px] border bg-card pl-7 pr-5 pt-4 pb-4",
        "shadow-[0_1px_0_var(--sheen-edge)_inset,0_1px_2px_rgba(var(--shadow-ink),0.06)]",
        // index-card margin rule
        "before:absolute before:left-[18px] before:top-0 before:bottom-0 before:w-px before:bg-oxblood/25",
      )}
    >
      <header className="flex items-start gap-3.5">
        <span className="mt-0.5 size-9 shrink-0 rounded-[3px] border border-rule bg-secondary/60 grid place-items-center font-display text-lg text-ink-soft">
          {meta.mark}
        </span>
        <div className="flex-1 min-w-0">
          <h3 className="font-display text-[19px] leading-tight">{meta.name}</h3>
          <p className="text-[13.5px] text-muted-foreground leading-snug">{meta.blurb}</p>
        </div>
        <div className="pt-1">
          <StatusStamp test={test} configured={configured} />
        </div>
      </header>
      <div className="mt-4">{children}</div>
      <footer className="mt-3.5 flex items-center gap-3 min-h-8">
        <Button size="sm" variant="outline" className="h-8 bg-transparent" onClick={onTest} disabled={!configured || test?.status === "testing"}>
          {test?.status === "testing" ? <Loader2 className="size-3.5 animate-spin" /> : <PlugZap className="size-3.5" />}
          Test connection
        </Button>
        <span
          className={cn("text-[12.5px] truncate", test?.status === "fail" ? "text-destructive" : "text-muted-foreground")}
          title={test?.detail}
        >
          {test?.status === "ok" && `${test.detail ?? ""}${test.detail ? " · " : ""}${test.ms} ms`}
          {test?.status === "fail" && (test.detail ?? test.message)}
        </span>
        {meta.href && (
          <a
            href={meta.href}
            target="_blank"
            rel="noreferrer"
            className="ml-auto shrink-0 inline-flex items-center gap-0.5 text-[12.5px] text-muted-foreground hover:text-oxblood underline-offset-4 hover:underline"
          >
            Get a key <ArrowUpRight className="size-3" />
          </a>
        )}
      </footer>
    </article>
  );
}

/** Plain labelled field, shared by other dialogs. */
export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[13px] font-medium">{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function CardField({ label, hint, className, children }: { label: string; hint?: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("space-y-1", className)}>
      <Label className="small-caps text-[11px] font-normal text-muted-foreground gap-1.5">
        {label}
        {hint && <span className="normal-case tracking-normal italic opacity-70">— {hint}</span>}
      </Label>
      {children}
    </div>
  );
}

/** Underlined "ledger line" input — feels like writing on the card rather than filling a box. */
function Ledger({
  value,
  onChange,
  placeholder,
  mono,
  type = "text",
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  type?: string;
  className?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      spellCheck={false}
      autoComplete="off"
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={cn(
        "w-full bg-transparent border-0 border-b border-input px-0.5 py-1.5 outline-none transition-colors",
        "placeholder:text-muted-foreground/60 focus:border-oxblood",
        mono ? "font-script text-[13.5px]" : "text-[15px]",
        className,
      )}
    />
  );
}

function SecretField({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [show, setShow] = useState(false);
  const masked = value.startsWith("••••");
  return (
    <div className="relative">
      <Ledger
        mono
        type={show || masked ? "text" : "password"}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className={cn("pr-8", masked && "text-ink-soft")}
      />
      {!masked && value && (
        <button
          type="button"
          onClick={() => setShow(!show)}
          className="absolute right-0 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-ink"
          aria-label={show ? "Hide key" : "Show key"}
        >
          {show ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
        </button>
      )}
      {masked && (
        <button
          type="button"
          onClick={() => onChange("")}
          className="absolute right-0 top-1/2 -translate-y-1/2 text-[11.5px] italic text-muted-foreground hover:text-oxblood"
        >
          replace
        </button>
      )}
    </div>
  );
}

function LedgerRow({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,15rem)_1fr] gap-8 py-5">
      <div>
        <h3 className="font-display text-[17px] leading-tight">{title}</h3>
        <p className="text-[13px] text-muted-foreground leading-snug mt-1">{note}</p>
      </div>
      <div className="self-center min-w-0">{children}</div>
    </div>
  );
}

const BUDGETS = [16_000, 32_000, 48_000, 96_000, 200_000];

function BudgetPicker({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  // ~0.75 words/token, ~300 words per printed page
  const pages = Math.round((value * 0.75) / 300);
  return (
    <div>
      <div className="flex rounded-[3px] border border-input overflow-hidden">
        {BUDGETS.map((b) => (
          <button
            key={b}
            onClick={() => onChange(b)}
            className={cn(
              "flex-1 py-1.5 text-sm tabular-nums border-r last:border-r-0 border-input transition-colors",
              value === b ? "bg-primary text-primary-foreground" : "hover:bg-accent",
            )}
          >
            {b / 1000}k
          </button>
        ))}
      </div>
      <div className="flex items-center justify-between mt-2 text-[12.5px] text-muted-foreground">
        <span className="italic">
          ≈ {pages.toLocaleString()} printed pages of material
        </span>
        <label className="flex items-center gap-1.5">
          exact
          <input
            type="number"
            step={1000}
            min={4000}
            value={value}
            onChange={(e) => onChange(Math.max(4000, Number(e.target.value) || 4000))}
            className="w-24 bg-transparent border-b border-input text-right tabular-nums outline-none focus:border-oxblood text-ink"
          />
        </label>
      </div>
    </div>
  );
}

function TemperatureDial({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const label = value < 0.45 ? "Faithful" : value < 1.0 ? "Balanced" : "Adventurous";
  const pct = (value / 1.5) * 100;
  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <span className="font-display italic text-[17px]">{label}</span>
        <span className="font-script text-sm tabular-nums text-ink-soft">{value.toFixed(2)}</span>
      </div>
      <input
        type="range"
        min={0}
        max={1.5}
        step={0.05}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="tagore-range w-full"
        style={{ "--pct": `${pct}%` } as React.CSSProperties}
      />
      <div className="flex justify-between text-[11px] small-caps text-muted-foreground mt-1">
        <span>faithful</span>
        <span>balanced</span>
        <span>adventurous</span>
      </div>
    </div>
  );
}

function ThemeTiles() {
  const { pref, setTheme } = useTheme();
  const tiles: { id: ThemePref; name: string; icon: React.ElementType; paper: string; desk: string; ink: string }[] = [
    { id: "light", name: "Daylight", icon: Sun, paper: "#fbf5e8", desk: "#e9dfcb", ink: "#2a2017" },
    { id: "dark", name: "Lamplight", icon: Moon, paper: "#211a14", desk: "#16110d", ink: "#eadcc2" },
    { id: "system", name: "Follow system", icon: Monitor, paper: "linear-gradient(115deg,#fbf5e8 50%,#211a14 50%)", desk: "linear-gradient(115deg,#e9dfcb 50%,#16110d 50%)", ink: "#8a7a64" },
  ];
  return (
    <div className="grid grid-cols-3 gap-4">
      {tiles.map((t) => (
        <button
          key={t.id}
          onClick={() => setTheme(t.id)}
          aria-pressed={pref === t.id}
          className={cn(
            "group rounded-[4px] border p-2 text-left transition-all",
            pref === t.id ? "border-oxblood ring-1 ring-oxblood/30" : "hover:border-ring",
          )}
        >
          <div className="h-24 rounded-[2px] p-3 flex items-end" style={{ background: t.desk }}>
            <div className="h-full w-3/5 mx-auto rounded-[1px] shadow-md px-2.5 pt-2.5 space-y-1.5" style={{ background: t.paper }}>
              {[100, 92, 96, 70].map((w, i) => (
                <div key={i} className="h-[3px] rounded-full" style={{ width: `${w}%`, background: t.ink, opacity: 0.55 }} />
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2 px-1 pt-2 pb-0.5">
            <t.icon className="size-3.5 text-ink-soft" />
            <span className="text-sm">{t.name}</span>
            {pref === t.id && <span className="ml-auto size-1.5 rounded-full bg-oxblood" />}
          </div>
        </button>
      ))}
    </div>
  );
}
