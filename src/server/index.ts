import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { eq } from "drizzle-orm";
import path from "node:path";
import { appRouter } from "./router";
import { runAgent, type AgentEvent, type RunRequest } from "./ai/agent";
import { db, schema } from "./db";
import { embedCardInPng } from "./cards/png";
import { toCardV2 } from "../shared/character";
import { toWorldInfo } from "../shared/lorebook";

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
    const lb = /^\/api\/projects\/([\w-]+)\/lorebook\.json$/.exec(url.pathname);
    if (lb) return exportLorebook(lb[1]!);

    if (isProd) {
      const file = Bun.file(path.join(DIST, url.pathname));
      if (url.pathname !== "/" && (await file.exists())) return new Response(file);
      return new Response(Bun.file(path.join(DIST, "index.html")));
    }
    return new Response("Tagore API. In development, open the Vite dev server at http://localhost:5173", { status: 404 });
  },
});

console.log(`Tagore server on http://localhost:${server.port}${isProd ? "" : " (API only — UI at http://localhost:5173)"}`);
