// Held-out helper: a temporary project whose log the test seeds, and the werk command line on it.
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "bun:test";

const CLI = join(import.meta.dir, "..", "src", "cli.ts");
const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

export type Out = { code: number; out: string; err: string };

export function proj() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "werk-heldout-c-")));
  roots.push(dir);
  mkdirSync(join(dir, ".werk"));
  const log = join(dir, ".werk", "log.jsonl");
  writeFileSync(log, "");
  const lines = () => readFileSync(log, "utf8").split("\n").filter(Boolean);
  const seed = (type: string, payload: object, actor = "you") =>
    appendFileSync(log, `${JSON.stringify({ seq: lines().length + 1, at: "t", actor, type, payload })}\n`);
  const werk = (...args: string[]): Out => {
    const run = Bun.spawnSync([process.execPath, CLI, ...args], { cwd: dir, stdout: "pipe", stderr: "pipe" });
    return { code: run.exitCode ?? -1, out: run.stdout.toString(), err: run.stderr.toString() };
  };
  const card = (id: string, extra: Record<string, unknown> = {}, decided = false) => {
    seed("node.added", { id, kind: "card", title: id, ...extra });
    if (decided) seed("node.decided", { id });
  };
  const chat = (name: string, msgs: object[]) => {
    mkdirSync(join(dir, ".werk", "chats"), { recursive: true });
    writeFileSync(join(dir, ".werk", "chats", `${name}.jsonl`), `${msgs.map((m) => JSON.stringify(m)).join("\n")}\n`);
  };
  return { dir, log, lines, seed, werk, card, chat };
}
