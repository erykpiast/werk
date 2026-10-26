// Shared helpers of the g- binder: a clone of the checkout in a temp dir, and a shell with no
// `claude` program on PATH. Every edit and every make run happens in the clone, never the checkout.
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const CHECKOUT = realpathSync(join(import.meta.dir, ".."));

const roots: string[] = [];

/** The PATH of the person's shell with every folder that holds a `claude` program removed. */
export function personEnv(): Record<string, string> {
  const dirs = (process.env.PATH ?? "").split(":").filter((dir) => dir !== "" && !existsSync(join(dir, "claude")));
  return { ...(process.env as Record<string, string>), PATH: dirs.join(":") };
}

export type Out = { code: number; out: string; err: string; all: string };

export async function sh(cmd: string[], cwd: string, env: Record<string, string> = personEnv()): Promise<Out> {
  const proc = Bun.spawn(cmd, { cwd, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, out, err, all: `${out}\n${err}` };
}

/** A git clone of the checkout in a fresh temp dir. */
export async function cloneCheckout(): Promise<string> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "werk-g-")));
  roots.push(root);
  const dir = join(root, "werk");
  const run = await sh(["git", "clone", "-q", CHECKOUT, dir], root);
  if (run.code !== 0) throw new Error(`clone failed: ${run.err}`);
  return dir;
}

export async function install(dir: string): Promise<void> {
  const run = await sh(["bun", "install", "--frozen-lockfile"], dir);
  if (run.code !== 0) throw new Error(`install failed: ${run.all}`);
}

export const make = (dir: string, target: string) => sh(["make", target], dir);

export function removeClones(): void {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
}
