import type { AgentEvent, RunRequest } from "@server/ai/agent";

export type { AgentEvent, RunRequest };

async function readNdjson(res: Response, onEvent: (e: AgentEvent) => void) {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) onEvent(JSON.parse(line));
    }
  }
}

/**
 * Start an agent run on the server and follow its NDJSON events. The run belongs to the server:
 * aborting `signal` only stops listening. Use `stopAgent` to cancel the run itself.
 */
export async function runAgent(req: RunRequest, onEvent: (e: AgentEvent) => void, signal: AbortSignal) {
  const res = await fetch("/api/agent/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
    signal,
  });
  if (!res.ok || !res.body) throw new Error((res.status === 409 && (await res.text())) || `Agent request failed (${res.status})`);
  await readNdjson(res, onEvent);
}

/** Follow the chapter's running agent job from the start (replayed). Resolves false if none is running. */
export async function attachAgent(chapterId: string, onEvent: (e: AgentEvent) => void, signal: AbortSignal): Promise<boolean> {
  const res = await fetch(`/api/agent/chapters/${chapterId}/stream`, { signal });
  if (res.status === 204) return false;
  if (!res.ok || !res.body) throw new Error(`Couldn't reconnect to the agent (${res.status})`);
  await readNdjson(res, onEvent);
  return true;
}

/** Cancel the chapter's running agent job. Resolves false if nothing was running. */
export async function stopAgent(chapterId: string): Promise<boolean> {
  const res = await fetch(`/api/agent/chapters/${chapterId}/stop`, { method: "POST" });
  return res.ok && ((await res.json()) as { stopped: boolean }).stopped;
}

async function readSummary(res: Response, onDelta: (d: string) => void): Promise<string> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let all = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    const chunk = dec.decode(value, { stream: true });
    const err = chunk.indexOf("\u0000ERR:");
    if (err >= 0) throw new Error(chunk.slice(err + 5));
    all += chunk;
    onDelta(chunk);
  }
  return all;
}

/** Summarize a chapter (or join the summary already being written); resolves with the full text. */
export async function streamSummary(chapterId: string, onDelta: (d: string) => void, signal?: AbortSignal): Promise<string> {
  const res = await fetch(`/api/chapters/${chapterId}/summarize`, { method: "POST", signal });
  if (!res.ok || !res.body) throw new Error(`Summary request failed (${res.status})`);
  return readSummary(res, onDelta);
}

/** Follow a summary that is already being written, from its first word. Resolves null if none is. */
export async function attachSummary(chapterId: string, onDelta: (d: string) => void, signal?: AbortSignal): Promise<string | null> {
  const res = await fetch(`/api/chapters/${chapterId}/summarize`, { signal });
  if (res.status === 204) return null;
  if (!res.ok || !res.body) throw new Error(`Summary request failed (${res.status})`);
  return readSummary(res, onDelta);
}
