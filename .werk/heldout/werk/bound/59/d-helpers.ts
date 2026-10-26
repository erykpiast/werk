// Binder helpers for the d-* held-out tests: a temp project, werk commands, and werk servers.
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanEnv } from "../src/test/clean-env.ts";
import { FAKE_DIR_VAR, SCRIPT_FILE } from "../src/test/fake-script.ts";

const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const FAKE_BIN = fileURLToPath(new URL("../src/test/fake-bin", import.meta.url));

export type Server = { proc: ChildProcess; url: Promise<string>; out(): string; err(): string; exit: Promise<number | null> };

export class Proj {
  root = realpathSync(mkdtempSync(join(tmpdir(), "werk-heldout-d-")));
  dir = join(this.root, "project");
  log = join(this.dir, ".werk", "log.jsonl");
  env: Record<string, string>;
  procs = new Set<ChildProcess>();
  constructor(script: object = { roles: {} }) {
    mkdirSync(join(this.dir, ".werk"), { recursive: true });
    const fake = join(this.root, "fake");
    mkdirSync(fake);
    writeFileSync(join(fake, SCRIPT_FILE), JSON.stringify(script));
    writeFileSync(this.log, "");
    this.env = { ...cleanEnv(process.env, FAKE_BIN), [FAKE_DIR_VAR]: fake } as Record<string, string>;
  }
  lines(): string[] {
    return readFileSync(this.log, "utf8").split("\n").filter(Boolean);
  }
  seed(type: string, payload: object): void {
    appendFileSync(
      this.log,
      `${JSON.stringify({ seq: this.lines().length + 1, at: "t", actor: "you", type, payload })}\n`,
    );
  }
  card(id: string, title: string, fields: object = {}): void {
    this.seed("node.added", { id, kind: "card", title, ...fields });
  }
  werkRaw(...args: string[]) {
    const run = spawnSync("bun", [CLI, ...args], { cwd: this.dir, env: this.env, encoding: "utf8" });
    return { code: run.status, out: run.stdout, err: run.stderr };
  }
  werk(...args: string[]): string {
    const run = this.werkRaw(...args);
    if (run.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${run.code}: ${run.err}`);
    return run.out;
  }
  serve(port = 0): Server {
    const proc = spawn("bun", [CLI, "serve", "--port", String(port)], {
      cwd: this.dir,
      env: this.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.procs.add(proc);
    let out = "";
    let err = "";
    proc.stderr?.on("data", (c: Buffer) => {
      err += c.toString();
    });
    const exit = new Promise<number | null>((resolve) => proc.once("exit", (code) => resolve(code)));
    const url = new Promise<string>((resolve, reject) => {
      proc.stdout?.on("data", (c: Buffer) => {
        out += c.toString();
        const found = /http:\/\/\S+/.exec(out);
        if (found !== null) resolve(found[0].replace(/\/map$/, ""));
      });
      void exit.then((code) => reject(new Error(`werk serve exited ${code}: ${err}`)));
    });
    url.catch(() => undefined);
    return { proc, url, out: () => out, err: () => err, exit };
  }
  async close(): Promise<void> {
    await Promise.all(
      [...this.procs].map((proc) => {
        if (proc.exitCode !== null || proc.signalCode !== null) return undefined;
        const exited = new Promise((resolve) => proc.once("exit", resolve));
        proc.kill("SIGKILL");
        return exited;
      }),
    );
    rmSync(this.root, { recursive: true, force: true });
  }
}

/** One request with any Host header and optional token. */
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

/** An init script that records every `changed` signal the page's own live channel receives. */
export const RECORD_CHANGED = () => {
  const Real = window.EventSource;
  const seen: string[] = [];
  (window as unknown as { __changed: string[] }).__changed = seen;
  class Recording extends Real {
    constructor(url: string | URL, init?: EventSourceInit) {
      super(url, init);
      super.addEventListener("changed", (e) => seen.push(String((e as MessageEvent).data)));
    }
  }
  window.EventSource = Recording as typeof EventSource;
};
