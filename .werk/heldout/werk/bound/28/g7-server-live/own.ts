// Helpers for held-out tests that need their own project and their own werk serve processes.
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanEnv } from "../../src/test/clean-env.ts";

const CLI = fileURLToPath(new URL("../../src/cli.ts", import.meta.url));
const FAKE_BIN = fileURLToPath(new URL("../../src/test/fake-bin", import.meta.url));

export type Card = { id: string; title: string; parent?: string; why?: string; body?: string };

export type Serve = {
  proc: ChildProcess;
  out(): string;
  err(): string;
  exited: Promise<number | null>;
  /** Resolves with the base URL once the server prints it, or undefined if the process exits first. */
  url: Promise<string | undefined>;
  startedAt: number;
};

export class Own {
  readonly root = realpathSync(mkdtempSync(join(tmpdir(), "werk-g7-")));
  readonly dir = join(this.root, "project");
  readonly env = cleanEnv(process.env, FAKE_BIN);
  private readonly procs = new Set<ChildProcess>();

  constructor(cards: Card[]) {
    mkdirSync(join(this.dir, ".werk"), { recursive: true });
    mkdirSync(join(this.root, "tmp"));
    const lines = cards.map((c, i) =>
      JSON.stringify({
        seq: i + 1,
        at: "2026-10-01T00:00:00.000Z",
        actor: "you",
        type: "node.added",
        payload: { kind: "card", ...c },
      }),
    );
    writeFileSync(join(this.dir, ".werk", "log.jsonl"), lines.map((l) => `${l}\n`).join(""));
  }

  get log(): string {
    return join(this.dir, ".werk", "log.jsonl");
  }

  werk(...args: string[]): string {
    const run = spawnSync("bun", [CLI, ...args], { cwd: this.dir, env: this.env, encoding: "utf8" });
    if (run.status !== 0) throw new Error(`werk ${args.join(" ")} exited ${run.status}: ${run.stderr}`);
    return run.stdout;
  }

  serve(port = 0): Serve {
    const proc = spawn("bun", [CLI, "serve", "--port", String(port)], {
      cwd: this.dir,
      env: { ...this.env, TMPDIR: join(this.root, "tmp") },
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.procs.add(proc);
    let out = "";
    let err = "";
    proc.stderr?.on("data", (c: Buffer) => {
      err += c.toString();
    });
    const exited = new Promise<number | null>((resolve) =>
      proc.once("exit", (code) => {
        this.procs.delete(proc);
        resolve(code);
      }),
    );
    const url = new Promise<string | undefined>((resolve) => {
      proc.stdout?.on("data", (c: Buffer) => {
        out += c.toString();
        const found = /http:\/\/\S+/.exec(out);
        if (found !== null) resolve(found[0].replace(/\/map$/, ""));
      });
      void exited.then(() => resolve(undefined));
    });
    return { proc, out: () => out, err: () => err, exited, url, startedAt: Date.now() };
  }

  async close(): Promise<void> {
    await Promise.all(
      [...this.procs].map((p) => {
        const done = new Promise((r) => p.once("exit", r));
        p.kill("SIGKILL");
        return done;
      }),
    );
    rmSync(this.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
}
