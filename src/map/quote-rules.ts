/**
 * The map rules for an excerpt: only a quote makes one, and its words never change.
 * See #werk-excerpt-event, #werk-excerpt-event-shape and #werk-excerpt-event-status.
 */
import type { Edge, FoldedMap, Pointer, Violation } from "./fold.ts";
import { isConversationName } from "./quote-match.ts";
import { isOut, outRefusal } from "./removal-rules.ts";

const bad = (detail: string): Violation => ({ rule: "bad-event", detail });

/** The refusal for a plain add of an excerpt: it has no transcript match behind it. */
export const EXCERPT_ADD_REFUSAL: Violation = {
  rule: "excerpt",
  detail:
    "an excerpt is made only by a quote from a conversation, not by an add",
};

export function excerptFrozenDetail(id: string): string {
  return `"${id}" is an excerpt and its words never change`;
}

function text(fields: Record<string, unknown>, key: string): string | null {
  const value = fields[key];
  return typeof value === "string" && value !== "" ? value : null;
}

function offset(fields: Record<string, unknown>, key: string): number | null {
  const value = fields[key];
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : null;
}

/** Stages the excerpt of a quote as a ghost, with the supported_by link from the citing card held. */
export function applyQuoted(
  map: FoldedMap,
  fields: Record<string, unknown>,
  addEdge: (map: FoldedMap, edge: Edge) => void,
): Violation | null {
  const id = text(fields, "id");
  const title = text(fields, "title");
  const card = text(fields, "card");
  const conversation = text(fields, "conversation");
  const session = text(fields, "session");
  const speaker = text(fields, "speaker");
  const at = text(fields, "said_at");
  const message = offset(fields, "message");
  const start = offset(fields, "start");
  const end = offset(fields, "end");
  const named: [string, unknown][] = [
    ["id", id],
    ["title", title],
    ["card", card],
    ["conversation", conversation],
    ["session", session],
    ["speaker", speaker],
    ["said_at", at],
  ];
  for (const [key, value] of named) {
    if (value === null) return bad(`"${key}" must be text`);
  }
  for (const [key, value] of [
    ["message", message],
    ["start", start],
    ["end", end],
  ] as const) {
    if (value === null) return bad(`"${key}" must be a whole number`);
  }
  const pointer: Pointer = {
    conversation: conversation as string,
    session: session as string,
    message: message as number,
    start: start as number,
    end: end as number,
    speaker: speaker as string,
    at: at as string,
  };
  if (!isConversationName(pointer.conversation)) {
    return bad(`"${pointer.conversation}" is not a conversation name`);
  }
  if (pointer.end <= pointer.start) return bad('"end" must be after "start"');
  const excerpt = id as string;
  const citing = card as string;
  if (map.nodes.has(excerpt) || isOut(map, excerpt)) {
    return { rule: "duplicate-id", detail: `the id "${excerpt}" is taken` };
  }
  if (!map.nodes.has(citing)) {
    return (
      outRefusal(map, citing) ?? {
        rule: "unknown-card",
        detail: `no card "${citing}"`,
      }
    );
  }
  map.nodes.set(excerpt, {
    id: excerpt,
    kind: "excerpt",
    title: title as string,
    why: "",
    body: "",
    status: "decided",
    who: null,
    proposed: true,
    marks: [],
    noBasis: null,
    unchallenged: null,
    kill: [],
    pending: null,
    pointer,
  });
  map.threads.set(excerpt, []);
  addEdge(map, { from: citing, to: excerpt, type: "supported_by", why: "" });
  return null;
}
