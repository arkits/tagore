import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

/**
 * Per-run trace files for debugging agent runs after the fact.
 *
 * Every agent run writes one NDJSON file to `data/logs/agent/<YYYY-MM-DD>/<runId>.ndjson` (override the
 * root with TAGORE_LOG_DIR) holding the request, the context sizes, each tool call's full input and
 * result, step finish reasons, usage, errors and how the run ended. A file without an `end` line means
 * the process died mid-run. A one-line summary of each event also goes to the console.
 *
 * Writes are synchronous and best-effort: logging must never break a run.
 */
const isTest = process.env.NODE_ENV === "test";
// Tests only write trace files when TAGORE_LOG_DIR points somewhere explicit.
const ROOT = process.env.TAGORE_LOG_DIR ?? (isTest ? null : path.resolve(import.meta.dir, "../../data/logs"));
const quiet = isTest || process.env.TAGORE_LOG_QUIET === "1";

/** Runs still in progress, so a shutdown (e.g. `bun --watch` restarting) is recorded in their traces. */
const open = new Map<string, RunLog>();
let hooked = false;
function hookShutdown() {
  if (hooked) return;
  hooked = true;
  for (const sig of ["SIGINT", "SIGTERM"] as const)
    process.once(sig, () => {
      for (const [, log] of open) log.write("end", { outcome: "killed", signal: sig });
      process.exit(sig === "SIGINT" ? 130 : 143);
    });
}

export type RunLog = {
  readonly file: string | null;
  write: (event: string, data?: Record<string, unknown>) => void;
  /** Write the final `end` line; later writes are ignored. */
  end: (data: Record<string, unknown>) => void;
};

const clip = (s: string, n = 120) => (s.length > n ? `${s.slice(0, n)}…` : s);

const FILE_ONLY = new Set(["system", "prompt", "stack", "responseBody", "trace"]);

/** One readable console line per event; the file keeps the full payload. */
function consoleLine(runId: string, event: string, data: Record<string, unknown>): string {
  const bits = Object.entries(data)
    .filter(([k, v]) => v !== undefined && !FILE_ONLY.has(k) && (typeof v !== "object" || v === null))
    .map(([k, v]) => `${k}=${clip(typeof v === "string" ? JSON.stringify(v) : String(v))}`);
  return `[agent ${runId}] ${event}${bits.length ? " " + bits.join(" ") : ""}`;
}

export function errorInfo(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    const extra = err as Error & { statusCode?: number; responseBody?: string; cause?: unknown };
    return {
      error: err.message,
      errorName: err.name,
      statusCode: extra.statusCode,
      responseBody: typeof extra.responseBody === "string" ? clip(extra.responseBody, 4000) : undefined,
      stack: err.stack,
    };
  }
  return { error: String(err) };
}

export function openRunLog(runId: string): RunLog {
  let file: string | null = null;
  if (ROOT)
    try {
      const dir = path.join(ROOT, "agent", new Date().toISOString().slice(0, 10));
      mkdirSync(dir, { recursive: true });
      file = path.join(dir, `${runId}.ndjson`);
    } catch (err) {
      if (!quiet) console.warn(`[agent ${runId}] run log disabled: ${(err as Error).message}`);
    }
  const t0 = performance.now();
  let ended = false;
  const log: RunLog = {
    get file() {
      return file;
    },
    end(data) {
      log.write("end", data);
      ended = true;
      open.delete(runId);
    },
    write(event, data = {}) {
      if (ended) return;
      const line = { ts: new Date().toISOString(), ms: Math.round(performance.now() - t0), event, ...data };
      if (file)
        try {
          appendFileSync(file, JSON.stringify(line) + "\n");
        } catch {
          file = null;
        }
      if (!quiet) {
        const msg = consoleLine(runId, event, data);
        if (event === "error" || event === "tool-error") console.error(msg);
        else console.log(msg);
      }
    },
  };
  open.set(runId, log);
  hookShutdown();
  return log;
}
