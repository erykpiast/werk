import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { readBoard, readBoardLog } from "../src/board/log.ts";
import { readMap } from "../src/map/store.ts";
import type { Step } from "../src/test/fake-script.ts";
import { freshProject, type Project } from "../src/test/project.ts";

export type CardSpec = { id: string; parent?: string; body?: string; open?: boolean };
export type Edge = { from: string; to: string };

export const edit = (path: string, content: string): Step => ({ edit: { path, content } });

/** A project whose map holds the given cards (decided unless open) and depends_on links. */
export function mapProject(cards: CardSpec[], edges: Edge[] = []): Project {
  const p = freshProject();
  const events: { type: string; payload: Record<string, unknown> }[] = [
    { type: "node.added", payload: { id: "root", kind: "card", title: "Card root" } },
    ...cards.map((c) => ({
      type: "node.added",
      payload: { id: c.id, kind: "card", title: `Card ${c.id}`, parent: c.parent ?? "root", ...(c.body ? { body: c.body } : {}) },
    })),
    { type: "node.decided", payload: { id: "root" } },
    ...cards.filter((c) => !c.open).map((c) => ({ type: "node.decided", payload: { id: c.id } })),
    ...edges.map((e) => ({ type: "edge.added", payload: { from: e.from, to: e.to, type: "depends_on", why: "needs it" } })),
  ];
  const lines = events.map((e, i) => JSON.stringify({ seq: i + 1, at: "t", actor: "you", ...e }));
  appendFileSync(join(p.dir, ".werk", "log.jsonl"), `${lines.join("\n")}\n`);
  return p;
}

export async function withTarget(p: Project): Promise<void> {
  await p.run(["git", "commit", "--allow-empty", "--quiet", "-m", "start"], { cwd: p.target });
  const r = await p.werk(["target", p.target]);
  if (r.code !== 0) throw new Error(r.err);
}

export const specText = (stories: string[]) =>
  `# Spec\n\n## User stories\n\n${stories.map((s, i) => `${i + 1}. ${s}`).join("\n")}\n\n## Test seams\n\nThe command line.\n`;

export const ticket = (title: string, cites: string, blockedBy: string, stories: string, checks = "- `make test`") => `title: ${title}
cites: ${cites}
blocked_by: ${blockedBy}
stories: ${stories}
touches: x

## What to build

A person does it.

## Acceptance criteria

- It works.

## Checks

${checks}
`;

export const board = (p: Project) => readBoard(join(p.dir, ".werk", "board.jsonl"));
export const boardEvents = (p: Project) => readBoardLog(join(p.dir, ".werk", "board.jsonl")).events;
export const mapOf = (p: Project) => readMap("heldout", join(p.dir, ".werk", "log.jsonl"));
export const mapLog = (p: Project) => join(p.dir, ".werk", "log.jsonl");
export const boardFile = (p: Project) => join(p.dir, ".werk", "board.jsonl");

export function rawAppend(p: Project, events: { type: string; payload: Record<string, unknown> }[]): void {
  const seq = mapOf(p).lastSeq;
  const lines = events.map((e, i) => JSON.stringify({ seq: seq + i + 1, at: "t", actor: "you", ...e }));
  appendFileSync(mapLog(p), `${lines.join("\n")}\n`);
}

/** Script the two writers of subtree `s`: one reply each, or several for several plans. */
export function writers(
  p: Project,
  s: string,
  plans: { spec: string; tickets: Record<string, string>; specAnswers?: unknown[]; ticketAnswers?: unknown[] }[],
): void {
  p.script({
    roles: {
      "spec-writer": {
        replies: plans.map((pl) => [
          edit(`.werk/specs/${s}.md`, pl.spec),
          edit(`.werk/specs/${s}.spec-answers.json`, JSON.stringify(pl.specAnswers ?? [])),
        ]),
      },
      "ticket-writer": {
        replies: plans.map((pl) => [
          ...Object.entries(pl.tickets).map(([f, t]) => edit(`.werk/tickets/${s}/${f}`, t)),
          edit(`.werk/specs/${s}.ticket-answers.json`, JSON.stringify(pl.ticketAnswers ?? [])),
        ]),
      },
    },
  });
}

export const answer = (slug: string) => ({ slug, title: `Answer ${slug}`, why: `Why ${slug}?`, body: `Body ${slug}.` });
