/**
 * The server's watch for dead builds: a build is dead when the board log has its start, no end, and its
 * process is gone. The watch writes the end with died and starts a fresh pass from the branch's last
 * commit (#st-build-died, #vi-board-session-file). It runs when a project opens and when a build
 * process it started exits.
 */
import { type DeadBuild, deadBuilds, restartOf } from "../board/dead-builds.ts";
import {
  appendBoardEvent,
  boardLogBeside,
  pidAlive,
  readBoard,
} from "../board/log-store.ts";
import { NO_COST } from "../build/stream-cost.ts";
import { selfCommand } from "../own/own.ts";
import {
  appendPipelineEvent,
  pipelineLogBeside,
} from "../pipeline/log-store.ts";

/** The default retry cap of one build, as `werk build` has it. */
export const DEFAULT_CAP = 5;

export type DeadWatchOptions = {
  /** The map log of the project. */
  logPath: string;
  folder: string;
  cap?: number;
  isAlive?: (pid: number) => boolean;
  /** Starts the build process of a fresh pass, and calls `onExit` when that process exits. */
  start: (dead: DeadBuild, onExit: () => void) => void;
};

/** Handles every dead build once. Returns the tickets it restarted or stopped. */
export function sweepDeadBuilds(options: DeadWatchOptions): string[] {
  const boardLog = boardLogBeside(options.logPath);
  const cap = options.cap ?? DEFAULT_CAP;
  const handled: string[] = [];
  const dead = deadBuilds(readBoard(boardLog), options.isAlive ?? pidAlive);
  for (const build of dead) {
    appendBoardEvent(boardLog, {
      type: "build.ended",
      id: build.ticket,
      session: build.session,
      result: "died",
    });
    appendBoardEvent(boardLog, {
      type: "ticket.pass",
      id: build.ticket,
      n: build.pass,
      result: "red",
    });
    appendPipelineEvent(pipelineLogBeside(options.logPath), {
      type: "step.ended",
      id: `${build.buildId}:p${build.pass}:pass`,
      build: build.buildId,
      ticket: build.ticket,
      pass: build.pass,
      step: "pass",
      at: new Date().toISOString(),
      result: "red",
      ms: 0,
      cost: NO_COST,
      reason: "died",
    });
    const next = restartOf(build, cap);
    if (next.action === "stop") {
      appendBoardEvent(boardLog, {
        type: "ticket.moved",
        id: build.ticket,
        to: "ready",
        actor: "loop",
        reason: next.reason,
      });
    } else {
      options.start(build, () => sweepDeadBuilds(options));
    }
    handled.push(build.ticket);
  }
  return handled;
}

/** Starts `werk build` for the fresh pass, with the project's map log, and sweeps again when it exits. */
export function spawnFreshPass(
  folder: string,
  logPath: string,
  env: Record<string, string | undefined> = process.env,
): DeadWatchOptions["start"] {
  return (dead, onExit) => {
    const child = Bun.spawn(
      [...selfCommand(), "build", dead.ticket, "--after-death", dead.session],
      {
        cwd: folder,
        env: { ...env, WERK_LOG: logPath } as Record<string, string>,
        stdin: "ignore",
        stdout: "ignore",
        stderr: "ignore",
      },
    );
    void child.exited.then(onExit);
  };
}
