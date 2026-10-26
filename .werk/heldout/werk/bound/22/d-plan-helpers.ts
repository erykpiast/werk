// Helpers for the held-out plan tests: a project with a decided subtree and scripted writers.
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readBoard, readBoardLog } from "../src/board/log.ts";
import type { Step } from "../src/test/fake-script.ts";
import { freshProject, type Project } from "../src/test/project.ts";

export type Ev = { type: string; payload: Record<string, unknown> };

/** A real card with every fact the contract asks for, then decided. */
export function decidedCard(id: string, parent?: string, extra: Record<string, unknown> = {}): Ev[] {
  return [
    { type: "node.added", payload: { id, kind: "card", title: `Card ${id}`, body: `Body of ${id}.`, who: "you", ...(parent ? { parent } : {}), ...extra } },
    { type: "node.edited", payload: { id, no_basis: "first card", unchallenged: "no rival" } },
    { type: "kill.added", payload: { id, criterion: { form: "revisit" } } },
    { type: "node.decided", payload: { id } },
  ];
}

export function append(p: Project, events: Ev[]): void {
  const log = join(p.dir, ".werk", "log.jsonl");
  const n = readFileSync(log, "utf8").split("\n").filter(Boolean).length;
  const lines = events.map((e, i) => JSON.stringify({ seq: n + i + 1, at: "t", actor: "you", ...e }));
  appendFileSync(log, `${lines.join("\n")}\n`);
}

export function makeProject(events: Ev[]): Project {
  const p = freshProject();
  append(p, events);
  return p;
}

export async function withTarget(p: Project): Promise<void> {
  await p.run(["git", "commit", "--allow-empty", "--quiet", "-m", "start"], { cwd: p.target });
  const r = await p.werk(["target", p.target]);
  if (r.code !== 0) throw new Error(`target failed: ${r.err}`);
}

export const spec = (title: string, stories: number[]) =>
  `# Spec: ${title}\n\n## User stories\n\n${stories.map((n) => `${n}. As a person, I want story ${n}.`).join("\n")}\n\n## Test seams\n\nThe command line.\n`;

export const ticket = (o: { title: string; cites: string; blocked?: string; stories: string; build?: string; acceptance?: boolean }) =>
  `title: ${o.title}
cites: ${o.cites}
blocked_by: ${o.blocked ?? ""}
stories: ${o.stories}
touches: checkout

## What to build

${o.build ?? "A person pays at the checkout."}
${o.acceptance === false ? "" : "\n## Acceptance criteria\n\n- The payment goes through.\n"}
## Checks

- \`make test\`
`;

const edit = (path: string, content: string): Step => ({ edit: { path, content } });

export type WriterReply = { spec: string; specAnswers?: unknown[]; tickets: Record<string, string>; ticketAnswers?: unknown[] };

/** Scripts the writers: reply i plays in plan i. */
export function writers(p: Project, subtree: string, replies: WriterReply[]): void {
  p.script({
    roles: {
      "spec-writer": {
        replies: replies.map((r) => [
          edit(`.werk/specs/${subtree}.md`, r.spec),
          edit(`.werk/specs/${subtree}.spec-answers.json`, JSON.stringify(r.specAnswers ?? [])),
        ]),
      },
      "ticket-writer": {
        replies: replies.map((r) => [
          ...Object.entries(r.tickets).map(([f, t]) => edit(`.werk/tickets/${subtree}/${f}`, t)),
          edit(`.werk/specs/${subtree}.ticket-answers.json`, JSON.stringify(r.ticketAnswers ?? [])),
        ]),
      },
    },
  });
}

export const boardFile = (p: Project) => join(p.dir, ".werk", "board.jsonl");
export const board = (p: Project) => readBoard(boardFile(p));
export const boardEvents = (p: Project) => readBoardLog(boardFile(p)).events;
export const boardRaw = (p: Project) => (existsSync(boardFile(p)) ? readFileSync(boardFile(p), "utf8") : "");

/** Starts `werk serve` in the project and waits for its address line. Returns its stderr reader. */
export async function serve(p: Project): Promise<{ err: () => string; stop: () => void }> {
  const proc = p.start([process.execPath, join(import.meta.dir, "..", "src", "cli.ts"), "serve", "--port", "0"]);
  let out = "";
  let err = "";
  void (async () => {
    for await (const c of proc.stderr) err += new TextDecoder().decode(c);
  })();
  const reader = proc.stdout.getReader();
  const deadline = Date.now() + 30000;
  while (!/http:\/\//.test(out) && Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    out += new TextDecoder().decode(value);
  }
  return { err: () => err, stop: () => proc.kill() };
}

/** Observes the board until `ok` holds or the time runs out (the server's watch runs on its own). */
export async function observe<T>(read: () => T, ok: (v: T) => boolean, ms = 5000): Promise<T> {
  const end = Date.now() + ms;
  let v = read();
  while (!ok(v) && Date.now() < end) {
    await Bun.sleep(100);
    v = read();
  }
  return v;
}
