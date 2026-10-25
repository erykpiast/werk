/**
 * The context of one project inside the server: its live connections, its log watch and its lock.
 * Work that belongs to the project, such as agent turns, hangs on the context, so a switch of the
 * page never touches it (#werk-projects, #werk-projects-background).
 */
import { dirname, join } from "node:path";
import { runCiteWatch } from "../board/cite-watch.ts";
import { boardLogBeside } from "../board/log-store.ts";
import type { ChatSession } from "../chat/session.ts";
import { pipelineLogBeside } from "../pipeline/log-store.ts";
import { broadcast, type Clients } from "../serve/live-channel.ts";
import { type Lock, takeLock } from "../serve/lock.ts";
import { type LogWatch, watchLog } from "../serve/log-watch.ts";

export type Context = {
  folder: string;
  logPath: string;
  /** The open live connections of pages that show this project. */
  clients: Clients;
  watch: LogWatch;
  /** The pipeline log. Its growth sends the measure signal (#werk-write-measure-signal). */
  measureWatch: LogWatch;
  /** The board log. Its growth sends the board signal (#vi-board-redraw-signal). */
  boardWatch: LogWatch;
  lock: Lock;
  /** The conversation of the project. It starts with the first message. */
  chat?: ChatSession;
  /** The names of the agent turns that run now. */
  runningTurns: () => string[];
  /** The count of background tasks of the agent. */
  background: () => number;
  /** The error of a dead agent, or null. */
  dead: () => string | null;
  /** Stops every running agent turn. */
  stopTurns: () => Promise<void>;
};

export type Opened =
  | { ok: true; context: Context }
  | { ok: false; message: string };

/** The log of a project: its map. A folder with no log has an empty map. */
export const logPathOf = (folder: string) => join(folder, ".werk", "log.jsonl");

/** The lock that gives one server to one project folder (#werk-onelock). */
export const projectLockPath = (folder: string) =>
  join(folder, ".werk", "serve.lock");

export type OpenOptions = {
  /** How long to wait for a live holder of the project lock. */
  waitMs?: number;
  onWait?: (pid: number | null) => void;
  /** Another log than the folder's own, from WERK_LOG. The lock sits beside it (#werk-onelock). */
  logPath?: string;
  /** The port of the server, recorded in the lock for a second server that is refused. */
  port?: number;
};

/** Marks the tickets whose cited cards changed. A failed read waits for the next change of the log (#st-ticket-watch). */
function watchCitedCards(logPath: string): void {
  try {
    runCiteWatch(logPath);
  } catch {
    // The watcher is a derived check. A log that cannot be read now is read at the next change.
  }
}

/** Takes the project's lock and starts watching its log. A refused lock gives the refusal message. */
export async function openContext(
  folder: string,
  options: OpenOptions = {},
): Promise<Opened> {
  const logPath = options.logPath ?? logPathOf(folder);
  const taken = await takeLock(
    options.logPath
      ? join(dirname(options.logPath), "serve.lock")
      : projectLockPath(folder),
    options,
  );
  if (!taken.ok) return { ok: false, message: taken.message };
  const { lock } = taken;
  if (options.port) lock.setPort(options.port);
  const clients: Clients = new Set();
  try {
    watchCitedCards(logPath);
    const watch = watchLog(logPath, () => {
      watchCitedCards(logPath);
      broadcast(clients, "changed");
    });
    let measureWatch: LogWatch;
    let boardWatch: LogWatch;
    try {
      measureWatch = watchLog(pipelineLogBeside(logPath), () =>
        broadcast(clients, "measure"),
      );
      try {
        boardWatch = watchLog(boardLogBeside(logPath), () =>
          broadcast(clients, "board"),
        );
      } catch (error) {
        measureWatch.close();
        throw error;
      }
    } catch (error) {
      watch.close();
      throw error;
    }
    const context: Context = {
      folder,
      logPath,
      clients,
      watch,
      measureWatch,
      boardWatch,
      lock,
      runningTurns: () => context.chat?.running() ?? [],
      background: () => context.chat?.background() ?? 0,
      dead: () => context.chat?.dead() ?? null,
      stopTurns: async () => context.chat?.stop(),
    };
    return { ok: true, context };
  } catch (error) {
    lock.release();
    throw error;
  }
}

/** Ends the page connections of the project, stops its watch and lets go of its lock. */
export function closeContext(context: Context): void {
  void context.chat?.stop();
  context.watch.close();
  context.measureWatch.close();
  context.boardWatch.close();
  for (const client of context.clients) {
    try {
      client.close();
    } catch {
      // The page is gone already.
    }
  }
  context.clients.clear();
  context.lock.release();
}
