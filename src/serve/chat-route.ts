/**
 * The chat routes of one project: a send, and the history a page replays when it joins. A send
 * changes state and starts an agent turn, so the handler has already checked the server token
 * (#werk-chat, #werk-serve-trust).
 */
import { join, resolve } from "node:path";
import { findImage } from "../chat/attachments.ts";
import { parsePick } from "../chat/model-pick.ts";
import { parseAnswer } from "../chat/permission.ts";
import { createSession } from "../chat/session.ts";
import { readMap } from "../map/log-store.ts";
import { selfCommandLine } from "../own/own.ts";
import type { Context } from "../projects/context.ts";
import { broadcastData } from "./live-channel.ts";

const REPO = join(import.meta.dirname, "..", "..");
const TURN_NAME = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;
const MAX_TEXT = 200_000;
const MAX_IMAGES = 50;

const MAIN = "main";

/**
 * A conversation of the project by name. It is made at the first use and kept on the context. An
 * event of a conversation other than the main one carries its name, so a page routes it to its tab.
 */
function sessionOf(
  context: Context,
  env: Record<string, string | undefined>,
  tab: string,
) {
  const have = context.chats.get(tab);
  if (have) return have;
  const named = tab === MAIN ? {} : { name: tab };
  const made = createSession({
    ...named,
    folder: context.folder,
    logPath: context.logPath,
    env,
    werk: selfCommandLine(),
    projectIsWerk: resolve(context.folder) === REPO,
    readMap: () => readMap(context.logPath).map,
    emit: (event) =>
      broadcastData(
        context.clients,
        event.name,
        tab === MAIN ? event.data : { ...event.data, tab },
      ),
  });
  context.chats.set(tab, made);
  return made;
}

/** The conversation a request names with its tab parameter. A request that names none is the main one. */
function tabOf(req: Request): string | Response {
  const tab = new URL(req.url).searchParams.get("tab") ?? MAIN;
  return TURN_NAME.test(tab) ? tab : refuse("the tab name is not valid");
}

/** The names of the conversations: the main one first, then the others in the order they opened. */
export function tabsRoute(context: Context): Response {
  const others = [...context.chats.keys()].filter((t) => t !== MAIN);
  return Response.json({ tabs: [MAIN, ...others] });
}

/** The command names that the project's chats keep: the first chat that has any wins. */
export function commandsRoute(context: Context): Response {
  const named = [...context.chats.values()]
    .map((chat) => chat.commands())
    .find((names) => names.length > 0);
  return Response.json({ commands: named ?? [] });
}

function refuse(message: string, status = 400): Response {
  return Response.json({ error: "bad-request", message }, { status });
}

/** A route that changes state answers only a POST, so a GET never reaches it by link or prefetch. */
function notPost(): Response {
  return Response.json(
    { error: "method", message: "use POST" },
    { status: 405, headers: { Allow: "POST" } },
  );
}

export async function chatRoute(
  context: Context,
  env: Record<string, string | undefined>,
  req: Request,
): Promise<Response> {
  const tab = tabOf(req);
  if (typeof tab !== "string") return tab;
  if (req.method === "GET") {
    // The session is built here, so a page that joins after a restart reads the saved model and fill.
    const session = sessionOf(context, env, tab);
    return Response.json({
      events: session.history(),
      settings: session.settings(),
    });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return refuse("send a JSON body");
  }
  const { text, card, turn, images } = (body ?? {}) as Record<string, unknown>;
  if (
    typeof text !== "string" ||
    text.trim() === "" ||
    text.length > MAX_TEXT
  ) {
    return refuse("send the text of the message");
  }
  if (typeof turn !== "string" || !TURN_NAME.test(turn)) {
    return refuse("send a turn name");
  }
  if (card !== null && card !== undefined && typeof card !== "string") {
    return refuse("the card must be an id or null");
  }
  const paths: string[] = [];
  if (images !== undefined) {
    if (!Array.isArray(images) || images.length > MAX_IMAGES) {
      return refuse("images must be a list of stored image names");
    }
    for (const name of images) {
      const path =
        typeof name === "string" ? findImage(context.logPath, name) : null;
      if (path === null) return refuse(`${String(name)} is not a stored image`);
      paths.push(path);
    }
  }
  const result = sessionOf(context, env, tab).send({
    turn,
    text,
    card: typeof card === "string" ? card : null,
    images: paths,
  });
  if (result === "duplicate") {
    return Response.json(
      { error: "duplicate", message: `the turn ${turn} is already open` },
      { status: 409 },
    );
  }
  return Response.json({ turn }, { status: 202 });
}

/** An answer to an open ask: the id of the control request and the person's choice (#werk-approve). */
export async function askRoute(
  context: Context,
  req: Request,
): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return refuse("send a JSON body");
  }
  const answer = parseAnswer(body);
  const id = (body as Record<string, unknown> | null)?.id;
  if (typeof id !== "string" || answer === null) {
    return refuse("send the id of the ask and a decision");
  }
  const tab = tabOf(req);
  if (typeof tab !== "string") return tab;
  const done = context.chats.get(tab)?.answer(id, answer) ?? {
    ok: false as const,
    reason: "no such open ask",
  };
  if (done.ok) return Response.json({ id }, { status: 200 });
  const status = done.reason === "no such open ask" ? 409 : 400;
  return Response.json(
    { error: status === 409 ? "closed" : "bad-request", message: done.reason },
    { status },
  );
}

/** A switch of the model: {model, advisor}, one of the three choices of the header (#werk-model-select). */
export async function modelRoute(
  context: Context,
  env: Record<string, string | undefined>,
  req: Request,
): Promise<Response> {
  if (req.method !== "POST") return notPost();
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return refuse("send a JSON body");
  }
  const pick = parsePick(body);
  if (pick === null) {
    return refuse("send a model and an advisor that the header offers");
  }
  const tab = tabOf(req);
  if (typeof tab !== "string") return tab;
  const done = await sessionOf(context, env, tab).setModel(pick);
  if (done.ok) return Response.json(pick, { status: 200 });
  return Response.json(
    { error: "busy", message: done.reason },
    { status: 409 },
  );
}

/** Clears the context: the session and the transcript go, the map stays (#werk-context-pie). */
export async function clearRoute(
  context: Context,
  env: Record<string, string | undefined>,
  req: Request,
): Promise<Response> {
  if (req.method !== "POST") return notPost();
  const tab = tabOf(req);
  if (typeof tab !== "string") return tab;
  const done = await sessionOf(context, env, tab).clear();
  if (done.ok) return Response.json({ cleared: true }, { status: 200 });
  return Response.json(
    { error: "busy", message: done.reason },
    { status: 409 },
  );
}
