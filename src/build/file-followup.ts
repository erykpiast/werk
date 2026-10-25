/** Files the follow-up ticket of the small gaps: a ticket file, a planned event that waits for the source, and a link (#st-grade-defer). */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { appendBoardEvent, readBoard } from "../board/log-store.ts";
import { ownChecks } from "../tickets/own-checks.ts";
import { ticketFileNumbers } from "../tickets/read-folder.ts";
import { parseTicket } from "../tickets/ticket-parse.ts";
import {
  type FollowupSource,
  followupText,
  followupTitle,
  nextNumber,
} from "./followup-ticket.ts";
import { ticketPath } from "./gather.ts";
import type { GradeLine } from "./grade.ts";

/** The id of the follow-up ticket, or null when the plan has no free number, the ticket fails its own checks, or the board refuses it. A follow-up is held to the same checks as any ticket (#st-ticket-partial). */
export function fileFollowup(
  mapLog: string,
  boardLog: string,
  source: FollowupSource,
  gaps: readonly GradeLine[],
): string | null {
  const [plan] = source.id.split("/") as [string];
  const board = readBoard(boardLog);
  const held = [...board.tickets.values()]
    .filter((ticket) => ticket.plan === plan)
    .map((ticket) => ticket.number);
  const folder = dirname(ticketPath(mapLog, plan, "01"));
  const files = ticketFileNumbers(folder);
  const number = nextNumber([...held, ...files]);
  if (number === null) return null;
  const id = `${plan}/${number}`;
  const text = followupText(source, gaps);
  const parsed = parseTicket(`${number}.md`, text);
  if (parsed === null || ownChecks(parsed).length > 0) return null;
  mkdirSync(folder, { recursive: true });
  writeFileSync(ticketPath(mapLog, plan, number), text);
  const planned = appendBoardEvent(boardLog, {
    type: "ticket.planned",
    id,
    title: followupTitle(source),
    blocked_by: [source.id],
  });
  if (!planned.ok) return null;
  appendBoardEvent(boardLog, {
    type: "ticket.followup",
    id: source.id,
    followup: id,
  });
  return id;
}
