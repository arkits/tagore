import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { asc, eq } from "drizzle-orm";
import path from "node:path";
import { appRouter } from "./router";
import { runAgent, type AgentEvent, type RunRequest } from "./ai/agent";
import { summarizeChapter } from "./ai/summarize";
import { db, schema } from "./db";
import { embedCardInPng } from "./cards/png";
import { toCardV2 } from "../shared/character";
import { toWorldInfo } from "../shared/lorebook";
import { docToBlocks } from "../shared/doc";

function exportLorebook(projectId: string): Response {
  const project = db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).get();
  if (!project) return new Response("Not found", { status: 404 });
  const entries = db.select().from(schema.loreEntries).where(eq(schema.loreEntries.projectId, projectId)).all();
  const name = `${project.title} lorebook`;
  const safe = name.replace(/[^\w\- ]+/g, "").trim() || "lorebook";
  return new Response(JSON.stringify(toWorldInfo(name, entries), null, 2), {
    headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="${safe}.json"` },
  });
}

function exportStory(projectId: string): Response {
  const project = db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).get();
  if (!project) return new Response("Not found", { status: 404 });
  const chapters = db.select({ title: schema.chapters.title, content: schema.chapters.content })
    .from(schema.chapters)
    .where(eq(schema.chapters.projectId, projectId))
    .orderBy(asc(schema.chapters.position))
    .all();
  const heading = (title: string) => title.replace(/\s+/g, " ").trim();
  const sections = [`# ${heading(project.title)}`];
  for (const chapter of chapters) {
    sections.push(`## ${heading(chapter.title)}`);
    for (const block of docToBlocks(chapter.content)) {
      if (block.type === "scene_break") sections.push("***");
      else if (block.type === "heading") sections.push(`${"#".repeat(Math.min((block.level ?? 2) + 2, 6))} ${block.text}`);
      else if (block.text.trim()) sections.push(block.speaker ? `${block.speaker}: ${block.text}` : block.text);
    }
  }
  const filename = project.title.replace(/[^\w -]+/g, "").trim() || "story";
  return new Response(sections.join("\n\n") + "\n", {
    headers: { "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}.md"` },
  });
}

const PORT = Number(process.env.TAGORE_PORT ?? (process.env.NODE_ENV === "production" ? process.env.PORT : undefined) ?? 3001);
const DIST = path.resolve(import.meta.dir, "../../dist");
const isProd = process.env.NODE_ENV === "production";

/** NDJSON stream of agent events. Client aborts by closing the request. */
function agentStream(req: Request): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (e: AgentEvent) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
        } catch {
          /* client went away */
        }
      };
      try {
        const body = (await req.json()) as RunRequest;
        await runAgent(body, emit, req.signal);
      } catch (err: any) {
        if (!req.signal.aborted) emit({ t: "error", message: err?.message ?? String(err) });
      } finally {
        try {
          controller.close();
        } catch {}
      }
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-cache", "X-Accel-Buffering": "no" },
  });
}

/** Stream a chapter summary as plain text chunks; a final "\u0000ERR:" line signals failure. */
function summaryStream(req: Request, chapterId: string): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        await summarizeChapter(chapterId, req.signal, (d) => {
          try {
            controller.enqueue(enc.encode(d));
          } catch {}
        });
      } catch (err: any) {
        if (!req.signal.aborted)
          try {
            controller.enqueue(enc.encode(`\u0000ERR:${err?.message ?? err}`));
          } catch {}
      } finally {
        try {
          controller.close();
        } catch {}
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache", "X-Accel-Buffering": "no" } });
}

function exportCharacter(id: string, format: string): Response {
  const row = db.select().from(schema.characters).where(eq(schema.characters.id, id)).get();
  if (!row) return new Response("Not found", { status: 404 });
  const card = toCardV2(row.card);
  const safe = row.name.replace(/[^\w\- ]+/g, "").trim() || "character";
  if (format === "png" && row.avatar?.startsWith("data:image/png")) {
    const png = Buffer.from(row.avatar.split(",")[1]!, "base64");
    return new Response(Buffer.from(embedCardInPng(new Uint8Array(png), card)), {
      headers: { "Content-Type": "image/png", "Content-Disposition": `attachment; filename="${safe}.png"` },
    });
  }
  return new Response(JSON.stringify(card, null, 2), {
    headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="${safe}.json"` },
  });
}

const server = Bun.serve({
  port: PORT,
  idleTimeout: 255, // long agent runs
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/api/trpc")) {
      return fetchRequestHandler({ endpoint: "/api/trpc", req, router: appRouter, createContext: () => ({}) });
    }
    if (url.pathname === "/api/agent/run" && req.method === "POST") return agentStream(req);
    const exp = /^\/api\/characters\/([\w-]+)\/export\.(png|json)$/.exec(url.pathname);
    if (exp) return exportCharacter(exp[1]!, exp[2]!);
    const sm = /^\/api\/chapters\/([\w-]+)\/summarize$/.exec(url.pathname);
    if (sm && req.method === "POST") return summaryStream(req, sm[1]!);
    const lb = /^\/api\/projects\/([\w-]+)\/lorebook\.json$/.exec(url.pathname);
    if (lb) return exportLorebook(lb[1]!);
    const story = /^\/api\/projects\/([\w-]+)\/export\.md$/.exec(url.pathname);
    if (story && req.method === "GET") return exportStory(story[1]!);

    if (isProd) {
      const file = Bun.file(path.join(DIST, url.pathname));
      if (url.pathname !== "/" && (await file.exists())) return new Response(file);
      return new Response(Bun.file(path.join(DIST, "index.html")));
    }
    return new Response("Tagore API. In development, open the Vite dev server at http://localhost:5173", { status: 404 });
  },
});

console.log(`Tagore server on http://localhost:${server.port}${isProd ? "" : " (API only — UI at http://localhost:5173)"}`);
