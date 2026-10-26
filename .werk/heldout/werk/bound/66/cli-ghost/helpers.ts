import { setDefaultTimeout } from "bun:test";
setDefaultTimeout(60_000);
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../../src/test/project.ts";

export const logOf = (p: Project) => join(p.dir, ".werk", "log.jsonl");
export const lines = (p: Project) =>
  readFileSync(logOf(p), "utf8")
    .split("\n")
    .filter((l) => l !== "");
export const events = (p: Project) => lines(p).map((l) => JSON.parse(l));

/** Appends a real event, as the person's accepted map holds it. */
export function seed(p: Project, type: string, payload: object): void {
  appendFileSync(logOf(p), `${JSON.stringify({ seq: lines(p).length + 1, at: "t", actor: "you", type, payload })}\n`);
}

/** A project with a real root card. */
export function withRoot(): Project {
  const p = freshProject();
  seed(p, "node.added", { id: "root", kind: "card", title: "Root" });
  return p;
}

/** A real card under a parent. */
export function card(p: Project, id: string, title: string, parent = "root", status?: string): void {
  seed(p, "node.added", { id, kind: "card", title, parent, ...(status ? { status } : {}) });
}

export async function ok(p: Project, ...args: string[]) {
  const run = await p.werk(args);
  if (run.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${run.code}: ${run.err}${run.out}`);
  return run;
}

export const w = (p: Project, ...args: string[]) => p.werk(args);

/** The first line of show: kind, id, status and markers. */
export async function head(p: Project, id: string): Promise<string> {
  return (await ok(p, "show", id)).out.split("\n")[0] as string;
}

export function chat(p: Project, name: string, rows: object[]): void {
  mkdirSync(join(p.dir, ".werk", "chats"), { recursive: true });
  writeFileSync(join(p.dir, ".werk", "chats", `${name}.jsonl`), `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`);
}
