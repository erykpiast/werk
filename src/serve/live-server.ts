/**
 * The listening server and the guard that keeps it across a hot reload. The guard sits on the
 * global object and holds the server, its token, its live connections and its children.
 * A new evaluation swaps in the new request handler and never listens twice (#werk-hmr, #werk-hmr-swap).
 */
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { serverLockPath } from "../projects/list-store.ts";
import {
  addProject,
  closeAll,
  createProjects,
  type Projects,
  setPort,
} from "../projects/projects.ts";
import { type DevClient, startDevClient } from "./client-dev.ts";
import { type ClientServer, noClient } from "./client-server.ts";
import { createHandler, type Handler } from "./handler.ts";
import {
  type RelayData,
  relayHandlers,
  upgradeHmr,
  wantsHmr,
} from "./hmr-relay.ts";
import { broadcast } from "./live-channel.ts";
import { type Lock, takeLock } from "./lock.ts";
import { createRoute } from "./routes.ts";
import { judgeRequest } from "./trust.ts";

const REPO = join(import.meta.dirname, "..", "..");
const VITE_CONFIG = join(REPO, "vite.config.ts");

type Live = {
  server: Bun.Server<RelayData>;
  token: string;
  handler: Handler;
  /** The projects of the server, each with its own context. */
  projects: Projects;
  client: ClientServer;
  /** Vite, in dev. */
  dev?: DevClient;
  /** Long-lived child processes. A hot reload never starts a second set. */
  children: Set<Bun.Subprocess>;
  lock: Lock;
  /** Settles with the exit code when the server stops. */
  done: Promise<number>;
};

const KEY = Symbol.for("werk.serve.live");
const globals = globalThis as { [KEY]?: Live };

const LISTEN_RETRIES = 20;
const LISTEN_RETRY_MS = 250;

export type ServeOptions = {
  /** The folder of the project this start was run in. It goes on the list. */
  folder: string;
  /** The per-user folder: the stored list and the lock of the one server. */
  home: string;
  env: Record<string, string | undefined>;
  port: number;
  out: (text: string) => void;
  err: (text: string) => void;
  /** Serve the client through Vite. Without it the server has the API and the live channel only. */
  dev?: boolean;
  /** A parent that started this server. The server stops when it dies. */
  parentPid?: number;
};

function handlerFor(
  live: Pick<Live, "token" | "projects" | "client">,
  env: ServeOptions["env"],
) {
  return createHandler(
    live.token,
    createRoute({
      token: live.token,
      projects: live.projects,
      client: live.client,
      env,
    }),
  );
}

async function listen(
  port: number,
  fetch: (
    req: Request,
    server: Bun.Server<RelayData>,
  ) => Promise<Response | undefined>,
): Promise<Bun.Server<RelayData>> {
  for (let attempt = 1; ; attempt++) {
    try {
      return Bun.serve<RelayData>({
        hostname: "127.0.0.1",
        port,
        idleTimeout: 0,
        fetch,
        websocket: relayHandlers,
      });
    } catch (error) {
      const busy = (error as NodeJS.ErrnoException).code === "EADDRINUSE";
      if (!busy || attempt >= LISTEN_RETRIES) throw error;
      await Bun.sleep(LISTEN_RETRY_MS);
    }
  }
}

/** Runs the server until it stops, and returns the exit code. */
export async function serve(options: ServeOptions): Promise<number> {
  const existing = globals[KEY];
  if (existing) {
    existing.handler = handlerFor(existing, options.env);
    options.err(
      `werk: hot reload: reusing the live server on port ${existing.server.port}`,
    );
    return existing.done;
  }

  const taken = await takeLock(serverLockPath(options.home), {
    onWait: (pid) =>
      options.err(
        `werk: waiting for ${pid === null ? "a lock" : `pid ${pid}`}`,
      ),
  });
  if (!taken.ok) {
    options.err(taken.message);
    return 1;
  }
  const { lock } = taken;

  const live = {
    token: randomBytes(32).toString("hex"),
    // In dev mode the entry of werk's own checkout is added at each start, and never stored.
    projects: createProjects(options.home, options.dev ? REPO : undefined),
    children: new Set(),
    lock,
  } as unknown as Live;
  try {
    // The start's own folder goes on the list and opens first, before the server accepts a connection
    // (#werk-write-watch-start). A project that another server holds ends the start.
    const added = await addProject(live.projects, options.folder, {
      waitMs: 5000,
      onWait: (pid) =>
        options.err(
          `werk: waiting for ${pid === null ? "a lock" : `pid ${pid}`}`,
        ),
    });
    if (!added.ok || added.locked !== undefined) {
      options.err(added.ok ? (added.locked as string) : added.message);
      closeAll(live.projects);
      lock.release();
      return 1;
    }
    if (options.dev) {
      live.dev = await startDevClient({
        configFile: VITE_CONFIG,
        onReload: () => reloadAll(live.projects),
      });
    }
    live.client = live.dev ?? noClient;
    live.handler = handlerFor(live, options.env);
    live.server = await listen(options.port, async (req, server) => {
      const { dev } = live;
      if (dev && wantsHmr(req)) {
        const trust = judgeRequest({
          method: req.method,
          host: req.headers.get("host"),
          token: null,
          expected: live.token,
        });
        if (!trust.ok) return new Response(trust.reason, { status: 403 });
        return upgradeHmr(req, server, dev.port);
      }
      return live.handler(req);
    });
  } catch (error) {
    closeAll(live.projects);
    await live.dev?.close();
    lock.release();
    throw error;
  }
  const port = live.server.port ?? 0;
  lock.setPort(port);
  setPort(live.projects, port);

  let stop!: (code: number) => void;
  live.done = new Promise<number>((resolve) => {
    stop = resolve;
  });
  const shutdown = () => {
    for (const child of live.children) child.kill();
    live.server.stop(true);
    closeAll(live.projects);
    void live.dev?.close();
    lock.release();
    delete globals[KEY];
    stop(0);
  };
  process.on("exit", () => {
    for (const context of live.projects.contexts.values()) {
      context.lock.release();
    }
    lock.release();
  });
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  if (options.parentPid !== undefined) {
    const parent = options.parentPid;
    setInterval(() => {
      try {
        process.kill(parent, 0);
      } catch {
        shutdown();
      }
    }, 500).unref();
  }

  globals[KEY] = live;
  options.out(
    `werk: serving on http://127.0.0.1:${live.server.port} (pid ${process.pid})`,
  );
  return live.done;
}

/** Tells every page of every project to reload. */
function reloadAll(projects: Projects): void {
  for (const context of projects.contexts.values()) {
    broadcast(context.clients, "reload");
  }
}
