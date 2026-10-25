/** Reads what every pass of one ticket gets: the ticket, its stories and cards, its checks and the map index. */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { renderIndex, searchCards } from "../map/find-search.ts";
import type { FoldedMap } from "../map/fold.ts";
import { listOf, parseTicket } from "../tickets/ticket-parse.ts";
import { type BriefInput, type CardBrief, storyLines } from "./brief.ts";
import { checksOf } from "./checks.ts";

/** The part of the brief that stays the same on every pass. */
export type TicketInput = Pick<
  BriefInput,
  "ticket" | "stories" | "cards" | "checks" | "index"
>;

/** The folder of a plan's ticket files, beside the map log (#vi-board-state). */
export function ticketPath(
  mapLog: string,
  plan: string,
  number: string,
): string {
  return join(dirname(mapLog), "tickets", plan, `${number}.md`);
}

function cardBrief(map: FoldedMap, id: string): CardBrief | null {
  const node = map.nodes.get(id);
  if (node === undefined || node.kind !== "card" || node.proposed) return null;
  const rejected = map.edges
    .filter((edge) => edge.type === "alternative_to" && edge.to === id)
    .map((edge) => map.nodes.get(edge.from))
    .filter((option) => option !== undefined && !option.proposed)
    .map((option) => ({
      title: option?.title ?? "",
      whyNot: option?.why ?? "",
    }));
  return { id, title: node.title, why: node.why, body: node.body, rejected };
}

/** Null when the ticket file is missing or has no title line. */
export function gatherTicket(
  file: string,
  map: FoldedMap,
  spec: string | null,
): TicketInput | null {
  if (!existsSync(file)) return null;
  const text = readFileSync(file, "utf8");
  const ticket = parseTicket(file, text);
  if (ticket === null) return null;
  const cites = listOf(ticket.headers.cites?.value).map((id) =>
    id.startsWith("#") ? id.slice(1) : id,
  );
  return {
    ticket: text,
    stories: storyLines(spec, listOf(ticket.headers.stories?.value)),
    cards: cites
      .map((id) => cardBrief(map, id))
      .filter((card): card is CardBrief => card !== null),
    checks: checksOf(ticket),
    index: renderIndex(
      searchCards(map, { terms: [], status: null, under: null }),
    ),
  };
}
