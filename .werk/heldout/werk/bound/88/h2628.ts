import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../src/test/project.ts";
import type { Step } from "../src/test/fake-script.ts";

export type Event = { type: string; payload: Record<string, unknown> };
export const card = (id: string, parent?: string): Event => ({
  type: "node.added",
  payload: { id, kind: "card", title: `Card ${id}`, ...(parent ? { parent } : {}) },
});
export const ghost = (id: string, parent?: string): Event => ({
  type: "node.proposed",
  payload: { id, kind: "card", title: `Ghost ${id}`, ...(parent ? { parent } : {}) },
});
export const decide = (id: string): Event => ({ type: "node.decided", payload: { id } });

export function mapProject(events: Event[]): Project {
  const p = freshProject();
  const lines = events.map((e, i) => JSON.stringify({ seq: i + 1, at: "t", actor: "you", ...e }));
  appendFileSync(join(p.dir, ".werk", "log.jsonl"), `${lines.join("\n")}\n`);
  return p;
}

export const SPEC = (n: number) =>
  `# Spec: the thing\n\n## User stories\n\n${Array.from({ length: n }, (_, i) => `${i + 1}. As a person, I want story ${i + 1}.`).join("\n")}\n\n## Test seams\n\nThe command line.\n`;

export const ticket = (title: string | null, cites: string, blockedBy: string, stories: string, checks = "- `make test`") =>
  `${title === null ? "" : `title: ${title}\n`}cites: ${cites}
blocked_by: ${blockedBy}
stories: ${stories}
touches: login

## What to build

A person logs in.

## Acceptance criteria

- It works.

## Checks

${checks}${checks === "" ? "" : "\n"}`;

export function files(p: Project, folder: string, f: Record<string, string>): void {
  mkdirSync(join(p.dir, folder), { recursive: true });
  for (const [n, t] of Object.entries(f)) writeFileSync(join(p.dir, folder, n), t);
}

export const edit = (path: string, content: string): Step => ({ edit: { path, content } });

export async function withTarget(p: Project): Promise<void> {
  await p.run(["git", "commit", "--allow-empty", "--quiet", "-m", "start"], { cwd: p.target });
  const r = await p.werk(["target", p.target]);
  if (r.code !== 0) throw new Error(r.err);
}
