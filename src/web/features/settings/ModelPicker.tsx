import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown, RefreshCw } from "lucide-react";
import { queryClient, trpc } from "@/lib/trpc";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";

const PROVIDER_LABEL: Record<string, string> = {
  openrouter: "OpenRouter",
  openai: "OpenAI",
  anthropic: "Anthropic",
  custom: "Local / custom",
};

function fmtCtx(n?: number) {
  if (!n) return "";
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M` : `${Math.round(n / 1000)}k`;
}

/** Settings model picker. Value is "<provider>:<modelId>". */
export function ModelPicker({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (ref: string) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const models = useQuery({ ...trpc.settings.models.queryOptions(), staleTime: 10 * 60_000 });
  const pick = (ref: string) => {
    onChange(ref);
    setOpen(false);
  };

  const grouped = useMemo(() => {
    const g = new Map<string, NonNullable<typeof models.data>["models"]>();
    for (const m of models.data?.models ?? []) {
      if (m.modelId.endsWith(":batch")) continue;
      g.set(m.provider, [...(g.get(m.provider) ?? []), m]);
    }
    return g;
  }, [models.data]);

  const currentInfo = models.data?.models.find((m) => m.id === value);
  const label = currentInfo?.name ?? (value.split(":").slice(1).join(":") || value || "Choose model");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "inline-flex items-center gap-2 rounded-full border bg-popover/70 px-3 h-8 text-sm hover:bg-accent transition-colors max-w-[300px]",
            className,
          )}
        >
          <span className="size-1.5 rounded-full bg-sage shrink-0" />
          <span className="truncate">{label}</span>
          <ChevronsUpDown className="size-3.5 opacity-50 shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[440px] p-0" align="end">
        <Command
          filter={(v, s) => {
            const words = s.toLowerCase().split(/\s+/).filter(Boolean);
            return words.every((w) => v.toLowerCase().includes(w)) ? 1 : 0;
          }}
        >
          <div className="flex items-center border-b pr-2">
            <CommandInput placeholder="Search models… (e.g. claude, llama, gemini)" value={search} onValueChange={setSearch} className="flex-1" />
            <button
              title="Refresh model list"
              className="p-1.5 rounded hover:bg-accent text-muted-foreground"
              onClick={() => queryClient.fetchQuery(trpc.settings.models.queryOptions({ refresh: true })).then((d) => queryClient.setQueryData(trpc.settings.models.queryKey(), d))}
            >
              <RefreshCw className={cn("size-3.5", models.isFetching && "animate-spin")} />
            </button>
          </div>
          <CommandList className="max-h-[420px]">
            <CommandEmpty>
              {search.includes(":") ? (
                <button className="text-sm underline" onClick={() => pick(search)}>
                  Use “{search}”
                </button>
              ) : (
                <span className="text-sm text-muted-foreground">No models. Type provider:model-id to use any id.</span>
              )}
            </CommandEmpty>
            {[...grouped.entries()].map(([provider, list]) => (
              <CommandGroup key={provider} heading={PROVIDER_LABEL[provider] ?? provider}>
                {list.map((m) => (
                  <CommandItem key={m.id} value={`${m.name} ${m.id}`} onSelect={() => pick(m.id)} className="gap-2">
                    <Check className={cn("size-3.5", m.id === value ? "opacity-100" : "opacity-0")} />
                    <span className="truncate flex-1">{m.name}</span>
                    <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">
                      {fmtCtx(m.contextLength)}
                      {m.pricing && Number.isFinite(m.pricing.prompt) && m.pricing.prompt >= 0
                        ? ` · $${m.pricing.prompt.toFixed(2)}/$${m.pricing.completion.toFixed(2)}`
                        : ""}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
          {!!models.data?.errors.length && (
            <div className="border-t px-3 py-2 text-xs text-destructive">{models.data.errors.join(" · ")}</div>
          )}
        </Command>
      </PopoverContent>
    </Popover>
  );
}
