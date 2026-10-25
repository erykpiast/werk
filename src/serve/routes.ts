/** The routes of the server. A hot reload swaps this table in without a restart (#werk-hmr-swap). */
import { readMap } from "../map/log-store.ts";
import type { ClientServer } from "./client-server.ts";
import type { Route } from "./handler.ts";
import { type Clients, live } from "./live-channel.ts";
import { cardRead, shapeRead } from "./read-api.ts";

export type RouteContext = {
  logPath: string;
  token: string;
  /** The open live-channel connections, kept across a hot reload. */
  clients: Clients;
  /** Serves the client's page and files. */
  client: ClientServer;
};

const CARD_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status });
}

export function createRoute(ctx: RouteContext): Route {
  return async (req) => {
    const url = new URL(req.url);
    if (req.method !== "GET") return json({ error: "not found" }, 404);
    if (url.pathname === "/") return ctx.client.page(ctx.token);
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
    if (!url.pathname.startsWith("/api/")) {
      const asset = await ctx.client.asset(req);
      if (asset) return asset;
    }
    return json({ error: "not found" }, 404);
  };
}
