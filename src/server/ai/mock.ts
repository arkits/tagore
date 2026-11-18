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
  const deltas: Part[] = [];
  for (let i = 0; i < json.length; i += 12) deltas.push({ type: "tool-input-delta", id, delta: json.slice(i, i + 12) });
  return [
    { type: "tool-input-start", id, toolName: name },
    ...deltas,
    { type: "tool-input-end", id },
    { type: "tool-call", toolCallId: id, toolName: name, input: json },
  ];
}

function promptText(prompt: any[]): { user: string; system: string; hasToolResults: boolean } {
  let user = "";
  let system = "";
  let hasToolResults = false;
  for (const m of prompt) {
    if (m.role === "tool") hasToolResults = true;
    if (m.role === "system") system += typeof m.content === "string" ? m.content : "";
    if (m.role === "user") for (const c of m.content) if (c.type === "text") user += c.text;
  }
  return { user, system, hasToolResults };
}

function chatLines(user: string, reply: boolean): string {
  const me = /Whose screen this is[^:]*: (.+)/.exec(user)?.[1]?.trim();
  const meName = me && !me.startsWith("unspecified") ? me : "Mara";
  const cast = /<characters>([\s\S]*?)<\/characters>/.exec(user)?.[1] ?? "";
  const them = [...cast.matchAll(/^### ([^\n(“]+)|^- (.+?)(?: — |$)/gm)]
    .map((m) => (m[1] ?? m[2] ?? "").trim())
    .find((name) => name && name !== meName && name !== "Others in the cast") ?? "Jonah";
  if (reply) return `{${them}} hey, i'm here`;
  return [
    `{${them}} you still up?`,
    `{${them}} i went back to the lighthouse`,
    `{${meName}} jonah. it's 2am`,
    `{${meName}} what do you mean went back`,
    `{${them}} the light was on`,
    `{${them}} mara the light was ON`,
    "## Tuesday 2:14 AM",
    `{${meName}} that's not possible. dad's been gone eleven years`,
    `{${them}} i know what i saw 🕯️`,
  ].join("\n");
}

export function createMockWriter() {
  return new MockLanguageModelV4({
    provider: "mock",
    modelId: "writer",
    doStream: async ({ prompt, tools }) => {
      if (!tools?.length) {
        // Plain generation (e.g. chapter summaries): stream a canned paragraph word by word.
        const words =
          "Mara climbs the lighthouse her father kept and finds it dark after eleven years. She counts the hundred and twelve worn stairs as he once did. By morning the lamp is burning again, though no one has been seen to light it.".split(" ");
        const parts: Part[] = [{ type: "stream-start", warnings: [] }, { type: "text-start", id: "t" }];
        words.forEach((w, i) => parts.push({ type: "text-delta", id: "t", delta: (i ? " " : "") + w }));
        parts.push({ type: "text-end", id: "t" }, { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage: usage(800, 60) });
        return {
          stream: new ReadableStream({
            async start(c) {
              for (const p of parts) {
                c.enqueue(p);
                await new Promise((r) => setTimeout(r, 30));
              }
              c.close();
            },
          }),
        };
      }
      const { user, system, hasToolResults } = promptText(prompt as any[]);
      const chat = (system + user).includes("CHAT story") || user.includes("Format: chat story");
      const reply = user.includes("<task>\nReply to the latest message");
      const polish = user.includes("<task>\nLine-edit for prose quality:");
      const parts: Part[] = [{ type: "stream-start", warnings: [] }];
      if (hasToolResults) {
        parts.push(
          { type: "text-start", id: "t" },
          { type: "text-delta", id: "t", delta: reply ? "The other participant replied." : polish ? "I suggested an edit to the opening beat." : chat ? "Jonah answered — and the light came back on." : "I tightened the opening line and carried the scene forward by two paragraphs." },
          { type: "text-end", id: "t" },
          { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage: usage(1200, 40) },
        );
      } else {
        const chapter = /<chapter[^>]*>([\s\S]*?)<\/chapter>/.exec(user)?.[1] ?? "";
        const blocks = [...chapter.matchAll(/^\[p:([^\]\r\n]+)\] (.*)$/gm)].map((m) => ({ id: m[1]!, text: m[2]! }));
        const withText = blocks.filter((b) => b.text.trim() && b.text !== "***");
        if (polish) {
          const first = withText[0];
          if (first) {
            const word = first.text.replace(/^\{[^}]+\}\s*/, "").split(/\s+/)[0]!.replace(/[*_]/g, "");
            parts.push(
              ...toolCall("c1", "read_blocks", { from_id: `[p:${first.id}]`, count: 1 }),
              ...toolCall("c2", "replace_text", { block_id: `p:${first.id}`, find: word, replace: `*${word}*`, reason: "Emphasis on the opening beat." }),
            );
          }
        } else if (chat) {
          parts.push(
            ...toolCall("c1", "insert_after", {
              after_id: reply ? "LAST" : withText.at(-1)?.id ?? blocks[0]?.id ?? "START",
              text: chatLines(user, reply),
              reason: "Continue the conversation.",
            }),
          );
        } else if (withText.length) {
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
              await new Promise((r) => setTimeout(r, p.type === "tool-input-delta" ? 25 : 15));
            }
            c.close();
          },
        }),
      };
    },
  });
}
