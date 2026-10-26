import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readBoard } from "../../src/board/log-store.ts";
import type { Script, Step } from "../../src/fake-agent/script.ts";
import { createProject, type Project } from "../../src/test-env/project.ts";
import { ticket } from "../../src/tickets/fixtures.ts";

export const CLI = join(import.meta.dir, "..", "..", "src", "cli.ts");

export const RESULT: Step = {
  event: {
    type: "result",
    subtype: "success",
    is_error: false,
    duration_ms: 5,
    total_cost_usd: 0.25,
    usage: { input_tokens: 10, output_tokens: 20 },
  },
};
export const edit = (path: string, content: string): Step => ({
  edit: path,
  content,
});
export const SPEC_ONE =
  "## Problem\n\nP.\n\n## User stories\n\n1. As a person, I want it.\n";
export const SPEC_TWO =
  "## Problem\n\nP. Now also the late card.\n\n## User stories\n\n1. As a person, I want it.\n2. As a person, I want more.\n";
export const ANSWERS = edit("specs/app/ticket-answers.json", "[]");
export const SPEC_ANSWERS = edit("specs/app/spec-answers.json", "[]");
export const spec = (text: string): Step[] => [
  edit("specs/app/spec.md", text),
  SPEC_ANSWERS,
  RESULT,
];
export const tickets = (...files: [string, string][]): Step[] => [
  ...files.map(([name, text]) => edit(`tickets/app/${name}`, text)),
  ANSWERS,
  RESULT,
];
export const t = (n: number, cites = "app", stories = "1") =>
  ticket({ title: `Ticket ${n}`, cites, stories });

export class Ws {
  project: Project;
  constructor() {
    this.project = createProject();
  }
  dispose() {
    return this.project.dispose();
  }
  werk = (...args: string[]) => this.project.run(["bun", CLI, ...args]);
  seed(events: unknown[]) {
    writeFileSync(
      this.project.logPath,
      `${events.map((e) => JSON.stringify(e)).join("\n")}\n`,
    );
  }
  log(...events: unknown[]) {
    appendFileSync(
      this.project.logPath,
      events
        .flat()
        .map((e) => `${JSON.stringify(e)}\n`)
        .join(""),
    );
  }
  boardPath = () => join(this.project.dir, ".werk", "board.jsonl");
  board = () => readBoard(this.boardPath());
  boardEvents(): any[] {
    return readFileSync(this.boardPath(), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  }
  file = (p: string) => readFileSync(join(this.project.dir, ".werk", p), "utf8");
  /** Board events the merge loop would write: a fixture for the states a plan meets. */
  put(...events: unknown[]) {
    for (const e of events) appendFileSync(this.boardPath(), `${JSON.stringify(e)}\n`);
  }
}

export async function until<T>(
  read: () => T | undefined | Promise<T | undefined>,
  ms = 15000,
): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await (async () => read())().catch(() => undefined);
    if (v !== undefined) return v;
    if (Date.now() > end) throw new Error("timed out");
    await Bun.sleep(50);
  }
}

export type { Script };
