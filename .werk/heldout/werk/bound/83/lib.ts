// Helpers of the held-out tests: seed a project's log, read it, and run werk commands.
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project, type Run } from "../src/test/project.ts";

export { freshProject };
export type { Project, Run };

export const logFile = (p: Project) => join(p.dir, ".werk", "log.jsonl");
export const logLines = (p: Project) =>
  readFileSync(logFile(p), "utf8")
    .split("\n")
    .filter((l) => l !== "");
export const logEvents = (p: Project) => logLines(p).map((l) => JSON.parse(l));

type Ev = { type: string; payload: Record<string, unknown>; actor?: string };

/** Append raw events to the log, as a person's earlier work would have. */
export function seed(p: Project, events: Ev[]): void {
  let seq = logLines(p).length;
  appendFileSync(
    logFile(p),
    events.map((e) => `${JSON.stringify({ seq: ++seq, at: "2026-01-01T00:00:00Z", actor: "you", ...e })}\n`).join(""),
  );
}

export const real = (id: string, parent: string | undefined, extra: Record<string, unknown> = {}): Ev => ({
  type: "node.added",
  payload: { id, kind: "card", title: extra.title ?? id, ...(parent ? { parent } : {}), ...extra },
});

/** A map with a decided root, and the extra events given. */
export function withRoot(extra: Ev[] = []): Project {
  const p = freshProject();
  seed(p, [
    real("root", undefined, { title: "Root", status: "decided", who: "me", no_basis: "the top" }),
    { type: "kill.added", payload: { id: "root", criterion: { form: "revisit" } } },
    ...extra,
  ]);
  return p;
}

export async function ok(p: Project, args: string[]): Promise<Run> {
  const r = await p.werk(args);
  if (r.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${r.code}: ${r.err}${r.out}`);
  return r;
}

export const show = async (p: Project, id: string) => (await p.werk(["show", id])).out + (await p.werk(["show", id])).err;

import { mkdirSync, writeFileSync } from "node:fs";

export type ChatIn = { speaker?: string; at?: string; session?: string; kind?: string; text: string };

/** Write the chat log of a conversation. */
export function chat(p: Project, name: string, lines: ChatIn[]): void {
  mkdirSync(join(p.dir, ".werk", "chats"), { recursive: true });
  writeFileSync(
    join(p.dir, ".werk", "chats", `${name}.jsonl`),
    lines
      .map((l) =>
        JSON.stringify({ speaker: "user", at: "2026-02-02T10:00:00Z", session: "sess-1", kind: "spoken", ...l }),
      )
      .join("\n") + "\n",
  );
}

/** show output, out and err together. */
export async function shown(p: Project, id: string): Promise<{ code: number; text: string }> {
  const r = await p.werk(["show", id]);
  return { code: r.code, text: r.out + r.err };
}
