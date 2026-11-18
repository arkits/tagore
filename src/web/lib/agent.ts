import type { AgentEvent, RunRequest } from "@server/ai/agent";

export type { AgentEvent, RunRequest };

/** Run the agent and stream NDJSON events. Abort via the signal. */
export async function runAgent(req: RunRequest, onEvent: (e: AgentEvent) => void, signal: AbortSignal) {
  const res = await fetch("/api/agent/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`Agent request failed (${res.status})`);
  const reader = res.body.getReader();
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

/** Stream a chapter summary; resolves with the full text. */
export async function streamSummary(chapterId: string, onDelta: (d: string) => void, signal?: AbortSignal): Promise<string> {
  const res = await fetch(`/api/chapters/${chapterId}/summarize`, { method: "POST", signal });
  if (!res.ok || !res.body) throw new Error(`Summary request failed (${res.status})`);
  const reader = res.body.getReader();
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
