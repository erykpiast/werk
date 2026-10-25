/**
 * The two read-only addresses of the board: the whole board, and the summarised session log of one
 * ticket (#vi-board-read-api). The reads touch the board log, the ticket files, the session log and
 * the process table, so the pure parts live in the board folder.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { boardLogBeside, pidAlive, readBoard } from "../board/log-store.ts";
import { type LogLine, previewOf } from "../board/session-log.ts";
import { type BoardView, boardView } from "../board/view.ts";
import { readMap } from "../map/log-store.ts";

function readText(path: string): string | undefined {
  try {
    return existsSync(path) ? readFileSync(path, "utf8") : undefined;
  } catch {
    return undefined;
  }
}

/** The board of the project whose map log is at this path. */
export function readBoardView(
  logPath: string,
  isAlive: (pid: number) => boolean = pidAlive,
): BoardView {
  const board = readBoard(boardLogBeside(logPath));
  const { map } = readMap(logPath);
  return boardView({
    board,
    isAlive,
    obligations: map.obligations,
    textOf: (id) => {
      const [plan, number] = id.split("/") as [string, string];
      return readText(join(dirname(logPath), "tickets", plan, `${number}.md`));
    },
    cardOf: (id) => {
      const node = map.nodes.get(id);
      return node ? { title: node.title, proposed: node.proposed } : null;
    },
  });
}

export type LogRead =
  | { ok: true; lines: LogLine[] }
  | { ok: false; status: 400 | 404; message: string };

/**
 * The log lines of the latest build session of a ticket. A path that is not absolute is read from
 * the folder that holds the logs (#vi-board-session-file-path).
 */
export function readTicketLog(
  logPath: string,
  ticketId: string | null,
): LogRead {
  if (ticketId === null || ticketId === "")
    return { ok: false, status: 400, message: "name a ticket" };
  const ticket = readBoard(boardLogBeside(logPath)).tickets.get(ticketId);
  if (!ticket)
    return { ok: false, status: 404, message: `no ticket ${ticketId}` };
  const build = ticket.builds[ticket.builds.length - 1];
  if (ticket.column !== "building" || build === undefined)
    return { ok: true, lines: [] };
  const path = isAbsolute(build.log)
    ? build.log
    : join(dirname(logPath), build.log);
  return { ok: true, lines: previewOf(readText(path) ?? "") };
}
