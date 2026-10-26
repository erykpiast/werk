// Held-out helpers: a project folder with a seeded log, and raw werk serve processes on it.
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanEnv } from "../src/test/clean-env.ts";

export const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const FAKE_BIN = fileURLToPath(new URL("../src/test/fake-bin", import.meta.url));

export type Proc = { proc: ChildProcess; out: () => string; err: () => string; exited: Promise<number | null> };

export class Raw {
  root = realpathSync(mkdtempSync(join(tmpdir(), "werk-ho-")));
  dir = join(this.root, "project");
  env = cleanEnv(process.env, FAKE_BIN);
  log = join(this.dir, ".werk", "log.jsonl");
  procs: ChildProcess[] = [];
  constructor() {
    mkdirSync(join(this.dir, ".werk"), { recursive: true });
    writeFileSync(this.log, "");
  }
  seed(type: string, payload: object): void {
    const n = readFileSync(this.log, "utf8").split("\n").filter(Boolean).length;
    appendFileSync(this.log, `${JSON.stringify({ seq: n + 1, at: "t", actor: "you", type, payload })}\n`);
  }
  card(id: string, title: string, parent?: string, extra: object = {}): void {
    this.seed("node.added", { id, kind: "card", title, ...(parent ? { parent } : {}), ...extra });
  }
  werk(...args: string[]): { code: number | null; out: string; err: string } {
    const r = spawnSync("bun", [CLI, ...args], { cwd: this.dir, env: this.env, encoding: "utf8" });
    return { code: r.status, out: r.stdout, err: r.stderr };
  }
  serve(port = 0): Proc {
    const proc = spawn("bun", [CLI, "serve", "--port", String(port)], {
      cwd: this.dir,
      env: this.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.procs.push(proc);
    let out = "";
    let err = "";
    proc.stdout?.on("data", (c: Buffer) => (out += c.toString()));
    proc.stderr?.on("data", (c: Buffer) => (err += c.toString()));
    const exited = new Promise<number | null>((r) => proc.once("exit", (code) => r(code)));
    return { proc, out: () => out, err: () => err, exited };
  }
  close(): void {
    for (const p of this.procs) if (p.exitCode === null && p.signalCode === null) p.kill("SIGKILL");
    rmSync(this.root, { recursive: true, force: true });
  }
}

export async function urlOf(p: Proc, ms = 15000): Promise<string | undefined> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const m = /http:\/\/\S+/.exec(p.out());
    if (m) return m[0].replace(/\/map$/, "");
    if (p.proc.exitCode !== null) return undefined;
    await new Promise((r) => setTimeout(r, 50));
  }
  return undefined;
}
