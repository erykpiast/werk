import { expect, test } from "bun:test";
import { appendFileSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { appendBoardEvent, readBoard } from "../src/board/log.ts";
import { readMap } from "../src/map/store.ts";
import { currentWerkArgv } from "../src/own/running.ts";
import type { Step } from "../src/test/fake-script.ts";
import { freshProject, type Project } from "../src/test/project.ts";

const spec = (stories: [number, string][]) =>
  `# Spec: s\n\n## User stories\n\n${stories.map(([n, t]) => `${n}. As a person, I want ${t}.`).join("\n")}\n\n## Test seams\n\nThe command line.\n`;
const ticket = (title: string, cites: string, blockedBy: string, stories: string) => `title: ${title}
cites: ${cites}
blocked_by: ${blockedBy}
stories: ${stories}
touches: x

## What to build

A person does it.

## Acceptance criteria

- It works.

## Checks

- \`make test\`
`;
const edit = (path: string, content: string): Step => ({ edit: { path, content } });
type Ev = { type: string; payload: Record<string, unknown> };
const card = (id: string, parent?: string, extra: Record<string, unknown> = {}): Ev => ({
  type: "node.added",
  payload: { id, kind: "card", title: `Card ${id}`, ...(parent ? { parent } : {}), ...extra },
});
const decided = (id: string): Ev => ({ type: "node.decided", payload: { id } });
const logFile = (p: Project) => join(p.dir, ".werk", "log.jsonl");
function seed(p: Project, events: Ev[]) {
  const seq = readMap("t", logFile(p)).lastSeq;
  appendFileSync(logFile(p), `${events.map((e, i) => JSON.stringify({ seq: seq + i + 1, at: "t", actor: "you", ...e })).join("\n")}\n`);
}
async function withTarget(p: Project) {
  await p.run(["git", "commit", "--allow-empty", "--quiet", "-m", "start"], { cwd: p.target });
  expect((await p.werk(["target", p.target])).code).toBe(0);
}
const bf = (p: Project) => join(p.dir, ".werk", "board.jsonl");
const board = (p: Project) => readBoard(bf(p));
const files = (f: Record<string, string>) => Object.entries(f).map(([n, t]) => edit(`.werk/tickets/app/${n}`, t));
const noAns = (k: string) => edit(`.werk/specs/app.${k}-answers.json`, "[]");

const T3 = {
  "01.md": ticket("One", "app, app-a", "", "1"),
  "02.md": ticket("Two", "app-b", "", "2"),
  "03.md": ticket("Three", "app-c", "1", "3"),
};
const S3 = spec([[1, "one"], [2, "two"], [3, "three"]]);
function base(): Project {
  const p = freshProject();
  const full = { status: "decided", who: "me", no_basis: "x" };
  const kill = (id: string): Ev => ({ type: "kill.added", payload: { id, criterion: { form: "revisit" } } });
  seed(p, [
    card("app", undefined, { ...full, body: "Old body." }), kill("app"),
    card("app-a", "app", { ...full, body: "A body." }), kill("app-a"),
    card("app-b", "app", full), kill("app-b"),
    card("app-c", "app", full), kill("app-c"),
  ]);
  return p;
}
function script(p: Project, plans: { spec: string; tickets: Record<string, string> }[]) {
  p.script({
    roles: {
      "spec-writer": { replies: plans.map((x) => [edit(".werk/specs/app.md", x.spec), noAns("spec")]) },
      "ticket-writer": { replies: plans.map((x) => [...files(x.tickets), noAns("ticket")]) },
    },
  });
}
async function plan(p: Project) {
  const r = await p.werk(["plan", "app"]);
  if (r.code !== 0) console.log("PLAN", r);
  return r;
}

type Server = { err: () => string; stop: () => Promise<void> };
async function serve(p: Project): Promise<Server> {
  const proc = p.start([...currentWerkArgv(), "serve", "--port", "0"]);
  let err = "";
  void (async () => { for await (const c of proc.stderr) err += new TextDecoder().decode(c); })();
  let out = "";
  const reader = proc.stdout.getReader();
  while (!out.includes("/map")) {
    const { value, done } = await reader.read();
    if (done) break;
    out += new TextDecoder().decode(value);
  }
  return { err: () => err, stop: async () => { proc.kill("SIGTERM"); await proc.exited; } };
}
async function until(f: () => boolean, ms = 8000) {
  for (let i = 0; i < ms / 50 && !f(); i++) await Bun.sleep(50);
}
const cols = (p: Project) => [...board(p).tickets.values()].map((t) => `${t.id}:${t.column}${t.archived ? ":archived" : ""}`);

test("29.1 second plan extends spec and numbering", async () => {
  const p = base();
  await withTarget(p);
  script(p, [
    { spec: S3, tickets: T3 },
    { spec: spec([[1, "one"], [2, "two"], [3, "three"], [4, "four"]]) + "\nNew card app-d.\n", tickets: { "03.md": ticket("Three rewritten", "app-c", "1", "3"), "04.md": ticket("Four", "app-d", "1", "4") } },
  ]);
  expect((await plan(p)).code).toBe(0);
  appendBoardEvent(bf(p), "ticket.moved", { id: "app/01", to: "building" });
  for (const to of ["building", "merging", "done"] as const) appendBoardEvent(bf(p), "ticket.moved", { id: "app/02", to: to });
  seed(p, [card("app-d", "app"), decided("app-d")]);
  const r = await plan(p);
  expect(r.code).toBe(0);
  expect(readdirSync(join(p.dir, ".werk", "specs")).filter((f) => f.endsWith(".md"))).toEqual(["app.md"]);
  expect(readFileSync(join(p.dir, ".werk", "specs", "app.md"), "utf8")).toContain("app-d");
  const t = board(p).tickets;
  expect([...t.keys()]).toEqual(["app/01", "app/02", "app/03", "app/04"]);
  expect(t.get("app/03")?.title).toBe("Three rewritten");
  expect(t.get("app/01")).toMatchObject({ column: "building", title: "One" });
  expect(t.get("app/02")).toMatchObject({ column: "done", title: "Two" });
});

test("29.2 unneeded ticket archived and restorable", async () => {
  const p = base();
  await withTarget(p);
  script(p, [
    { spec: S3, tickets: T3 },
    { spec: spec([[1, "one"], [3, "three"]]), tickets: { "03.md": T3["03.md"] } },
  ]);
  expect((await plan(p)).code).toBe(0);
  const rm = await p.werk(["remove", "app-b", "--actor", "you"]);
  expect(rm.code).toBe(0);
  const r = await plan(p);
  console.log(r.out, r.err);
  const t = board(p).tickets.get("app/02");
  expect(t?.archived).toBe(true);
  expect(t?.archiveReason).toBe("the current spec of #app no longer needs it");
  const rs = await p.werk(["ticket", "restore", "app/02"]);
  expect(rs.code).toBe(0);
  expect(board(p).tickets.get("app/02")).toMatchObject({ archived: false, column: "ready" });
});

test("29.3 retitle blocks ready ticket; re-plan clears", async () => {
  const p = base();
  await withTarget(p);
  script(p, [
    { spec: S3, tickets: T3 },
    { spec: S3, tickets: { "01.md": ticket("One", "app, app-a", "", "1"), "02.md": ticket("Two uses Better title", "app-b", "1", "2") } },
  ]);
  expect((await plan(p)).code).toBe(0);
  const s = await serve(p);
  try {
    const pr = await p.werk(["propose", "app-b", "--title", "Better title"]);
    expect(pr.code).toBe(0);
    const ac = await p.werk(["accept", "app-b", "--actor", "you"]);
    console.log("ACCEPT", ac);
    expect(ac.code).toBe(0);
    await until(() => board(p).tickets.get("app/02")?.column === "blocked");
    const t = board(p).tickets.get("app/02");
    console.log(t, s.err());
    expect(t?.column).toBe("blocked");
    expect(t?.reason).toContain("app-b");
    expect(t?.reason).toMatch(/title/);
    expect((await plan(p)).code).toBe(0);
    await Bun.sleep(500);
    const t2 = board(p).tickets.get("app/02");
    console.log(t2, cols(p));
    expect(t2?.column).not.toBe("blocked");
    expect(readFileSync(join(p.dir, ".werk", "tickets", "app", "02.md"), "utf8")).toContain("Better title");
  } finally { await s.stop(); }
});

test("29.4 note blocks nothing; body change blocks ready only", async () => {
  const p = base();
  await withTarget(p);
  script(p, [{ spec: S3, tickets: { "01.md": ticket("One", "app, app-a", "", "1"), "02.md": ticket("Two", "app-a, app-b", "", "2"), "03.md": ticket("Three", "app-c", "", "3") } }]);
  expect((await plan(p)).code).toBe(0);
  appendBoardEvent(bf(p), "ticket.moved", { id: "app/01", to: "building" });
  const s = await serve(p);
  try {
    expect((await p.werk(["say", "app-a", "a note"])).code).toBe(0);
    await Bun.sleep(1500);
    expect(cols(p)).toEqual(["app/01:building", "app/02:ready", "app/03:ready"]);
    expect(board(p).tickets.get("app/02")?.reason).toBeUndefined();
    expect(board(p).tickets.get("app/01")?.reason).toBeUndefined();
    const pr = await p.werk(["propose", "app-a", "--ops", JSON.stringify([{ tag: "elaborated", old: "A body.", new: "A new body." }])]);
    console.log("PROPOSE", pr);
    expect(pr.code).toBe(0);
    const ac = await p.werk(["accept", "app-a", "--actor", "you"]);
    expect(ac.code).toBe(0);
    await until(() => board(p).tickets.get("app/02")?.column === "blocked");
    await Bun.sleep(500);
    const t2 = board(p).tickets.get("app/02");
    console.log(t2);
    expect(t2?.column).toBe("blocked");
    expect(t2?.reason).toContain("app-a");
    expect(t2?.reason).toMatch(/body/);
    expect(board(p).tickets.get("app/01")).toMatchObject({ column: "building" });
    expect(board(p).tickets.get("app/01")?.reason).toBeUndefined();
  } finally { await s.stop(); }
});

test("29.5 new uncited card reports failed check, blocks nothing", async () => {
  const p = base();
  await withTarget(p);
  script(p, [{ spec: S3, tickets: { "01.md": ticket("One", "app, app-a", "", "1"), "02.md": ticket("Two", "app-b", "1", "2"), "03.md": ticket("Three", "app-c", "1", "3") } }]);
  expect((await plan(p)).code).toBe(0);
  const s = await serve(p);
  try {
    const add = await p.werk(["add", "app-new", "--title", "New", "--why", "w", "--parent", "app"]);
    console.log("ADD", add);
    await Bun.sleep(1200);
    console.log("ERR after ghost add:", s.err());
    seed(p, [card("app-new2", "app"), decided("app-new2")]);
    await until(() => s.err().includes("app-new2"));
    console.log("ERR:", s.err());
    expect(s.err()).toMatch(/cards-cited[^\n]*app-new2/);
    expect(cols(p)).toEqual(["app/01:ready", "app/02:ready", "app/03:ready"]);
    for (const t of board(p).tickets.values()) expect(t.reason).toBeUndefined();
  } finally { await s.stop(); }
});
