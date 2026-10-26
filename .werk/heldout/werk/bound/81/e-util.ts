import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));

export function ev(seq: number, id: string, title: string, parent?: string) {
  return JSON.stringify({ seq, at: "2026-10-01T00:00:00.000Z", actor: "you", type: "node.added", payload: { id, kind: "card", title, ...(parent ? { parent } : {}) } });
}

export function makeProject(cards: [string, string, string?][]): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "heldout-e-")));
  const dir = join(root, "project");
  mkdirSync(join(dir, ".werk"), { recursive: true });
  writeFileSync(join(dir, ".werk", "log.jsonl"), `${cards.map((c, i) => ev(i + 1, c[0], c[1], c[2])).join("\n")}\n`);
  return dir;
}

export type Srv = { proc: ChildProcess; out: () => string; err: () => string; exited: Promise<number | null> };

export function serve(dir: string, env: Record<string, string> = {}): Srv {
  const proc = spawn("bun", [CLI, "serve", "--port", "0"], { cwd: dir, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  let err = "";
  proc.stdout?.on("data", (c: Buffer) => (out += c.toString()));
  proc.stderr?.on("data", (c: Buffer) => (err += c.toString()));
  const exited = new Promise<number | null>((r) => proc.once("exit", (code) => r(code)));
  return { proc, out: () => out, err: () => err, exited };
}

export async function until<T>(fn: () => T | undefined | false, ms = 15000): Promise<T> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = fn();
    if (v) return v as T;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("timeout");
}

export const urlOf = (s: Srv) => /http:\/\/\S+/.exec(s.out())?.[0].replace(/\/map$/, "");

export function werk(dir: string, ...args: string[]) {
  const r = spawnSync("bun", [CLI, ...args], { cwd: dir, encoding: "utf8" });
  return { code: r.status, out: r.stdout, err: r.stderr };
}
