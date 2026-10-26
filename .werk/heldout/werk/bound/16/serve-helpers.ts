// Held-out helpers for steps 13.x: a bare project folder and `werk serve` processes the test
// starts and kills itself.
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanEnv } from "../src/test/clean-env.ts";

const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const FAKE_BIN = fileURLToPath(new URL("../src/test/fake-bin", import.meta.url));

export type Serve = {
  proc: ChildProcess;
  pid: number;
  out(): string;
  err(): string;
  /** Resolves with the URL once the server prints it; rejects when it exits first. */
  url: Promise<string>;
  exited: Promise<number | null>;
};

export class Proj {
  readonly root = realpathSync(mkdtempSync(join(tmpdir(), "werk-heldout-")));
  readonly dir = join(this.root, "project");
  readonly log = join(this.dir, ".werk", "log.jsonl");
  readonly env = cleanEnv(process.env, FAKE_BIN);
  private readonly procs = new Set<ChildProcess>();

  constructor() {
    mkdirSync(join(this.dir, ".werk"), { recursive: true });
    writeFileSync(this.log, "");
  }

  seed(type: string, payload: object): void {
    const n = readFileSync(this.log, "utf8").split("\n").filter(Boolean).length;
    appendFileSync(this.log, `${JSON.stringify({ seq: n + 1, at: "t", actor: "you", type, payload })}\n`);
  }

  werk(...args: string[]): { code: number | null; out: string; err: string } {
    const run = spawnSync("bun", [CLI, ...args], { cwd: this.dir, env: this.env, encoding: "utf8" });
    return { code: run.status, out: run.stdout, err: run.stderr };
  }

  serve(port = 0): Serve {
    const proc = spawn("bun", [CLI, "serve", "--port", String(port)], {
      cwd: this.dir,
      env: { ...this.env, TMPDIR: this.root },
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.procs.add(proc);
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
      void exited.then((code) => reject(new Error(`werk serve exited ${code}: ${err}`)));
    });
    url.catch(() => undefined);
    return { proc, pid: proc.pid ?? -1, out: () => out, err: () => err, url, exited };
  }

  async close(): Promise<void> {
    await Promise.all(
      [...this.procs].map((p) => {
        if (p.exitCode !== null || p.signalCode !== null) return undefined;
        const done = new Promise((r) => p.once("exit", r));
        p.kill("SIGKILL");
        return done;
      }),
    );
    rmSync(this.root, { recursive: true, force: true });
  }
}
