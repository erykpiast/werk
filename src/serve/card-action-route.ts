/**
 * The routes of the card's two buttons: ✓ accepts the proposal on a card, ✕ removes it
 * (#al-diff-cli-btn, #vi-remove-btn). Each appends one event through the same rules as the
 * command line, so no view writes to a card and the page redraws from the log (#werk-write).
 * The handler has already checked the server token (#werk-serve-trust).
 */
import { appendEvents, readMap } from "../map/log-store.ts";
import { hasProposal } from "./card-look.ts";

export type CardAction = "accept" | "remove";

const CARD_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

function refuse(error: string, message: string, status: number): Response {
  return Response.json({ error, message }, { status });
}

export async function cardActionRoute(
  logPath: string,
  action: CardAction,
  req: Request,
): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return refuse("bad-request", "send a JSON body", 400);
  }
  const { card, reparent } = body ?? {};
  if (typeof card !== "string" || !CARD_ID.test(card)) {
    return refuse("bad-request", "send a card id", 400);
  }
  if (action === "accept") {
    // The card must still carry a proposal when the click arrives.
    const node = readMap(logPath).map.nodes.get(card);
    if (!node || !hasProposal(node)) {
      return refuse("no-proposal", `"${card}" has no pending proposal`, 409);
    }
  }
  const event =
    action === "accept"
      ? { type: "node.accepted", id: card, actor: "you" }
      : {
          type: "node.removed",
          id: card,
          ...(reparent === true ? { reparent: true } : {}),
        };
  const result = appendEvents(logPath, [event]);
  if (!result.ok) {
    const { rule, detail } = result.violation;
    return refuse(rule, detail, 409);
  }
  return Response.json({ ok: true });
}
