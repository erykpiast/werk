// A fresh project with a werk server on it, for the held-out browser tests.
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";

export const CLI = fileURLToPath(new URL("../../src/cli.ts", import.meta.url));

export function env(): NodeJS.ProcessEnv {
  const clean = { ...process.env };
  for (const name of Object.keys(clean)) if (name.startsWith("WERK_")) delete clean[name];
  return clean;
}

export type Werk = {
  dir: string;
  log: string;
  url: string;
  lines(): number;
  werk(...args: string[]): { code: number; out: string; err: string };
  ok(...args: string[]): string;
  seed(type: string, payload: object): void;
  serve(): Promise<string>;
  servers: ChildProcess[];
};

const roots: string[] = [];
const servers: ChildProcess[] = [];

test.afterEach(() => {
  for (const server of servers.splice(0)) server.kill("SIGKILL");
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

export function startServe(dir: string): { proc: ChildProcess; url: Promise<string>; err: () => string } {
  const proc = spawn("bun", [CLI, "serve", "--port", "0"], { cwd: dir, env: env(), stdio: ["ignore", "pipe", "pipe"] });
  servers.push(proc);
  let err = "";
  const url = new Promise<string>((resolve, reject) => {
    let out = "";
    proc.stdout?.on("data", (chunk: Buffer) => {
      out += chunk.toString();
      const found = /http:\/\/\S+/.exec(out);
      if (found !== null) resolve(found[0].replace(/\/map$/, ""));
    });
    proc.stderr?.on("data", (chunk: Buffer) => {
      err += chunk.toString();
    });
    proc.on("exit", (code) => reject(new Error(`werk serve exited ${code}: ${err}`)));
  });
  return { proc, url, err: () => err };
}

/** A fresh project. The server starts on `serve()`. */
export function project(): Werk {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "werk-heldout-e2e-")));
  roots.push(root);
  const dir = join(root, "project");
  mkdirSync(join(dir, ".werk"), { recursive: true });
  const log = join(dir, ".werk", "log.jsonl");
  writeFileSync(log, "");
  const lines = () => readFileSync(log, "utf8").split("\n").filter(Boolean).length;
  const werk = (...args: string[]) => {
    const run = spawnSync("bun", [CLI, ...args], { cwd: dir, env: env(), encoding: "utf8" });
    return { code: run.status ?? -1, out: run.stdout, err: run.stderr };
  };
  const w: Werk = {
    dir,
    log,
    url: "",
    lines,
    werk,
    ok: (...args) => {
      const run = werk(...args);
      if (run.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${run.code}: ${run.err}`);
      return run.out;
    },
    seed: (type, payload) =>
      appendFileSync(
        log,
        `${JSON.stringify({ seq: lines() + 1, at: "2026-10-01T09:00:00Z", actor: "you", type, payload })}\n`,
      ),
    serve: async () => {
      w.url = await startServe(dir).url;
      return w.url;
    },
    servers,
  };
  return w;
}

export function chatLog(dir: string, name: string, messages: { kind: string; speaker: string; text: string }[]) {
  mkdirSync(join(dir, ".werk", "chats"), { recursive: true });
  writeFileSync(
    join(dir, ".werk", "chats", `${name}.jsonl`),
    messages.map((m, i) => `${JSON.stringify({ ...m, at: `2026-10-01T10:0${i}:00Z`, session: "sess-1" })}\n`).join(""),
  );
}

export async function typeNote(p: Page, text: string): Promise<void> {
  await p.getByRole("textbox", { name: "Note" }).fill(text);
  await p.getByRole("button", { name: "Add note" }).click();
  await expect(p.getByRole("textbox", { name: "Note" })).toHaveValue("");
}

export const thread = (p: Page) => p.locator('[data-section="thread"]');
