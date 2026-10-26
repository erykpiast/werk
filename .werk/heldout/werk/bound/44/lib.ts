// Helpers for the held-out CLI tests: seed a map log, run the werk command line, read the log.
import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  cpSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fold, parseLog } from "../src/map/fold.ts";
import type { Project } from "../src/test-env/project.ts";

export const ROOT = join(import.meta.dirname, "..");
export const CLI = join(ROOT, "src", "cli.ts");

export type Ev = Record<string, unknown>;

export const werk = (project: Project, ...args: string[]) =>
  project.run(["bun", CLI, ...args]);

export function seed(project: Project, events: Ev[]): void {
  mkdirSync(dirname(project.logPath), { recursive: true });
  appendFileSync(
    project.logPath,
    `${events.map((e) => JSON.stringify(e)).join("\n")}\n`,
  );
}

/** Folds the log of the project and returns the map problems (a seed that breaks a rule shows here). */
export function problems(project: Project) {
  return fold(parseLog(readFileSync(project.logPath, "utf8"))).problems;
}

export function foldMap(project: Project) {
  return fold(parseLog(readFileSync(project.logPath, "utf8")));
}

type CardOpts = {
  parent?: string;
  why?: string;
  body?: string;
  status?: "open" | "proto";
  who?: "you" | "me" | "prototype";
};

/** A ghost card: one proposed event. */
export function ghost(id: string, title: string, o: CardOpts = {}): Ev[] {
  const e: Ev = {
    type: "node.proposed",
    id,
    kind: "card",
    title,
    status: o.status ?? "open",
  };
  if (o.why !== undefined) e.why = o.why;
  if (o.body !== undefined) e.body = o.body;
  if (o.parent !== undefined) e.parent = o.parent;
  if (o.who !== undefined) e.who = o.who;
  return [e];
}

/** A real (accepted) card that is not decided. */
export function real(id: string, title: string, o: CardOpts = {}): Ev[] {
  return [...ghost(id, title, o), { type: "node.accepted", id, actor: "you" }];
}

/** The events that make a card meet the contract and become decided (it stays a ghost when `accept` is false). */
export function decided(
  id: string,
  title: string,
  o: CardOpts & { accept?: boolean } = {},
): Ev[] {
  const accept = o.accept ?? true;
  return [
    ...ghost(id, title, { who: "you", ...o }),
    ...(accept ? [{ type: "node.accepted", id, actor: "you" }] : []),
    { type: "node.edited", id, noBasis: "root of the test map", unchallenged: "test map" },
    { type: "criterion.added", id, form: "revisit" },
    { type: "node.decided", id },
  ];
}

export const link = (
  from: string,
  to: string,
  type: string,
  why = "",
): Ev => ({
  type: "edge.added",
  from,
  to,
  link: type,
  ...(why === "" ? {} : { why }),
});

export function writeChat(project: Project, name: string, lines: unknown[]) {
  const dir = join(project.dir, ".werk", "chats");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${name}.jsonl`),
    lines.map((l) => `${JSON.stringify(l)}\n`).join(""),
  );
}

export const readLogText = (project: Project) => readFileSync(project.logPath, "utf8");

/** A copy of the tracked files of the checkout in a new temp folder, with the packages linked in. A test edits the copy, never the checkout. */
export function copyRepo(): string {
  const dest = mkdtempSync(join(tmpdir(), "werk-heldout-copy-"));
  const listed = spawnSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" });
  for (const rel of listed.stdout.split("\0").filter(Boolean)) {
    const from = join(ROOT, rel);
    if (!lstatSync(from, { throwIfNoEntry: false })) continue;
    mkdirSync(dirname(join(dest, rel)), { recursive: true });
    cpSync(from, join(dest, rel), { verbatimSymlinks: true, preserveTimestamps: true });
  }
  symlinkSync(join(ROOT, "node_modules"), join(dest, "node_modules"));
  return dest;
}
