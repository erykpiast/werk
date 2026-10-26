/** Shared helpers for the held-out tests: a fresh project, the werk command line, and log seeding. */
import { afterEach, beforeEach } from "bun:test";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fold, parseLog } from "../src/map/fold.ts";
import { createProject, type Project } from "../src/test-env/project.ts";

export const REPO = join(import.meta.dir, "..");
export const CLI = join(REPO, "src", "cli.ts");

export type Ev = Record<string, unknown>;

type CardOpts = {
  title?: string;
  why?: string;
  body?: string;
  status?: "open" | "proto" | "decided";
  parent?: string;
  kind?: "card" | "option" | "source" | "excerpt";
};

/** A ghost: one proposed event. */
export function ghost(id: string, o: CardOpts = {}): Ev[] {
  const e: Ev = {
    type: "node.proposed",
    id,
    kind: o.kind ?? "card",
    title: o.title ?? id,
    status: o.status ?? "open",
  };
  for (const k of ["why", "body", "parent"] as const) {
    if (o[k] !== undefined) e[k] = o[k];
  }
  return [e];
}

/** A real card: proposed, then accepted by the person. */
export function card(id: string, o: CardOpts = {}): Ev[] {
  return [...ghost(id, o), { type: "node.accepted", id, actor: "you" }];
}

export const edge = (
  from: string,
  to: string,
  link: string,
  why = "",
): Ev[] => [
  {
    type: "edge.added",
    from,
    to,
    link,
    ...(why === "" ? {} : { why }),
  },
];

export function setupWerk() {
  let project: Project | undefined;
  beforeEach(() => {
    project = createProject();
  });
  afterEach(async () => {
    await project?.dispose();
    project = undefined;
  });
  const p = () => project as Project;
  const werk = (...args: string[]) => p().run(["bun", CLI, ...args]);
  const append = (path: string, events: Ev[]) => {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, events.map((e) => `${JSON.stringify(e)}\n`).join(""));
  };
  /** Appends events to the map log and checks that the fold accepts every one. */
  const seed = (...groups: Ev[][]) => {
    append(p().logPath, groups.flat());
    const { problems } = fold(parseLog(readFileSync(p().logPath, "utf8")));
    if (problems.length > 0) {
      throw new Error(`seed is not valid: ${JSON.stringify(problems)}`);
    }
  };
  const boardPath = () => join(dirname(p().logPath), "board.jsonl");
  const seedBoard = (...events: Ev[]) => append(boardPath(), events);
  const logLines = () =>
    readFileSync(p().logPath, "utf8")
      .split("\n")
      .filter((l) => l !== "");
  return { p, werk, seed, seedBoard, boardPath, logLines };
}

export const lines = (text: string) =>
  text
    .trim()
    .split("\n")
    .filter((l) => l !== "");
