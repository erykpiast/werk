// Held-out helper for the server steps: a temporary project with seeded cards, and `werk serve`
// processes that the test starts itself. `cleanup` kills every server and removes the folder.
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanEnv } from "../src/test/clean-env.ts";

export const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const FAKE_BIN = fileURLToPath(new URL("../src/test/fake-bin", import.meta.url));

export type Serve = {
  proc: ChildProcess;
  out(): string;
  err(): string;
  url: Promise<string>;
  exited: Promise<number | null>;
};

export function makeProject() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "werk-held-")));
  const dir = join(root, "project");
  mkdirSync(join(dir, ".werk"), { recursive: true });
  const log = join(dir, ".werk", "log.jsonl");
  writeFileSync(log, "");
  const env = cleanEnv(process.env, FAKE_BIN) as Record<string, string>;
  const procs = new Set<ChildProcess>();
  const lines = () => readFileSync(log, "utf8").split("\n").filter(Boolean);
  const seed = (type: string, payload: object) =>
    appendFileSync(log, `${JSON.stringify({ seq: lines().length + 1, at: "t", actor: "you", type, payload })}\n`);
  const card = (id: string, fields: Record<string, unknown> = {}) =>
    seed("node.added", { id, kind: "card", title: id, ...fields });
  const werk = (...args: string[]) => {
    const run = spawnSync("bun", [CLI, ...args], { cwd: dir, env, encoding: "utf8" });
    if (run.status !== 0) throw new Error(`werk ${args.join(" ")} exited ${run.status}: ${run.stderr}`);
    return run.stdout;
  };
  const serve = (port = 0): Serve => {
    const proc = spawn("bun", [CLI, "serve", "--port", String(port)], {
      cwd: dir,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    procs.add(proc);
    let out = "";
    let err = "";
    proc.stderr?.on("data", (c: Buffer) => {
      err += c.toString();
    });
    const exited = new Promise<number | null>((resolve) => proc.once("exit", (code) => resolve(code)));
    const url = new Promise<string>((resolve, reject) => {
      proc.stdout?.on("data", (c: Buffer) => {
        out += c.toString();
        const found = /http:\/\/\S+/.exec(out);
        if (found !== null) resolve(found[0].replace(/\/map$/, ""));
      });
      proc.once("exit", (code) => reject(new Error(`werk serve exited ${code}: ${err}`)));
    });
    url.catch(() => undefined);
    return { proc, out: () => out, err: () => err, url, exited };
  };
  const cleanup = async () => {
    await Promise.all(
      [...procs].map((p) => {
        if (p.exitCode !== null || p.signalCode !== null) return;
        const done = new Promise((r) => p.once("exit", r));
        p.kill("SIGKILL");
        return done;
      }),
    );
    rmSync(root, { recursive: true, force: true });
  };
  return { root, dir, log, env, lines, seed, card, werk, serve, cleanup };
}
