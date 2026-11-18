import { generateText } from "ai";
import { eq } from "drizzle-orm";
import { db, schema } from "../db";
import { docToBlocks, plainText } from "../../shared/doc";
import { getModel } from "./providers";
import { getSettings } from "../settings";

const MAX_CHARS = 120_000; // ~30k tokens of chapter text per summary call

export async function summarizeChapter(chapterId: string, signal?: AbortSignal): Promise<string> {
  const ch = db.select().from(schema.chapters).where(eq(schema.chapters.id, chapterId)).get();
  if (!ch) throw new Error("Chapter not found");
  const s = getSettings();
  let text = docToBlocks(ch.content)
    .map((b) => (b.type === "scene_break" ? "* * *" : plainText(b.text)))
    .join("\n");
  if (!text.trim()) {
    db.update(schema.chapters).set({ summary: "", summaryHash: ch.contentHash }).where(eq(schema.chapters.id, chapterId)).run();
    return "";
  }
  if (text.length > MAX_CHARS) {
    // Keep beginning and end; the middle is where detail is least load-bearing for continuity.
    text = text.slice(0, MAX_CHARS * 0.4) + "\n[…]\n" + text.slice(-MAX_CHARS * 0.6);
  }
  const { text: summary } = await generateText({
    model: getModel(s.summaryModel || s.model, s),
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
  db.update(schema.chapters)
    .set({ summary: summary.trim(), summaryHash: ch.contentHash })
    .where(eq(schema.chapters.id, chapterId))
    .run();
  return summary.trim();
}
