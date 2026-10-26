// Shared helper for held-out command-line tests: a temporary project with a seeded log.
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const CHECKOUT = join(import.meta.dir, "..");
export const CLI = join(CHECKOUT, "src", "cli.ts");

export type Run = { code: number; out: string; err: string; all: string };

export type P = {
  dir: string;
  log: string;
  /** Run werk in the project. */
  werk(...args: string[]): Run;
  /** Append one event straight to the log (actor you by default). */
  seed(type: string, payload: object, actor?: string): void;
  /** Seed a real card with node.added. */
  card(id: string, title: string, extra?: Record<string, unknown>): void;
  lines(): string[];
  events(): { seq: number; type: string; actor: string; payload: Record<string, unknown> }[];
  raw(): string;
  cleanup(): void;
};

const made: P[] = [];

export function project(opts: { git?: boolean; env?: Record<string, string> } = {}): P {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "werk-ho-")));
  const dir = join(root, "project");
  mkdirSync(join(dir, ".werk"), { recursive: true });
  const log = join(dir, ".werk", "log.jsonl");
  writeFileSync(log, "");
  if (opts.git) {
    Bun.spawnSync(["git", "init", "-q", "--initial-branch=main"], { cwd: dir });
  }
  const raw = () => readFileSync(log, "utf8");
  const lines = () => raw().split("\n").filter(Boolean);
  const p: P = {
    dir,
    log,
    werk: (...args) => {
      const r = Bun.spawnSync(["bun", CLI, ...args], {
        cwd: dir,
        env: { ...process.env, ...opts.env },
        stdout: "pipe",
        stderr: "pipe",
      });
      const out = r.stdout.toString();
      const err = r.stderr.toString();
      return { code: r.exitCode ?? -1, out, err, all: out + err };
    },
    seed: (type, payload, actor = "you") =>
      appendFileSync(
        log,
        `${JSON.stringify({ seq: lines().length + 1, at: new Date().toISOString(), actor, type, payload })}\n`,
      ),
    card: (id, title, extra = {}) => p.seed("node.added", { id, kind: "card", title, ...extra }),
    lines,
    events: () => lines().map((l) => JSON.parse(l)),
    raw,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
  made.push(p);
  return p;
}

export function cleanupAll(): void {
  for (const p of made.splice(0)) p.cleanup();
}
