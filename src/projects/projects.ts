/**
 * The projects of one server: the stored list, werk's own checkout in dev mode, and one open context
 * for each project that can open. The state is a plain object that the server keeps across a hot
 * reload, and these functions work on it, so an edit to them is live after the reload
 * (#werk-projects-one-process, #werk-hmr-swap).
 */
import { existsSync, realpathSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  type Context,
  closeContext,
  type OpenOptions,
  openContext,
} from "./context.ts";
import {
  type Listed,
  listProjects,
  withFolder,
  withoutFolder,
} from "./list.ts";
import { readStored, writeStored } from "./list-store.ts";

export type Projects = {
  /** The per-user folder that holds the stored list. */
  home: string;
  /** Werk's own checkout, in dev mode only. It is never stored. */
  dev?: string;
  /** The port of this server, once it listens. */
  port?: number;
  /** The open contexts, by folder. A listed project opens on its first use. */
  contexts: Map<string, Context>;
  /** The refusal message of each folder whose lock another server holds. */
  refused: Map<string, string>;
};

export type Entry = Listed & {
  /** The folder is gone: it was moved or deleted. */
  missing: boolean;
  /** The folder is there, but another werk server holds the project. */
  locked: boolean;
  /** The agent turns that run in this project. */
  running: string[];
};

export function createProjects(home: string, dev?: string): Projects {
  return { home, dev, contexts: new Map(), refused: new Map() };
}

export const folderExists = (folder: string) => {
  try {
    return statSync(folder).isDirectory();
  } catch {
    return false;
  }
};

export function entries(projects: Projects): Entry[] {
  return listProjects(readStored(projects.home), projects.dev).map((listed) => {
    const missing = !folderExists(listed.folder);
    const context = projects.contexts.get(listed.folder);
    return {
      ...listed,
      missing,
      locked:
        !missing &&
        context === undefined &&
        projects.refused.has(listed.folder),
      running: context?.runningTurns() ?? [],
    };
  });
}

export function findEntry(projects: Projects, name: string) {
  return entries(projects).find((entry) => entry.name === name);
}

export type OpenResult =
  | { ok: true; context: Context }
  | { ok: false; status: 409; error: "missing" | "locked"; message: string };

/** The open context of a listed folder. It opens the context when there is none yet. */
export async function ensureContext(
  projects: Projects,
  folder: string,
  options: Pick<OpenOptions, "waitMs" | "onWait" | "logPath"> = {},
): Promise<OpenResult> {
  const have = projects.contexts.get(folder);
  if (!folderExists(folder)) {
    // The context of a folder that was moved or deleted watches a folder that is gone. A folder that
    // comes back at the same path gets a new context.
    if (have) {
      projects.contexts.delete(folder);
      closeContext(have);
    }
    return {
      ok: false,
      status: 409,
      error: "missing",
      message: `werk: the folder ${folder} is missing`,
    };
  }
  if (have) return { ok: true, context: have };
  const opened = await openContext(folder, {
    waitMs: 0,
    ...options,
    port: projects.port,
  });
  if (!opened.ok) {
    projects.refused.set(folder, opened.message);
    return { ok: false, status: 409, error: "locked", message: opened.message };
  }
  // A second open of the same folder in the same moment keeps the first context.
  const raced = projects.contexts.get(folder);
  if (raced) {
    closeContext(opened.context);
    return { ok: true, context: raced };
  }
  projects.contexts.set(folder, opened.context);
  projects.refused.delete(folder);
  return { ok: true, context: opened.context };
}

export type Added =
  | { ok: true; name: string; folder: string; locked?: string }
  | {
      ok: false;
      status: 400 | 409;
      error: "not-a-folder" | "git-required";
      message: string;
    };

const hasGit = (folder: string) => existsSync(join(folder, ".git"));

/**
 * Puts a folder on the stored list and opens its context. A folder with no map gets an empty map.
 * A folder with no git repository is refused, unless the caller says the person agreed to start one.
 * A lock that another server holds does not undo the add: the project is listed and shows as locked.
 */
export async function addProject(
  projects: Projects,
  folder: string,
  options: { init?: boolean } & Pick<
    OpenOptions,
    "waitMs" | "onWait" | "logPath"
  > = {},
): Promise<Added> {
  if (!folderExists(folder)) {
    return {
      ok: false,
      status: 400,
      error: "not-a-folder",
      message: `werk: ${folder} is not a folder`,
    };
  }
  const real = realpathSync(resolve(folder));
  if (!hasGit(real)) {
    if (!options.init) {
      return {
        ok: false,
        status: 409,
        error: "git-required",
        message: `werk: ${real} has no git repository. git is required: run "git init" there.`,
      };
    }
    const init = Bun.spawnSync(["git", "init", "-q"], { cwd: real });
    if (init.exitCode !== 0) {
      return {
        ok: false,
        status: 409,
        error: "git-required",
        message: `werk: git init failed in ${real}: ${init.stderr.toString().trim()}`,
      };
    }
  }
  // The dev checkout is listed by the mode, never by the stored list (#werk-projects-dev-self).
  if (real !== projects.dev) {
    writeStored(projects.home, withFolder(readStored(projects.home), real));
  }
  const opened = await ensureContext(projects, real, options);
  const entry = entries(projects).find((e) => e.folder === real);
  return {
    ok: true,
    folder: real,
    name: (entry as Entry).name,
    ...(opened.ok ? {} : { locked: opened.message }),
  };
}

export type Removed =
  | { ok: true }
  | { ok: false; status: 404; error: "unknown" }
  | { ok: false; status: 403; error: "dev" }
  | { ok: false; status: 409; error: "running"; running: string[] };

/**
 * Takes a project off the list. Its folder and its map stay as they are. A project with a running
 * agent turn is removed only with a confirmation, and the removal stops the turns (#werk-projects-list).
 */
export async function removeProject(
  projects: Projects,
  name: string,
  options: { confirm?: boolean } = {},
): Promise<Removed> {
  const entry = findEntry(projects, name);
  if (!entry) return { ok: false, status: 404, error: "unknown" };
  if (entry.dev) return { ok: false, status: 403, error: "dev" };
  const context = projects.contexts.get(entry.folder);
  const running = context?.runningTurns() ?? [];
  if (running.length > 0 && !options.confirm) {
    return { ok: false, status: 409, error: "running", running };
  }
  if (context) {
    await context.stopTurns();
    projects.contexts.delete(entry.folder);
    closeContext(context);
  }
  projects.refused.delete(entry.folder);
  writeStored(
    projects.home,
    withoutFolder(readStored(projects.home), entry.folder),
  );
  return { ok: true };
}

/** Records the server's port in every open context, once the server listens. */
export function setPort(projects: Projects, port: number): void {
  projects.port = port;
  for (const context of projects.contexts.values()) context.lock.setPort(port);
}

/** Closes every context: used when the server stops. */
export function closeAll(projects: Projects): void {
  for (const context of projects.contexts.values()) closeContext(context);
  projects.contexts.clear();
}
