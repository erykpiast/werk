/**
 * The chat routes of one project: a send, and the history a page replays when it joins. A send
 * changes state and starts an agent turn, so the handler has already checked the server token
 * (#werk-chat, #werk-serve-trust).
 */
import { join, resolve } from "node:path";
import { findImage } from "../chat/attachments.ts";
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

/** The conversation of the project. It is made at the first use and kept on the context. */
function sessionOf(context: Context, env: Record<string, string | undefined>) {
  context.chat ??= createSession({
    folder: context.folder,
    logPath: context.logPath,
    env,
    werk: selfCommandLine(),
    projectIsWerk: resolve(context.folder) === REPO,
    readMap: () => readMap(context.logPath).map,
    emit: (event) => broadcastData(context.clients, event.name, event.data),
  });
  return context.chat;
}

function refuse(message: string, status = 400): Response {
  return Response.json({ error: "bad-request", message }, { status });
}

export async function chatRoute(
  context: Context,
  env: Record<string, string | undefined>,
  req: Request,
): Promise<Response> {
  if (req.method === "GET") {
    return Response.json({ events: context.chat?.history() ?? [] });
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
  const result = sessionOf(context, env).send({
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
  const done = context.chat?.answer(id, answer) ?? {
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
