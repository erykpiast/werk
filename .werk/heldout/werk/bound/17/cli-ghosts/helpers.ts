// Held-out helpers: a temporary project with a seeded log, and the werk command line run in it.
import { afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = join(import.meta.dir, "..", "..", "src", "cli.ts");
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

export type Run = { code: number; out: string; err: string };
export type Seed = { id: string; title: string; kind?: string; status?: string; parent?: string; [k: string]: unknown };

export function project(seeds: Seed[] = []) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "werk-heldout-")));
  roots.push(dir);
  Bun.spawnSync(["git", "init", "-q"], { cwd: dir });
  mkdirSync(join(dir, ".werk"));
  const log = join(dir, ".werk", "log.jsonl");
  const lines: string[] = [];
  for (const seed of seeds) {
    const { parent, ...node } = seed;
    lines.push(
      JSON.stringify({ seq: lines.length + 1, at: "t", actor: "you", type: "node.added", payload: { kind: "card", ...node } }),
    );
    if (parent !== undefined)
      lines.push(
        JSON.stringify({
          seq: lines.length + 1,
          at: "t",
          actor: "you",
          type: "edge.added",
          payload: { from: seed.id, to: parent, type: "refines" },
        }),
      );
  }
  writeFileSync(log, lines.map((l) => `${l}\n`).join(""));
  const werk = (...args: string[]): Run => {
    const run = Bun.spawnSync([process.execPath, CLI, ...args], { cwd: dir, stdout: "pipe", stderr: "pipe" });
    return { code: run.exitCode ?? -1, out: run.stdout.toString(), err: run.stderr.toString() };
  };
  const ok = (...args: string[]): Run => {
    const run = werk(...args);
    if (run.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${run.code}: ${run.err}`);
    return run;
  };
  const logText = () => readFileSync(log, "utf8");
  const events = () =>
    logText()
      .split("\n")
      .filter((l) => l !== "")
      .map((l) => JSON.parse(l) as { seq: number; type: string; actor: string; payload: Record<string, unknown> });
  const rawLines = () => logText().split("\n").filter((l) => l !== "");
  const show = (id: string) => ok("show", id).out;
  return { dir, werk, ok, events, rawLines, logText, show };
}

/** The first line of a show: kind, id, status and marks such as "proposed". */
export const head = (show: string) => show.split("\n")[0] ?? "";
