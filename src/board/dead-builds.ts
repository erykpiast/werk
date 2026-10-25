/**
 * Finds the builds whose process died: a start in the board log, no end, and the process gone
 * (#st-build-died, #vi-board-session-file). Pure: the caller supplies the process probe.
 */
import type { Alive, Board } from "./fold.ts";

export type DeadBuild = {
  ticket: string;
  /** The session that has no end. */
  session: string;
  /** The build the session belongs to: every pass of one run shares it. */
  buildId: string;
  /** The number of the pass that died. */
  pass: number;
};

/** A session id is <build id>:p<n>. Anything else is not a pass of a build. */
export function parseSession(
  session: string,
): { buildId: string; pass: number } | null {
  const found = /^(.+):p([1-9]\d*)$/.exec(session);
  return found === null
    ? null
    : { buildId: found[1] as string, pass: Number(found[2]) };
}

/** The dead build of each ticket in building. A build whose process is alive is left alone, whoever started it. */
export function deadBuilds(board: Board, isAlive: Alive): DeadBuild[] {
  const dead: DeadBuild[] = [];
  for (const ticket of board.tickets.values()) {
    if (ticket.column !== "building" || ticket.archived) continue;
    const last = ticket.builds[ticket.builds.length - 1];
    if (last === undefined || last.ended || isAlive(last.pid)) continue;
    const parsed = parseSession(last.session);
    if (parsed === null) continue;
    dead.push({ ticket: ticket.id, session: last.session, ...parsed });
  }
  return dead;
}

export type Restart =
  | { action: "restart"; pass: number }
  | { action: "stop"; reason: string };

/** The fresh pass counts against the retry cap: a death on the last allowed pass stops the build. */
export function restartOf(dead: DeadBuild, cap: number): Restart {
  const pass = dead.pass + 1;
  return pass <= cap
    ? { action: "restart", pass }
    : {
        action: "stop",
        reason: `died on pass ${dead.pass}, the last of the retry cap of ${cap}`,
      };
}

/** The last failure that the fresh pass reads. */
export const deathText = (dead: DeadBuild): string =>
  `Pass ${dead.pass} died: its build process was gone before it wrote an end. The work it did not commit is lost.`;
