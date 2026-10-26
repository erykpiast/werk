import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../src/test/project.ts";

export { freshProject, type Project };
export const logOf = (p: Project) => join(p.dir, ".werk", "log.jsonl");
export const lines = (p: Project) =>
  readFileSync(logOf(p), "utf8")
    .split("\n")
    .filter((l) => l !== "");
export type Payload = Record<string, unknown>;
export type Ev = [type: string, payload: Payload];

export function seed(p: Project, events: Ev[]): void {
  let n = lines(p).length;
  for (const [type, payload] of events) {
    n += 1;
    appendFileSync(logOf(p), `${JSON.stringify({ seq: n, at: "t", actor: "you", type, payload })}\n`);
  }
}
export const card = (id: string, title: string, parent?: string, extra: Payload = {}): Ev => [
  "node.added",
  { id, kind: "card", title, ...(parent === undefined ? {} : { parent }), ...extra },
];
export const decidedCard = (id: string, title: string, parent?: string): Ev[] => [
  card(id, title, parent, { status: "decided", who: "me", no_basis: "top" }),
  ["kill.added", { id, criterion: { form: "revisit" } }],
];
export const link = (from: string, to: string, type: string, why?: string): Ev => [
  "edge.added",
  { from, to, type, ...(why === undefined ? {} : { why }) },
];

export function withMap(events: Ev[]): Project {
  const p = freshProject();
  seed(p, events);
  return p;
}

export async function ok(p: Project, args: string[]) {
  const r = await p.werk(args);
  if (r.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${r.code}: ${r.err}`);
  return r;
}

export function addChat(p: Project, name: string, texts: string[]): void {
  mkdirSync(join(p.dir, ".werk", "chats"), { recursive: true });
  writeFileSync(
    join(p.dir, ".werk", "chats", `${name}.jsonl`),
    `${texts
      .map((t) => JSON.stringify({ speaker: "person", at: "t", session: "6ae61be7", kind: "spoken", text: t }))
      .join("\n")}\n`,
  );
}
