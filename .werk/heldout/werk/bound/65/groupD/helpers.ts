import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../../src/test/project.ts";

export type Payload = Record<string, unknown>;
export type Ev = [type: string, payload: Payload, actor?: string];

export const logOf = (p: Project) => join(p.dir, ".werk", "log.jsonl");
export const lines = (p: Project) =>
  readFileSync(logOf(p), "utf8")
    .split("\n")
    .filter((l) => l !== "");

export function withMap(events: Ev[]): Project {
  const p = freshProject();
  const text = events.map(([type, payload, actor], i) =>
    JSON.stringify({ seq: i + 1, at: "2026-10-01T09:00:00Z", actor: actor ?? "you", type, payload }),
  );
  appendFileSync(logOf(p), `${text.join("\n")}\n`);
  return p;
}

export const card = (id: string, title: string, parent?: string, extra: Payload = {}): Ev => [
  "node.added",
  { id, kind: "card", title, ...(parent === undefined ? {} : { parent }), ...extra },
];
export const link = (from: string, to: string, type: string, why?: string): Ev => [
  "edge.added",
  { from, to, type, ...(why === undefined ? {} : { why }) },
];
export const reopen = (id: string, reason: string): Ev => ["node.reopened", { id, reason }];

export async function ok(p: Project, args: string[]) {
  const run = await p.werk(args);
  if (run.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${run.code}: ${run.out}${run.err}`);
  return run;
}

/** Starts werk serve on a free port and reads the map's shape from it. */
export async function graph(p: Project): Promise<string> {
  const proc = p.start([process.execPath, join(import.meta.dir, "..", "..", "src", "cli.ts"), "serve", "--port", "0"]);
  const reader = proc.stdout.getReader();
  let out = "";
  let url: string | undefined;
  while (url === undefined) {
    const { value, done } = await reader.read();
    if (done) throw new Error(`serve ended: ${out}`);
    out += new TextDecoder().decode(value);
    url = /http:\/\/\S+/.exec(out)?.[0].replace(/\/map$/, "");
  }
  const res = await fetch(`${url}/api/graph?shape=1`);
  const text = await res.text();
  proc.kill();
  return text;
}
