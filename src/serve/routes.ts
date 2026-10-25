/**
 * The routes of the server. A hot reload swaps this table in without a restart (#werk-hmr-swap).
 * Every route that reads or follows a map names its project in the path (#werk-projects).
 */

import { readMap } from "../map/log-store.ts";
import {
  addProject,
  ensureContext,
  entries,
  findEntry,
  type Projects,
  removeProject,
} from "../projects/projects.ts";
import { cardActionRoute } from "./card-action-route.ts";
import { askRoute, chatRoute } from "./chat-route.ts";
import type { ClientServer } from "./client-server.ts";
import { chooseFolder } from "./folder-dialog.ts";
import type { Route } from "./handler.ts";
import { imageRoute } from "./image-route.ts";
import { live } from "./live-channel.ts";
import { renderOpenCard } from "./open-card.ts";
import { cardRead, headerRead, shapeRead } from "./read-api.ts";

export type RouteContext = {
  token: string;
  /** The projects of this server, kept across a hot reload. */
  projects: Projects;
  /** Serves the client's page and files. */
  client: ClientServer;
  /** The command that opens the folder dialog, and its environment. */
  env: Record<string, string | undefined>;
};

const CARD_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status });
}

/** A path segment that is not valid percent-encoding names no project. */
function decode(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

async function bodyOf(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const value = await req.json();
    return value !== null && typeof value === "object"
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

async function projectList(ctx: RouteContext): Promise<Response> {
  return json({ projects: entries(ctx.projects) });
}

async function addFromRequest(
  ctx: RouteContext,
  req: Request,
): Promise<Response> {
  const body = await bodyOf(req);
  if (typeof body?.folder !== "string" || body.folder === "") {
    return json({ error: "bad-request", message: "send a folder path" }, 400);
  }
  const added = await addProject(ctx.projects, body.folder, {
    init: body.init === true,
  });
  if (!added.ok) {
    return json({ error: added.error, message: added.message }, added.status);
  }
  return json({ name: added.name, folder: added.folder, locked: added.locked });
}

async function removeFromRequest(
  ctx: RouteContext,
  url: URL,
  name: string,
): Promise<Response> {
  const removed = await removeProject(ctx.projects, name, {
    confirm: url.searchParams.get("confirm") === "1",
  });
  if (removed.ok) return json({ removed: true });
  if (removed.error === "running") {
    return json({ error: "running", running: removed.running }, 409);
  }
  const message =
    removed.error === "dev"
      ? "werk's own checkout is on the list in dev mode and cannot be removed"
      : "no such project";
  return json({ error: removed.error, message }, removed.status);
}

/** The routes below one project: its live channel and its map. */
async function projectRoute(
  ctx: RouteContext,
  req: Request,
  name: string,
  rest: string,
): Promise<Response> {
  const entry = findEntry(ctx.projects, name);
  if (!entry) return json({ error: "unknown" }, 404);
  const opened = await ensureContext(ctx.projects, entry.folder);
  if (!opened.ok) {
    return json(
      { error: opened.error, message: opened.message },
      opened.status,
    );
  }
  const { context } = opened;
  const url = new URL(req.url);
  if (rest === "/live") return live(context);
  if (rest === "/chat") return chatRoute(context, ctx.env, req);
  if (rest === "/ask") return askRoute(context, req);
  if (rest === "/accept" || rest === "/remove") {
    return cardActionRoute(
      context.logPath,
      rest.slice(1) as "accept" | "remove",
      req,
    );
  }
  if (rest === "/image") return imageRoute(context, req, url);
  if (rest === "/graph") {
    if (url.searchParams.get("shape") !== "1") {
      return json({ error: "the graph is read with shape=1" }, 400);
    }
    return json(shapeRead(readMap(context.logPath).map));
  }
  if (rest === "/index") return json(headerRead(readMap(context.logPath).map));
  if (rest === "/open") {
    const wanted = url.searchParams.get("card");
    const { map } = readMap(context.logPath);
    return json(
      renderOpenCard(map, wanted === null ? undefined : wanted) ?? { id: null },
    );
  }
  const card = /^\/card\/([^/]*)$/.exec(rest);
  if (card) {
    const id = decode(card[1] as string);
    if (id === null || !CARD_ID.test(id))
      return json({ error: "bad card id" }, 400);
    const read = cardRead(readMap(context.logPath).map, id);
    return json(read ? { found: true, card: read } : { found: false });
  }
  return json({ error: "not found" }, 404);
}

export function createRoute(ctx: RouteContext): Route {
  return async (req) => {
    const url = new URL(req.url);
    const { pathname } = url;
    if (pathname === "/api/projects") {
      if (req.method === "GET") return projectList(ctx);
      if (req.method === "POST") return addFromRequest(ctx, req);
    }
    if (pathname === "/api/projects/dialog" && req.method === "POST") {
      return json(await chooseFolder(ctx.env));
    }
    const project = /^\/api\/projects\/([^/]*)(\/.*)?$/.exec(pathname);
    if (project) {
      const name = decode(project[1] as string);
      if (name === null) return json({ error: "unknown" }, 404);
      const rest = project[2] ?? "";
      if (rest === "" && req.method === "DELETE") {
        return removeFromRequest(ctx, url, name);
      }
      if (
        rest !== "" &&
        (req.method === "GET" ||
          (req.method === "POST" &&
            ["/chat", "/ask", "/image", "/accept", "/remove"].includes(rest)))
      ) {
        return projectRoute(ctx, req, name, rest);
      }
    }
    if (req.method !== "GET") return json({ error: "not found" }, 404);
    if (pathname === "/" || pathname.startsWith("/p/")) {
      return ctx.client.page(ctx.token);
    }
    if (!pathname.startsWith("/api/")) {
      const asset = await ctx.client.asset(req);
      if (asset) return asset;
    }
    return json({ error: "not found" }, 404);
  };
}
