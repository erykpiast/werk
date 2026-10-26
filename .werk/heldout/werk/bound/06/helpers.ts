// Held-out test helpers: a temporary map per test, the werk command line run as a child process.
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const ROOT = join(import.meta.dir, "..");
const dirs: string[] = [];

export function cleanup(): void {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
}

export type LogEvent = { seq: number; type: string; actor: string; payload: Record<string, unknown> };
export type Run = { code: number; out: string; err: string };

export class Project {
  dir = mkdtempSync(join(tmpdir(), "werk-heldout-"));
  log: string;
  constructor() {
    dirs.push(this.dir);
    mkdirSync(join(this.dir, ".werk"), { recursive: true });
    this.log = join(this.dir, ".werk", "log.jsonl");
  }
  werk(...args: string[]): Run {
    const run = Bun.spawnSync([process.execPath, join(ROOT, "src/cli.ts"), ...args], {
      cwd: this.dir,
      env: { ...process.env, WERK_LOG: this.log },
      stdout: "pipe",
      stderr: "pipe",
    });
    return { code: run.exitCode ?? -1, out: run.stdout.toString(), err: run.stderr.toString() };
  }
  events(): LogEvent[] {
    if (!existsSync(this.log)) return [];
    return readFileSync(this.log, "utf8")
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line));
  }
  /** Writes Given-state events straight to the log. */
  seed(...drafts: { type: string; actor?: string; payload: Record<string, unknown> }[]): void {
    let seq = this.events().length;
    for (const d of drafts) {
      seq += 1;
      const event = { seq, at: new Date().toISOString(), actor: d.actor ?? "you", type: d.type, payload: d.payload };
      appendFileSync(this.log, `${JSON.stringify(event)}\n`);
    }
  }
  card(id: string, title: string, extra: Record<string, unknown> = {}): void {
    this.seed({ type: "node.added", payload: { id, kind: "card", title, ...extra } });
  }
}
