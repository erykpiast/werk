import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "bun:test";

const CLI = join(import.meta.dir, "..", "..", "src", "cli.ts");
const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

export type Run = { code: number; out: string; err: string };

export function project() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "werk-heldout-map-")));
  roots.push(dir);
  Bun.spawnSync(["git", "init", "-q"], { cwd: dir });
  mkdirSync(join(dir, ".werk"));
  const log = join(dir, ".werk", "log.jsonl");
  writeFileSync(log, "");
  const lines = () => readFileSync(log, "utf8").split("\n").filter(Boolean);
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith("WERK")) env[k] = v;
  const werk = (...args: string[]): Run => {
    const r = Bun.spawnSync([process.execPath, CLI, ...args], { cwd: dir, env, stdout: "pipe", stderr: "pipe" });
    return { code: r.exitCode ?? -1, out: r.stdout.toString(), err: r.stderr.toString() };
  };
  /** Appends one event as the person's, the way the e2e harness seeds a map. */
  const seed = (type: string, payload: object) =>
    appendFileSync(log, `${JSON.stringify({ seq: lines().length + 1, at: "t", actor: "you", type, payload })}\n`);
  /** A real card, with an optional status and parent. */
  const card = (id: string, title: string, extra: Record<string, unknown> = {}) =>
    seed("node.added", { id, kind: "card", title, ...extra });
  return { dir, log, lines, werk, seed, card };
}
