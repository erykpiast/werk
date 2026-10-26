// Helpers of fork D's held-out tests: a project folder with a seeded log, werk commands on it, and
// werk servers started by hand, so a test can start two at once or kill one.
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { cleanEnv } from "../src/test/clean-env.ts";
import { FAKE_DIR_VAR, SCRIPT_FILE } from "../src/test/fake-script.ts";

export const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const FAKE_BIN = fileURLToPath(new URL("../src/test/fake-bin", import.meta.url));

const roots: string[] = [];
const procs = new Set<ChildProcess>();

export type Proj = {
  dir: string;
  env: Record<string, string>;
  log: string;
  werk(...args: string[]): { code: number; out: string; err: string };
  ok(...args: string[]): string;
  seed(type: string, payload: object): void;
  lines(): string[];
};

export function proj(): Proj {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "werk-heldout-d-")));
  roots.push(root);
  const dir = join(root, "project");
  const fake = join(root, "fake");
  mkdirSync(join(dir, ".werk"), { recursive: true });
  mkdirSync(fake);
  writeFileSync(join(fake, SCRIPT_FILE), JSON.stringify({ roles: {} }));
  spawnSync("git", ["init", "-q"], { cwd: dir });
  const env = { ...cleanEnv(process.env, FAKE_BIN), [FAKE_DIR_VAR]: fake } as Record<string, string>;
  const log = join(dir, ".werk", "log.jsonl");
  writeFileSync(log, "");
  const lines = () => readFileSync(log, "utf8").split("\n").filter(Boolean);
  const seed = (type: string, payload: object) =>
    appendFileSync(log, `${JSON.stringify({ seq: lines().length + 1, at: "t", actor: "you", type, payload })}\n`);
  const werk = (...args: string[]) => {
    const run = spawnSync("bun", [CLI, ...args], { cwd: dir, env, encoding: "utf8" });
    return { code: run.status ?? -1, out: run.stdout, err: run.stderr };
  };
  const ok = (...args: string[]) => {
    const r = werk(...args);
    if (r.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${r.code}: ${r.err}`);
    return r.out;
  };
  return { dir, env, log, werk, ok, seed, lines };
}

export type Server = {
  proc: ChildProcess;
  out(): string;
  err(): string;
  /** Resolves with the URL when the server prints it, or rejects with the exit code. */
  url: Promise<string>;
  exited: Promise<number | null>;
};

export function serve(p: Proj, port = 0): Server {
  const proc = spawn("bun", [CLI, "serve", "--port", String(port)], {
    cwd: p.dir,
    env: p.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  procs.add(proc);
  let out = "";
  let err = "";
  const exited = new Promise<number | null>((resolve) => proc.once("exit", (code) => resolve(code)));
  void exited.then(() => procs.delete(proc));
  const url = new Promise<string>((resolve, reject) => {
    proc.stdout?.on("data", (chunk: Buffer) => {
      out += chunk.toString();
      const found = /http:\/\/\S+/.exec(out);
      if (found !== null) resolve(found[0].replace(/\/map$/, ""));
    });
    proc.stderr?.on("data", (chunk: Buffer) => {
      err += chunk.toString();
    });
    void exited.then((code) => reject(new Error(`exited ${code}: ${err}`)));
  });
  url.catch(() => undefined);
  return { proc, out: () => out, err: () => err, url, exited };
}

export async function cleanup(): Promise<void> {
  await Promise.all(
    [...procs].map((proc) => {
      const exited = new Promise((resolve) => proc.once("exit", resolve));
      proc.kill("SIGKILL");
      return exited;
    }),
  );
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
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

/** Marks the open document; a reload loses the mark. */
export const mark = (p: Page) =>
  p.evaluate(() => {
    (window as unknown as { kept: boolean }).kept = true;
  });
export const marked = (p: Page) => p.evaluate(() => (window as unknown as { kept?: boolean }).kept === true);

/** A real card seeded straight into the log. */
export function card(p: Pick<Proj, "seed">, id: string, fields: Record<string, unknown> = {}): void {
  p.seed("node.added", { id, kind: "card", title: id, parent: "root", status: "decided", who: "me", ...fields });
}
