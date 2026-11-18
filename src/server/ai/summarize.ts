import { streamText } from "ai";
import { eq } from "drizzle-orm";
import { db, schema } from "../db";
import { blockPlain, docToBlocks } from "../../shared/doc";
import { getModel, getModelInfo, openRouterReasoningOptions, parseModelRef } from "./providers";
import { getSettings } from "../settings";

const MAX_CHARS = 120_000; // ~30k tokens of chapter text per summary call

/** Summarize a chapter, streaming the text through `onDelta` as it's written. Saves when done. */
export async function summarizeChapter(chapterId: string, signal?: AbortSignal, onDelta?: (d: string) => void): Promise<string> {
  const ch = db.select().from(schema.chapters).where(eq(schema.chapters.id, chapterId)).get();
  if (!ch) throw new Error("Chapter not found");
  const s = getSettings();
  let text = docToBlocks(ch.content).map(blockPlain).join("\n");
  if (!text.trim()) {
    db.update(schema.chapters).set({ summary: "", summaryHash: ch.contentHash }).where(eq(schema.chapters.id, chapterId)).run();
    return "";
  }
  if (text.length > MAX_CHARS) {
    // Keep beginning and end; the middle is where detail is least load-bearing for continuity.
    text = text.slice(0, MAX_CHARS * 0.4) + "\n[…]\n" + text.slice(-MAX_CHARS * 0.6);
  }
  const modelRef = s.summaryModel || s.model;
  const model = getModel(modelRef, s);
  const modelInfo = s.openRouterReasoning !== null && parseModelRef(modelRef).provider === "openrouter"
    ? await getModelInfo(modelRef)
    : undefined;
  const result = streamText({
    model,
    providerOptions: openRouterReasoningOptions(modelInfo, s.openRouterReasoning),
    temperature: 0.2,
    abortSignal: signal,
    instructions:
      "You maintain continuity notes for a novelist. Summarize the chapter so a co-writer who has NOT read it can continue the story without contradictions.",
    prompt: `Chapter: "${ch.title}"

${text}

Write 120–250 words of dense continuity notes:
- What happens, in order (plain past tense, no commentary).
- Where characters end up physically and emotionally; what they now know or want.
- New named people, places, objects, rules of the world.
- Open threads, promises, foreshadowing.
No preamble.`,
  });
  let summary = "";
  for await (const part of result.stream) {
    if (part.type === "text-delta") {
      summary += part.text;
      onDelta?.(part.text);
    } else if (part.type === "error") throw part.error instanceof Error ? part.error : new Error(String(part.error));
  }
  if (signal?.aborted) return summary.trim();
  db.update(schema.chapters)
    .set({ summary: summary.trim(), summaryHash: ch.contentHash })
    .where(eq(schema.chapters.id, chapterId))
    .run();
  return summary.trim();
}
