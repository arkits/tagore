import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { getSettings, type AppSettings, type ProviderId } from "../settings";
import { createMockWriter } from "./mock";

const MOCK = !!process.env.TAGORE_MOCK;

export type ModelInfo = {
  /** "<provider>:<modelId>" */
  id: string;
  provider: ProviderId;
  modelId: string;
  name: string;
  contextLength?: number;
  /** USD per million tokens */
  pricing?: { prompt: number; completion: number };
};

export function parseModelRef(ref: string): { provider: ProviderId; modelId: string } {
  const i = ref.indexOf(":");
  if (i < 0) return { provider: "openrouter", modelId: ref };
  return { provider: ref.slice(0, i) as ProviderId, modelId: ref.slice(i + 1) };
}

export function getModel(ref: string, s: AppSettings = getSettings()) {
  const { provider, modelId } = parseModelRef(ref);
  if (MOCK && (provider as string) === "mock") return createMockWriter();
  switch (provider) {
    case "openrouter": {
      if (!s.providers.openrouter.apiKey) throw new Error("OpenRouter API key is not set (Settings → Providers).");
      return createOpenRouter({
        apiKey: s.providers.openrouter.apiKey,
        headers: { "X-Title": "Tagore" },
      })(modelId);
    }
    case "openai": {
      if (!s.providers.openai.apiKey) throw new Error("OpenAI API key is not set.");
      return createOpenAI({
        apiKey: s.providers.openai.apiKey,
        baseURL: s.providers.openai.baseURL || undefined,
      })(modelId);
    }
    case "anthropic": {
      if (!s.providers.anthropic.apiKey) throw new Error("Anthropic API key is not set.");
      return createAnthropic({ apiKey: s.providers.anthropic.apiKey })(modelId);
    }
    case "custom": {
      if (!s.providers.custom.baseURL) throw new Error("Custom endpoint base URL is not set.");
      return createOpenAICompatible({
        name: s.providers.custom.name || "custom",
        baseURL: s.providers.custom.baseURL,
        apiKey: s.providers.custom.apiKey || undefined,
      })(modelId);
    }
    default:
      throw new Error(`Unknown provider "${provider}"`);
  }
}

/* --------------------------------------------------------------- model lists */

let cache: { at: number; key: string; models: ModelInfo[] } | null = null;

async function fetchJson(url: string, headers: Record<string, string> = {}) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json() as Promise<any>;
}

export async function listModels(force = false): Promise<{ models: ModelInfo[]; errors: string[] }> {
  const s = getSettings();
  const key = JSON.stringify(s.providers);
  if (!force && cache && cache.key === key && Date.now() - cache.at < 10 * 60_000) return { models: cache.models, errors: [] };

  const errors: string[] = [];
  const jobs: Promise<ModelInfo[]>[] = [];

  // OpenRouter's catalogue is public; we list it even without a key so users can browse.
  jobs.push(
    fetchJson("https://openrouter.ai/api/v1/models").then((j) =>
      (j.data as any[])
        .filter((m) => (m.architecture?.output_modalities ?? ["text"]).includes("text"))
        .map((m) => ({
          id: `openrouter:${m.id}`,
          provider: "openrouter" as const,
          modelId: m.id,
          name: m.name ?? m.id,
          contextLength: m.context_length,
          pricing: m.pricing
            ? { prompt: Number(m.pricing.prompt) * 1e6, completion: Number(m.pricing.completion) * 1e6 }
            : undefined,
        })),
    ),
  );

  if (s.providers.openai.apiKey) {
    const base = s.providers.openai.baseURL || "https://api.openai.com/v1";
    jobs.push(
      fetchJson(`${base}/models`, { Authorization: `Bearer ${s.providers.openai.apiKey}` }).then((j) =>
        (j.data as any[])
          .filter((m) => /gpt|^o\d|chat/i.test(m.id))
          .map((m) => ({ id: `openai:${m.id}`, provider: "openai" as const, modelId: m.id, name: m.id })),
      ),
    );
  }

  if (s.providers.anthropic.apiKey) {
    jobs.push(
      fetchJson("https://api.anthropic.com/v1/models?limit=100", {
        "x-api-key": s.providers.anthropic.apiKey,
        "anthropic-version": "2023-06-01",
      }).then((j) =>
        (j.data as any[]).map((m) => ({
          id: `anthropic:${m.id}`,
          provider: "anthropic" as const,
          modelId: m.id,
          name: m.display_name ?? m.id,
        })),
      ),
    );
  }

  if (s.providers.custom.baseURL) {
    const h: Record<string, string> = s.providers.custom.apiKey ? { Authorization: `Bearer ${s.providers.custom.apiKey}` } : {};
    jobs.push(
      fetchJson(`${s.providers.custom.baseURL.replace(/\/$/, "")}/models`, h).then((j) =>
        ((j.data ?? j.models ?? []) as any[]).map((m) => {
          const id = m.id ?? m.name;
          return { id: `custom:${id}`, provider: "custom" as const, modelId: id, name: `${s.providers.custom.name}: ${id}` };
        }),
      ),
    );
  }

  if (MOCK) jobs.push(Promise.resolve([{ id: "mock:writer", provider: "custom" as const, modelId: "writer", name: "Mock writer (offline)", contextLength: 200_000 }]));

  const results = await Promise.allSettled(jobs);
  const models: ModelInfo[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") models.push(...r.value);
    else errors.push(String(r.reason?.message ?? r.reason));
  }
  cache = { at: Date.now(), key, models };
  return { models, errors };
}

export async function getContextLength(ref: string): Promise<number | undefined> {
  const { models } = await listModels().catch(() => ({ models: [] as ModelInfo[] }));
  return models.find((m) => m.id === ref)?.contextLength;
}
