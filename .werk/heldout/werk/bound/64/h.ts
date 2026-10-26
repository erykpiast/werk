import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fold, parseLog } from "../src/map/fold.ts";
import { createProject, type Project } from "../src/test-env/project.ts";

export { createProject, type Project };
export const ROOT = join(import.meta.dir, "..");
export const CLI = join(ROOT, "src", "cli.ts");

export const werk = (p: Project, ...args: string[]) =>
  p.run(["bun", CLI, ...args]);

/** Appends events to the project's log as hand-written lines. */
export function seed(p: Project, ...events: unknown[]): void {
  mkdirSync(dirname(p.logPath), { recursive: true });
  appendFileSync(
    p.logPath,
    events
      .flat()
      .map((e) => `${typeof e === "string" ? e : JSON.stringify(e)}\n`)
      .join(""),
  );
}

export function problems(p: Project) {
  return fold(parseLog(readFileSync(p.logPath, "utf8"))).problems;
}

export const logText = (p: Project) => readFileSync(p.logPath, "utf8");

export const out = (r: { stdout: string; stderr: string }) =>
  `${r.stdout}\n${r.stderr}`;

import { writeFileSync } from "node:fs";

export const accepted = (id: string) => ({
  type: "node.accepted",
  id,
  actor: "you",
});

/** A real card with status decided, written by hand: no contract check ran. */
export function realDecided(id: string, extra: Record<string, unknown> = {}) {
  return [
    {
      type: "node.proposed",
      id,
      kind: "card",
      title: `Title ${id}`,
      status: "decided",
      ...extra,
    },
    accepted(id),
  ];
}

export function chat(p: Project, name: string, ...lines: unknown[]) {
  const dir = join(p.dir, ".werk", "chats");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${name}.jsonl`),
    lines
      .map((l) => `${typeof l === "string" ? l : JSON.stringify(l)}\n`)
      .join(""),
  );
}

export const spoken = (text: string, extra: Record<string, unknown> = {}) => ({
  speaker: "person",
  at: "10:02",
  session: "6ae61be7",
  kind: "spoken",
  text,
  ...extra,
});

export const boardPath = (p: Project) => join(p.dir, ".werk", "board.jsonl");

export function seedBoard(p: Project, ...events: unknown[]): void {
  mkdirSync(join(p.dir, ".werk"), { recursive: true });
  appendFileSync(
    boardPath(p),
    events.flat().map((e) => `${JSON.stringify(e)}\n`).join(""),
  );
}

export const boardText = (p: Project) => readFileSync(boardPath(p), "utf8");
export const boardEvents = (p: Project) =>
  boardText(p)
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));

export const planned = (id: string, extra: Record<string, unknown> = {}) => ({
  type: "ticket.planned",
  id,
  title: `Ticket ${id}`,
  ...extra,
});

/** A ticket taken through ready, building, merging to done. */
export const doneTicket = (id: string) => [
  planned(id),
  { type: "ticket.moved", id, to: "building", actor: "loop" },
  { type: "ticket.moved", id, to: "merging", actor: "loop" },
  { type: "ticket.merge", id },
];

import { createServer } from "node:net";

export async function freePort(): Promise<number> {
  return await new Promise((res, rej) => {
    const s = createServer();
    s.once("error", rej);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as { port: number };
      s.close(() => res(port));
    });
  });
}

/** Starts `werk serve` in the project and waits until it answers. */
export async function startServer(p: Project, env: Record<string, string> = {}) {
  const port = await freePort();
  const child = p.start(["bun", CLI, "serve", "--port", String(port)], env);
  const origin = `http://127.0.0.1:${port}`;
  const end = Date.now() + 60000;
  for (;;) {
    const ok = await fetch(`${origin}/api/projects`).then((r) => r.ok, () => false);
    if (ok) break;
    if (Date.now() > end || child.exitCode !== null) throw new Error("server did not start");
    await Bun.sleep(100);
  }
  return { port, origin, child };
}

export async function until(check: () => boolean | Promise<boolean>, ms = 30000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return true;
    await Bun.sleep(100);
  }
  return false;
}
