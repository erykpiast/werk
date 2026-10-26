// A fresh project with a #root card and a real werk server on it, for the held-out browser tests.
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";

const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));

export type Werk = {
  dir: string;
  url: string;
  werk(...args: string[]): string;
  run(...args: string[]): { status: number | null; stdout: string; stderr: string };
  seed(type: string, payload: object): void;
  lines(): number;
};

function env(): NodeJS.ProcessEnv {
  const clean = { ...process.env };
  delete clean.WERK_LOG;
  return clean;
}

let server: ChildProcess | undefined;
let root: string | undefined;

test.afterEach(() => {
  server?.kill("SIGTERM");
  server = undefined;
  if (root !== undefined) rmSync(root, { recursive: true, force: true });
  root = undefined;
});

export async function project(): Promise<Werk> {
  root = realpathSync(mkdtempSync(join(tmpdir(), "werk-heldout-e2e-")));
  const dir = join(root, "project");
  mkdirSync(join(dir, ".werk"), { recursive: true });
  const log = join(dir, ".werk", "log.jsonl");
  writeFileSync(log, "");
  const lines = () => readFileSync(log, "utf8").split("\n").filter(Boolean).length;
  const seed = (type: string, payload: object) =>
    appendFileSync(log, `${JSON.stringify({ seq: lines() + 1, at: "2026-10-01T09:00:00Z", actor: "you", type, payload })}\n`);
  const run = (...args: string[]) => {
    const r = spawnSync("bun", [CLI, ...args], { cwd: dir, env: env(), encoding: "utf8" });
    return { status: r.status, stdout: r.stdout, stderr: r.stderr };
  };
  const werk = (...args: string[]) => {
    const r = run(...args);
    if (r.status !== 0) throw new Error(`werk ${args.join(" ")} exited ${r.status}: ${r.stderr}`);
    return r.stdout;
  };
  seed("node.added", { id: "root", kind: "card", title: "Root" });

  const proc = spawn("bun", [CLI, "serve", "--port", "0"], { cwd: dir, env: env(), stdio: ["ignore", "pipe", "pipe"] });
  server = proc;
  const url = await new Promise<string>((resolve, reject) => {
    let out = "";
    let err = "";
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
  return { dir, url, werk, run, seed, lines };
}

export function chat(w: Werk, name: string, lines: object[]): void {
  mkdirSync(join(w.dir, ".werk", "chats"), { recursive: true });
  writeFileSync(join(w.dir, ".werk", "chats", `${name}.jsonl`), `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`);
}

export async function typeNote(p: Page, text: string): Promise<void> {
  await p.getByRole("textbox", { name: "Note" }).fill(text);
  await p.getByRole("button", { name: "Add note" }).click();
  await expect(p.getByRole("textbox", { name: "Note" })).toHaveValue("");
}

export const thread = (p: Page) => p.locator('[data-section="thread"]');
export const notes = (p: Page) => thread(p).locator('[data-entry="note"]');
