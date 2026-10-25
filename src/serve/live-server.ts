/**
 * The listening server and the guard that keeps it across a hot reload. The guard sits on the
 * global object and holds the server, its token, its live connections and its children.
 * A new evaluation swaps in the new request handler and never listens twice (#werk-hmr, #werk-hmr-swap).
 */
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { createHandler, type Handler } from "./handler.ts";
import { type Lock, takeLock } from "./lock.ts";
import { createRoute, type RouteContext } from "./routes.ts";

type Live = {
  server: Bun.Server<undefined>;
  token: string;
  handler: Handler;
  clients: RouteContext["clients"];
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
  /** A parent that started this server. The server stops when it dies. */
  parentPid?: number;
};

export function lockPathFor(logPath: string): string {
  return join(dirname(logPath), "serve.lock");
}

function handlerFor(live: Pick<Live, "token" | "clients">, logPath: string) {
  return createHandler(
    live.token,
    createRoute({ logPath, token: live.token, clients: live.clients }),
  );
}

async function listen(
  port: number,
  fetch: (req: Request) => Promise<Response>,
): Promise<Bun.Server<undefined>> {
  for (let attempt = 1; ; attempt++) {
    try {
      return Bun.serve({ hostname: "127.0.0.1", port, idleTimeout: 0, fetch });
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
  live.handler = handlerFor(live, options.logPath);
  try {
    live.server = await listen(options.port, (req) => live.handler(req));
  } catch (error) {
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
