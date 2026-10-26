// Helpers of the web-a held-out specs: a bare project and werk serve processes that a test controls.
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { cleanEnv } from "../src/test/clean-env.ts";

export const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const FAKE_BIN = fileURLToPath(new URL("../src/test/fake-bin", import.meta.url));

const running: ChildProcess[] = [];

export type Bare = {
  root: string;
  dir: string;
  log: string;
  env: Record<string, string>;
  seed(type: string, payload: object): void;
  werk(...args: string[]): string;
  cleanup(): void;
};

export function bare(): Bare {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "werk-weba-")));
  const dir = join(root, "project");
  mkdirSync(join(dir, ".werk"), { recursive: true });
  const log = join(dir, ".werk", "log.jsonl");
  writeFileSync(log, "");
  const env = cleanEnv(process.env, FAKE_BIN);
  const lines = () => readFileSync(log, "utf8").split("\n").filter(Boolean).length;
  return {
    root,
    dir,
    log,
    env,
    seed: (type, payload) =>
      appendFileSync(log, `${JSON.stringify({ seq: lines() + 1, at: "t", actor: "you", type, payload })}\n`),
    werk: (...args) => {
      const run = spawnSync("bun", [CLI, ...args], { cwd: dir, env, encoding: "utf8" });
      if (run.status !== 0) throw new Error(`werk ${args.join(" ")} exited ${run.status}: ${run.stderr}`);
      return run.stdout;
    },
    cleanup: () => {
      for (const p of running.splice(0)) if (p.exitCode === null) p.kill("SIGKILL");
      rmSync(root, { recursive: true, force: true });
    },
  };
}

export type Serve = {
  proc: ChildProcess;
  out(): string;
  err(): string;
  /** Resolves with the URL when the server prints it, or with undefined when the process exits first. */
  url: Promise<string | undefined>;
  exited: Promise<number | null>;
};

export function serve(b: Bare, port = 0): Serve {
  const proc = spawn("bun", [CLI, "serve", "--port", String(port)], {
    cwd: b.dir,
    env: b.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  running.push(proc);
  let out = "";
  let err = "";
  proc.stderr?.on("data", (c: Buffer) => {
    err += c.toString();
  });
  const exited = new Promise<number | null>((resolve) => proc.once("exit", (code) => resolve(code)));
  const url = new Promise<string | undefined>((resolve) => {
    proc.stdout?.on("data", (c: Buffer) => {
      out += c.toString();
      const found = /http:\/\/\S+/.exec(out);
      if (found !== null) resolve(found[0].replace(/\/map$/, ""));
    });
    void exited.then(() => resolve(undefined));
  });
  return { proc, out: () => out, err: () => err, url, exited };
}

/** One request with any Host header and an optional token. */
export function send(
  url: string,
  path: string,
  options: { method?: string; host?: string; token?: string; body?: string } = {},
): Promise<{ status: number; body: string }> {
  const { port } = new URL(url);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port,
        path,
        method: options.method ?? "GET",
        headers: {
          host: options.host ?? `localhost:${port}`,
          "content-type": "application/json",
          ...(options.token === undefined ? {} : { "x-werk-token": options.token }),
        },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk: Buffer) => {
          body += chunk.toString();
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on("error", reject);
    req.end(options.body);
  });
}

/** Marks the open document, so a later check can tell that the page did not load again. */
export const mark = (p: Page) =>
  p.evaluate(() => {
    (window as unknown as { kept: boolean }).kept = true;
  });
export const marked = (p: Page) => p.evaluate(() => (window as unknown as { kept?: boolean }).kept === true);

/** Records every live-channel open and every changed signal (with its data) the page receives. */
export const watchChannel = (p: Page) =>
  p.addInitScript(() => {
    const w = window as unknown as { __opens: number; __changed: string[]; EventSource: typeof EventSource };
    w.__opens = 0;
    w.__changed = [];
    const Base = w.EventSource;
    w.EventSource = class extends Base {
      constructor(url: string | URL, init?: EventSourceInit) {
        super(url, init);
        this.addEventListener("open", () => {
          w.__opens += 1;
        });
        this.addEventListener("changed", (e) => {
          w.__changed.push((e as MessageEvent<string>).data);
        });
      }
    };
  });
export const channelLog = (p: Page) =>
  p.evaluate(() => {
    const w = window as unknown as { __opens: number; __changed: string[] };
    return { opens: w.__opens, changed: w.__changed };
  });
