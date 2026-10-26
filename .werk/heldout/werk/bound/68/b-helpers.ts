// Shared helpers of the binder's group-B tests: a fresh project, a seeded log, and command runs.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../src/test/project.ts";

export type { Project };

export const logOf = (p: Project) => join(p.dir, ".werk", "log.jsonl");
export const lines = (p: Project) =>
  readFileSync(logOf(p), "utf8")
    .split("\n")
    .filter((l) => l !== "");
export const events = (p: Project) => lines(p).map((l) => JSON.parse(l));

/** Appends events as the person's own, in log order. */
export function seed(p: Project, ...evs: { type: string; payload: object }[]): void {
  const at = lines(p).length;
  appendFileSync(
    logOf(p),
    evs.map((e, i) => `${JSON.stringify({ seq: at + i + 1, at: "t", actor: "you", ...e })}\n`).join(""),
  );
}

/** A real card, as the person's accepted map holds it. */
export const real = (id: string, title: string, extra: object = {}) => ({
  type: "node.added",
  payload: { id, kind: "card", title, ...extra },
});

/** A real decided card with who, a waived basis and a kill criterion. */
export function decided(p: Project, id: string, title: string, extra: object = {}): void {
  seed(p, real(id, title, { status: "decided", who: "me", no_basis: "top", ...extra }), {
    type: "kill.added",
    payload: { id, criterion: { form: "revisit" } },
  });
}

export function project(): Project {
  return freshProject();
}

export async function ok(p: Project, args: string[]) {
  const run = await p.werk(args);
  if (run.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${run.code}: ${run.err}${run.out}`);
  return run;
}

/** The first line of `werk show`: the header with kind, id, status and marks. */
export async function header(p: Project, id: string): Promise<string> {
  return (await ok(p, ["show", id])).out.split("\n")[0] ?? "";
}

/** A chat log with one spoken message from the person. */
export function chat(p: Project, name: string, text: string): void {
  mkdirSync(join(p.dir, ".werk", "chats"), { recursive: true });
  writeFileSync(
    join(p.dir, ".werk", "chats", `${name}.jsonl`),
    `${JSON.stringify({ speaker: "person", at: "t0", session: "s1", kind: "spoken", text })}\n`,
  );
}
