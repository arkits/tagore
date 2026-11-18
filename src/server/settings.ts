import { eq } from "drizzle-orm";
import { db, schema } from "./db";

export type ProviderId = "openrouter" | "openai" | "anthropic" | "custom";

export type AppSettings = {
  providers: {
    openrouter: { apiKey: string };
    openai: { apiKey: string; baseURL: string };
    anthropic: { apiKey: string };
    /** Any OpenAI-compatible endpoint: Ollama, LM Studio, llama.cpp, vLLM, Together… */
    custom: { name: string; baseURL: string; apiKey: string };
  };
  /** "<provider>:<modelId>", e.g. "openrouter:anthropic/claude-sonnet-5.5" */
  model: string;
  /** Model used for chapter summaries; empty = same as `model`. */
  summaryModel: string;
  /** Max tokens of context assembled for the agent (not counting its output). */
  contextBudget: number;
  temperature: number;
};

export const DEFAULT_SETTINGS: AppSettings = {
  providers: {
    openrouter: { apiKey: "" },
    openai: { apiKey: "", baseURL: "" },
    anthropic: { apiKey: "" },
    custom: { name: "Local", baseURL: "http://localhost:11434/v1", apiKey: "" },
  },
  model: "openrouter:anthropic/claude-sonnet-5.5",
  summaryModel: "",
  contextBudget: 48000,
  temperature: 0.8,
};

const KEY = "app";

function merge<T>(base: T, over: any): T {
  if (!over || typeof over !== "object" || Array.isArray(base)) return (over ?? base) as T;
  const out: any = { ...base };
  for (const k of Object.keys(over)) {
    const b = (base as any)[k];
    out[k] = b && typeof b === "object" && !Array.isArray(b) ? merge(b, over[k]) : over[k];
  }
  return out;
}

export function getSettings(): AppSettings {
  const row = db.select().from(schema.settings).where(eq(schema.settings.key, KEY)).get();
  const s = merge(DEFAULT_SETTINGS, row?.value ?? {});
  // Environment variables act as fallbacks so a self-hoster can configure via .env
  s.providers.openrouter.apiKey ||= process.env.OPENROUTER_API_KEY ?? "";
  s.providers.openai.apiKey ||= process.env.OPENAI_API_KEY ?? "";
  s.providers.anthropic.apiKey ||= process.env.ANTHROPIC_API_KEY ?? "";
  return s;
}

export function saveSettings(patch: Partial<AppSettings>): AppSettings {
  const row = db.select().from(schema.settings).where(eq(schema.settings.key, KEY)).get();
  const next = merge(merge(DEFAULT_SETTINGS, row?.value ?? {}), patch);
  db.insert(schema.settings)
    .values({ key: KEY, value: next })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value: next } })
    .run();
  return getSettings();
}

/** Settings safe to send to the browser: keys are masked. */
export function publicSettings(s = getSettings()) {
  const mask = (k: string) => (k ? `••••${k.slice(-4)}` : "");
  return {
    ...s,
    providers: {
      openrouter: { apiKey: mask(s.providers.openrouter.apiKey) },
      openai: { ...s.providers.openai, apiKey: mask(s.providers.openai.apiKey) },
      anthropic: { apiKey: mask(s.providers.anthropic.apiKey) },
      custom: { ...s.providers.custom, apiKey: mask(s.providers.custom.apiKey) },
    },
  };
}
