/** The routes of the server. A hot reload swaps this table in without a restart (#werk-hmr-swap). */
import { readMap } from "../map/log-store.ts";
import type { Route } from "./handler.ts";
import { cardRead, shapeRead } from "./read-api.ts";

export type RouteContext = {
  logPath: string;
  token: string;
  /** The open live-channel connections, kept across a hot reload. */
  clients: Set<ReadableStreamDefaultController<Uint8Array>>;
};

const CARD_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const encoder = new TextEncoder();

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status });
}

function page(token: string): Response {
  return new Response(
    `<!doctype html><meta name="werk-token" content="${token}"><title>werk</title>`,
    { headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

function live(ctx: RouteContext): Response {
  let controller: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
      ctx.clients.add(c);
      c.enqueue(encoder.encode(": live\n\n"));
    },
    cancel() {
      ctx.clients.delete(controller);
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-store",
    },
  });
}

export function createRoute(ctx: RouteContext): Route {
  return (req) => {
    const url = new URL(req.url);
    if (req.method !== "GET") return json({ error: "not found" }, 404);
    if (url.pathname === "/") return page(ctx.token);
    if (url.pathname === "/api/live") return live(ctx);
    if (url.pathname === "/api/graph") {
      if (url.searchParams.get("shape") !== "1") {
        return json({ error: "the graph is read with shape=1" }, 400);
      }
      return json(shapeRead(readMap(ctx.logPath).map));
    }
    const card = /^\/api\/card\/([^/]*)$/.exec(url.pathname);
    if (card) {
      const id = decodeURIComponent(card[1] as string);
      if (!CARD_ID.test(id)) return json({ error: "bad card id" }, 400);
      const read = cardRead(readMap(ctx.logPath).map, id);
      return json(read ? { found: true, card: read } : { found: false });
    }
    return json({ error: "not found" }, 404);
  };
}
