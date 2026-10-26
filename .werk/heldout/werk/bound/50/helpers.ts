// Shared helpers of the held-out tests: a fresh project with a seeded log, run through werk's own harness.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project, type Run } from "../src/test/project.ts";

export type { Project, Run };

export const logOf = (p: Project) => join(p.dir, ".werk", "log.jsonl");

export function lines(p: Project): string[] {
  return readFileSync(logOf(p), "utf8")
    .split("\n")
    .filter((line) => line !== "");
}

export function events(p: Project): { seq: number; type: string; actor: string; payload: Record<string, unknown> }[] {
  return lines(p).map((line) => JSON.parse(line));
}

/** Append raw events to the log, as a person's earlier accepted map would hold them. */
export function seed(p: Project, list: { type: string; payload: object; actor?: string }[]): void {
  let seq = lines(p).length;
  const text = list
    .map((event) =>
      JSON.stringify({ seq: ++seq, at: "2026-10-01T10:00:00.000Z", actor: event.actor ?? "you", ...event }),
    )
    .join("\n");
  appendFileSync(logOf(p), `${text}\n`);
}

export const real = (id: string, title: string, parent?: string) => ({
  type: "node.added",
  payload: parent === undefined ? { id, kind: "card", title } : { id, kind: "card", title, parent },
});

export const decided = (id: string) => ({ type: "node.decided", payload: { id } });

export function project(): Project {
  return freshProject();
}

export async function ok(p: Project, args: string[]): Promise<Run> {
  const run = await p.werk(args);
  if (run.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${run.code}: ${run.err}`);
  return run;
}

/** Write a conversation's chat log beside the decision log. */
export function chat(p: Project, name: string, records: object[]): void {
  const dir = join(p.dir, ".werk", "chats");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.jsonl`), records.map((r) => JSON.stringify(r)).join("\n") + "\n");
}

/** The first line of `werk show`, which carries the kind, the status and the ghost mark. */
export async function head(p: Project, id: string): Promise<string> {
  const run = await p.werk(["show", id]);
  return run.code === 0 ? (run.out.split("\n")[0] as string) : `MISSING(${run.err.trim()})`;
}

const CLI = join(import.meta.dir, "..", "src", "cli.ts");

/** Start `werk serve` on the project and return its base address. The harness stops it at the end of the test. */
export async function serve(p: Project): Promise<string> {
  const proc = p.start(["bun", CLI, "serve", "--port", "0"]);
  const reader = proc.stdout.getReader();
  let out = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) throw new Error(`werk serve ended: ${out}`);
    out += new TextDecoder().decode(value);
    const found = /http:\/\/\S+?\/map/.exec(out);
    if (found !== null) return found[0].replace(/\/map$/, "");
  }
}

/** The card HTML that the map page of `id` shows, or undefined when the map has no such card. */
export async function cardView(base: string, id: string): Promise<string | undefined> {
  const response = await fetch(`${base}/api/card/${encodeURIComponent(id)}`);
  const body = (await response.json()) as { found: boolean; html: string };
  return body.found ? body.html : undefined;
}
