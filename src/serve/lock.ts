/** The lock that gives one werk server to one log directory (#werk-onelock, #werk-onelock-take). */
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

export type Holder = { pid: number; port: number };

export type LockOptions = {
  pid?: number;
  /** How long a start waits for a live holder to let go. */
  waitMs?: number;
  pollMs?: number;
  isAlive?: (pid: number) => boolean;
  /** Called once, when the start begins to wait for a live holder. */
  onWait?: (pid: number | null) => void;
};

export type Lock = {
  /** Records the port once the server listens. */
  setPort: (port: number) => void;
  /** Removes the lock when it still names this server. */
  release: () => void;
};

export type Taken =
  | { ok: true; lock: Lock }
  | { ok: false; holder: Holder; message: string };

export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function parseHolder(text: string): Holder | null {
  try {
    const value = JSON.parse(text) as Partial<Holder> | null;
    return typeof value?.pid === "number" && typeof value.port === "number"
      ? { pid: value.pid, port: value.port }
      : null;
  } catch {
    return null;
  }
}

function readHolder(path: string): Holder | null | "gone" {
  try {
    return parseHolder(readFileSync(path, "utf8"));
  } catch {
    return "gone";
  }
}

export function refusal(holder: Holder): string {
  return [
    `werk: another werk is already serving this repository on port ${holder.port} (pid ${holder.pid}).`,
    "werk: stop it first, or run in a different directory. One server per .werk.",
  ].join("\n");
}

/** Creates the lock file in one step that fails when it exists. */
function create(path: string): boolean {
  try {
    closeSync(openSync(path, "wx"));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
}

export async function takeLock(
  path: string,
  options: LockOptions = {},
): Promise<Taken> {
  const pid = options.pid ?? process.pid;
  const { waitMs = 5000, pollMs = 100, isAlive = pidAlive } = options;
  mkdirSync(dirname(path), { recursive: true });
  const deadline = Date.now() + waitMs;
  let waited = false;
  for (;;) {
    if (create(path)) {
      writeFileSync(path, JSON.stringify({ pid, port: 0 }));
      return {
        ok: true,
        lock: {
          setPort: (port) => writeFileSync(path, JSON.stringify({ pid, port })),
          release: () => {
            if (holderPid(path) === pid) rmSync(path, { force: true });
          },
        },
      };
    }
    const holder = readHolder(path);
    if (holder === "gone") continue;
    if (holder && !isAlive(holder.pid)) {
      rmSync(path, { force: true });
      continue;
    }
    if (Date.now() >= deadline) {
      if (holder) return { ok: false, holder, message: refusal(holder) };
      rmSync(path, { force: true });
      continue;
    }
    if (!waited) {
      waited = true;
      options.onWait?.(holder ? holder.pid : null);
    }
    await Bun.sleep(pollMs);
  }
}

function holderPid(path: string): number | null {
  const holder = readHolder(path);
  return holder === "gone" || holder === null ? null : holder.pid;
}
