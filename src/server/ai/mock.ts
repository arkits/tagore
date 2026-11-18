/**
 * A scripted language model for tests and offline UI development (enable with TAGORE_MOCK=1,
 * then pick the model id "mock:writer"). It reads the block ids from the prompt and makes a
 * small, deterministic set of edit-tool calls, so the whole suggestion pipeline can be
 * exercised without an API key.
 */
import { MockLanguageModelV4 } from "ai/test";

type Part = any;

function usage(inT: number, outT: number) {
  return {
    inputTokens: { total: inT, noCache: inT, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: outT, text: outT, reasoning: 0 },
  };
}

function toolCall(id: string, name: string, input: object): Part[] {
  const json = JSON.stringify(input);
  const half = Math.floor(json.length / 2);
  return [
    { type: "tool-input-start", id, toolName: name },
    { type: "tool-input-delta", id, delta: json.slice(0, half) },
    { type: "tool-input-delta", id, delta: json.slice(half) },
    { type: "tool-input-end", id },
    { type: "tool-call", toolCallId: id, toolName: name, input: json },
  ];
}

function promptText(prompt: any[]): { user: string; hasToolResults: boolean } {
  let user = "";
  let hasToolResults = false;
  for (const m of prompt) {
    if (m.role === "tool") hasToolResults = true;
    if (m.role === "user") for (const c of m.content) if (c.type === "text") user += c.text;
  }
  return { user, hasToolResults };
}

export function createMockWriter() {
  return new MockLanguageModelV4({
    provider: "mock",
    modelId: "writer",
    doStream: async ({ prompt }) => {
      const { user, hasToolResults } = promptText(prompt as any[]);
      const parts: Part[] = [{ type: "stream-start", warnings: [] }];
      if (hasToolResults) {
        parts.push(
          { type: "text-start", id: "t" },
          { type: "text-delta", id: "t", delta: "I tightened the opening line and carried the scene forward by two paragraphs." },
          { type: "text-end", id: "t" },
          { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage: usage(1200, 40) },
        );
      } else {
        const chapter = /<chapter[^>]*>([\s\S]*?)<\/chapter>/.exec(user)?.[1] ?? "";
        const blocks = [...chapter.matchAll(/^\[p:([a-z0-9]+)\] (.*)$/gm)].map((m) => ({ id: m[1]!, text: m[2]! }));
        const withText = blocks.filter((b) => b.text.trim() && b.text !== "***");
        if (withText.length) {
          const first = withText[0]!;
          const word = first.text.replace(/^\{\w+\}\s*/, "").split(/\s+/)[0]!.replace(/[*_]/g, "");
          parts.push(...toolCall("c1", "replace_text", { block_id: first.id, find: word, replace: `*${word}*`, reason: "Emphasis on the opening beat." }));
          parts.push(
            ...toolCall("c2", "insert_after", {
              after_id: withText.at(-1)!.id,
              text: "The lamp guttered, and for a moment the room belonged to the dark.\nShe did not move. Somewhere below, a door that had been locked for eleven years swung open.",
              reason: "Continue the scene.",
            }),
          );
          parts.push(...toolCall("c3", "rewrite_block", { block_id: "nonexistent", text: "x" }));
        } else {
          parts.push(
            ...toolCall("c1", "insert_after", {
              after_id: blocks[0]?.id ?? "START",
              text: "The lighthouse had been dark for eleven years when Mara climbed its stairs.\nShe counted them, as her father had: one hundred and twelve, each worn to a shallow bowl.\n***\nBy morning the light was burning.",
              reason: "First draft from notes.",
            }),
          );
        }
        parts.push({ type: "finish", finishReason: { unified: "tool-calls", raw: "tool_calls" }, usage: usage(3000, 200) });
      }
      return {
        stream: new ReadableStream({
          async start(c) {
            for (const p of parts) {
              c.enqueue(p);
              await new Promise((r) => setTimeout(r, 15));
            }
            c.close();
          },
        }),
      };
    },
  });
}
