import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readBoard, readBoardLog } from "../src/board/log.ts";
import type { Step } from "../src/test/fake-script.ts";
import { freshProject, type Project } from "../src/test/project.ts";

export const SPEC = `# Spec: checkout

## User stories

1. As a person, I want to pay.
2. As a person, I want a retry.

## Test seams

The command line.
`;

export const ticket = (title: string, cites: string, blockedBy: string, stories: string, checks = "- `make test`") => `title: ${title}
cites: ${cites}
blocked_by: ${blockedBy}
stories: ${stories}
touches: pay

## What to build

A person pays.

## Acceptance criteria

- It works.

## Checks

${checks}
`;

export type Ev = { type: string; payload: Record<string, unknown> };
export const edit = (path: string, content: string): Step => ({ edit: { path, content } });

/** cards: [id, parent] all decided. extra events appended. */
export function proj(cards: [string, string | undefined][], extra: Ev[] = [], deps: [string, string][] = []): Project {
  const p = freshProject();
  const events: Ev[] = [
    { type: "node.added", payload: { id: "root", kind: "card", title: "Root" } },
    ...cards.map(([id, parent]) => ({
      type: "node.added",
      payload: { id, kind: "card", title: `Card ${id}`, parent: parent ?? "root" },
    })),
    ...cards.map(([id]) => ({ type: "node.decided", payload: { id } })),
    ...deps.map(([from, to]) => ({ type: "edge.added", payload: { from, to, type: "depends_on", why: "needs it" } })),
    ...extra,
  ];
  appendFileSync(
    join(p.dir, ".werk", "log.jsonl"),
    `${events.map((e, i) => JSON.stringify({ seq: i + 1, at: "t", actor: "you", ...e })).join("\n")}\n`,
  );
  return p;
}

export async function withTarget(p: Project): Promise<void> {
  await p.run(["git", "commit", "--allow-empty", "--quiet", "-m", "start"], { cwd: p.target });
  const r = await p.werk(["target", p.target]);
  if (r.code !== 0) throw new Error(r.err);
}

export const boardFile = (p: Project) => join(p.dir, ".werk", "board.jsonl");
export const board = (p: Project) => readBoard(boardFile(p));
export const boardEvents = (p: Project) => readBoardLog(boardFile(p)).events;
export const logLines = (p: Project) => readFileSync(join(p.dir, ".werk", "log.jsonl"), "utf8").split("\n").filter(Boolean);
export { readFileSync, join };
