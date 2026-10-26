// Held-out helper: a temporary project with a seeded log, the werk command line, and werk serve starts.
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanEnv } from "../../src/test/clean-env.ts";

const CLI = fileURLToPath(new URL("../../src/cli.ts", import.meta.url));
const FAKE_BIN = fileURLToPath(new URL("../../src/test/fake-bin", import.meta.url));

export type Server = { proc: ChildProcess; url: Promise<string>; out(): string; err(): string; exit: Promise<number | null> };

const roots: string[] = [];
const procs = new Set<ChildProcess>();

export async function cleanup(): Promise<void> {
  await Promise.all(
    [...procs].map((p) => {
      if (p.exitCode !== null || p.signalCode !== null) return Promise.resolve();
      const done = new Promise((r) => p.once("exit", r));
      p.kill("SIGKILL");
      return done;
    }),
  );
  procs.clear();
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
}

export function makeProject() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "werk-heldout-")));
  roots.push(root);
  const dir = join(root, "project");
  mkdirSync(join(dir, ".werk"), { recursive: true });
  const log = join(dir, ".werk", "log.jsonl");
  writeFileSync(log, "");
  const env = cleanEnv(process.env, FAKE_BIN);
  const lines = () => readFileSync(log, "utf8").split("\n").filter(Boolean).length;
  const seed = (type: string, payload: object) =>
    appendFileSync(log, `${JSON.stringify({ seq: lines() + 1, at: "t", actor: "you", type, payload })}\n`);
  const card = (id: string, title: string, fields: Record<string, unknown> = {}) =>
    seed("node.added", { id, kind: "card", title, ...(id === "root" ? {} : { parent: "root" }), ...fields });
  const run = (...args: string[]) => {
    const r = spawnSync("bun", [CLI, ...args], { cwd: dir, env, encoding: "utf8" });
    return { code: r.status, out: r.stdout, err: r.stderr };
  };
  const werk = (...args: string[]) => {
    const r = run(...args);
    if (r.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${r.code}: ${r.err}`);
    return r.out;
  };
  const serve = (port = 0): Server => {
    const proc = spawn("bun", [CLI, "serve", "--port", String(port)], { cwd: dir, env, stdio: ["ignore", "pipe", "pipe"] });
    procs.add(proc);
    let out = "";
    let err = "";
    proc.stderr?.on("data", (c: Buffer) => (err += c.toString()));
    const exit = new Promise<number | null>((r) => proc.once("exit", (code) => r(code)));
    const url = new Promise<string>((resolve, reject) => {
      proc.stdout?.on("data", (c: Buffer) => {
        out += c.toString();
        const found = /http:\/\/\S+/.exec(out);
        if (found !== null) resolve(found[0].replace(/\/map$/, ""));
      });
      proc.once("exit", (code) => reject(new Error(`werk serve exited ${code}: ${err}`)));
    });
    url.catch(() => undefined);
    return { proc, url, out: () => out, err: () => err, exit };
  };
  return { root, dir, log, env, seed, card, run, werk, serve, logText: () => readFileSync(log, "utf8") };
}
