/**
 * The listening server and the guard that keeps it across a hot reload. The guard sits on the
 * global object and holds the server, its token, its live connections and its children.
 * A new evaluation swaps in the new request handler and never listens twice (#werk-hmr, #werk-hmr-swap).
 */
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { type DevClient, startDevClient } from "./client-dev.ts";
import { type ClientServer, noClient } from "./client-server.ts";
import { createHandler, type Handler } from "./handler.ts";
import {
  type RelayData,
  relayHandlers,
  upgradeHmr,
  wantsHmr,
} from "./hmr-relay.ts";
import { broadcast, type Clients } from "./live-channel.ts";
import { type Lock, takeLock } from "./lock.ts";
import { type LogWatch, watchLog } from "./log-watch.ts";
import { createRoute } from "./routes.ts";
import { judgeRequest } from "./trust.ts";

const REPO = join(import.meta.dirname, "..", "..");
const VITE_CONFIG = join(REPO, "vite.config.ts");

type Live = {
  server: Bun.Server<RelayData>;
  token: string;
  handler: Handler;
  clients: Clients;
  client: ClientServer;
  /** Vite, in dev. */
  dev?: DevClient;
  watch: LogWatch;
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
  logPath: string;
  port: number;
  out: (text: string) => void;
  err: (text: string) => void;
  /** Serve the client through Vite. Without it the server has the API and the live channel only. */
  dev?: boolean;
  /** A parent that started this server. The server stops when it dies. */
  parentPid?: number;
};

export function lockPathFor(logPath: string): string {
  return join(dirname(logPath), "serve.lock");
}

function handlerFor(
  live: Pick<Live, "token" | "clients" | "client">,
  logPath: string,
) {
  return createHandler(
    live.token,
    createRoute({
      logPath,
      token: live.token,
      clients: live.clients,
      client: live.client,
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
    existing.handler = handlerFor(existing, options.logPath);
    options.err(
      `werk: hot reload: reusing the live server on port ${existing.server.port}`,
    );
    return existing.done;
  }

  const taken = await takeLock(lockPathFor(options.logPath), {
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
    clients: new Set(),
    children: new Set(),
    lock,
  } as unknown as Live;
  try {
    // The watch starts before the server accepts a connection (#werk-write-watch-start).
    live.watch = watchLog(options.logPath, () =>
      broadcast(live.clients, "changed"),
    );
    if (options.dev) {
      live.dev = await startDevClient({
        configFile: VITE_CONFIG,
        onReload: () => broadcast(live.clients, "reload"),
      });
    }
    live.client = live.dev ?? noClient;
    live.handler = handlerFor(live, options.logPath);
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
    live.watch?.close();
    await live.dev?.close();
    lock.release();
    throw error;
  }
  lock.setPort(live.server.port ?? 0);

  let stop!: (code: number) => void;
  live.done = new Promise<number>((resolve) => {
    stop = resolve;
  });
  const shutdown = () => {
    for (const child of live.children) child.kill();
    live.server.stop(true);
    live.watch.close();
    void live.dev?.close();
    lock.release();
    delete globals[KEY];
    stop(0);
  };
  process.on("exit", () => lock.release());
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
