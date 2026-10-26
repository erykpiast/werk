import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanEnv } from "../src/test/clean-env.ts";

export const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const FAKE_BIN = fileURLToPath(new URL("../src/test/fake-bin", import.meta.url));
export const env = () => cleanEnv(process.env, FAKE_BIN);

export type Srv = { proc: ChildProcess; err: () => string; url: Promise<string>; exited: Promise<number | null> };

const roots: string[] = [];
const procs: ChildProcess[] = [];

/** A project whose map holds the given cards under a root titled "Root". */
export function makeProject(cards: { id: string; title: string }[] = []): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "werk-held-")));
  roots.push(root);
  const dir = join(root, "project");
  mkdirSync(join(dir, ".werk"), { recursive: true });
  const all = [{ id: "root", title: "Root" }, ...cards];
  const lines = all.map((c, i) =>
    JSON.stringify({
      seq: i + 1,
      at: "t",
      actor: "you",
      type: "node.added",
      payload: { id: c.id, kind: "card", title: c.title, ...(c.id === "root" ? {} : { parent: "root" }) },
    }),
  );
  writeFileSync(join(dir, ".werk", "log.jsonl"), `${lines.join("\n")}\n`);
  return dir;
}

export function werk(dir: string, ...args: string[]): string {
  const run = spawnSync("bun", [CLI, ...args], { cwd: dir, env: env(), encoding: "utf8" });
  if (run.status !== 0) throw new Error(`werk ${args.join(" ")} exited ${run.status}: ${run.stderr}`);
  return run.stdout;
}

export function serve(dir: string, port = 0): Srv {
  const proc = spawn("bun", [CLI, "serve", "--port", String(port)], { cwd: dir, env: env(), stdio: ["ignore", "pipe", "pipe"] });
  procs.push(proc);
  let err = "";
  proc.stderr?.on("data", (c: Buffer) => {
    err += c.toString();
  });
  const exited = new Promise<number | null>((r) => proc.once("exit", (code) => r(code)));
  const url = new Promise<string>((resolve, reject) => {
    let out = "";
    proc.stdout?.on("data", (c: Buffer) => {
      out += c.toString();
      const f = /http:\/\/\S+/.exec(out);
      if (f !== null) resolve(f[0].replace(/\/map$/, ""));
    });
    proc.once("exit", (code) => reject(new Error(`werk serve exited ${code}: ${err}`)));
  });
  url.catch(() => undefined);
  return { proc, err: () => err, url, exited };
}

export async function cleanup(): Promise<void> {
  for (const p of procs.splice(0)) {
    if (p.exitCode === null && p.signalCode === null) {
      const done = new Promise((r) => p.once("exit", r));
      p.kill("SIGKILL");
      await done;
    }
  }
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
}
