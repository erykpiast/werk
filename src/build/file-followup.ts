/** Files the follow-up ticket of the small gaps: a ticket file, a planned event that waits for the source, and a link (#st-grade-defer). */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { appendBoardEvent, readBoard } from "../board/log-store.ts";
import {
  type FollowupSource,
  followupText,
  followupTitle,
  nextNumber,
} from "./followup-ticket.ts";
import { ticketPath } from "./gather.ts";
import type { GradeLine } from "./grade.ts";

/** The id of the follow-up ticket, or null when the plan has no free number or the board refuses it. */
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
  const files = existsSync(folder)
    ? readdirSync(folder).flatMap((name) => /^\d+/.exec(name)?.[0] ?? [])
    : [];
  const number = nextNumber([...held, ...files]);
  if (number === null) return null;
  const id = `${plan}/${number}`;
  mkdirSync(folder, { recursive: true });
  writeFileSync(ticketPath(mapLog, plan, number), followupText(source, gaps));
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
