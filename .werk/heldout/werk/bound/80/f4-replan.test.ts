import { appendFileSync } from "node:fs";
import { expect, test } from "bun:test";
import { appendBoardEvent } from "../src/board/log.ts";
import type { Project } from "../src/test/project.ts";
import { board, boardEvents, boardFile, edit, join, logLines, readFileSync, ticket, withTarget } from "./f4-plan-lib.ts";
import { freshProject } from "../src/test/project.ts";

const SPEC1 = `# Spec

## User stories

1. As a person, I want to pay.
2. As a person, I want a retry.
3. As a person, I want a refund.

## Test seams

The command line.
`;
const SPEC2 = SPEC1.replace("## Test seams", "4. As a person, I want a receipt.\n\n## Test seams");

/** App with fully decided cards, as an accepted map holds them. */
function mkProj(cardIds: string[], bodies: Record<string, string> = {}): Project {
  const p = freshProject();
  const ev: any[] = [{ type: "node.added", payload: { id: "root", kind: "card", title: "Root", status: "decided", who: "me", no_basis: "top" } }];
  for (const id of ["app", ...cardIds]) {
    ev.push({ type: "node.added", payload: { id, kind: "card", title: `Card ${id}`, ...(bodies[id] ? { body: bodies[id] } : {}), parent: id === "app" ? "root" : "app", status: "decided", who: "me", no_basis: "top" } });
  }
  for (const id of ["app", ...cardIds]) ev.push({ type: "kill.added", payload: { id, criterion: { form: "revisit" } } });
  ev.push({ type: "kill.added", payload: { id: "root", criterion: { form: "revisit" } } });
  appendFileSync(join(p.dir, ".werk", "log.jsonl"), `${ev.map((e, i) => JSON.stringify({ seq: i + 1, at: "t", actor: "you", ...e })).join("\n")}\n`);
  return p;
}
const tk = (f: string, t: string) => edit(`.werk/tickets/app/${f}`, t);
const ans = (k: string) => edit(`.werk/specs/app.${k}-answers.json`, "[]");
function script(p: Project, rounds: { spec: string; tickets: Record<string, string> }[]) {
  p.script({
    roles: {
      "spec-writer": { replies: rounds.map((r) => [edit(".werk/specs/app.md", r.spec), ans("spec")]) },
      "ticket-writer": { replies: rounds.map((r) => [...Object.entries(r.tickets).map(([f, t]) => tk(f, t)), ans("ticket")]) },
    },
  });
}
const T1 = { "01.md": ticket("One", "app, app-a", "", "1"), "02.md": ticket("Two", "app-b", "", "2"), "03.md": ticket("Three", "app-c", "", "3") };
const tdir = (p: Project, f: string) => readFileSync(join(p.dir, ".werk", "tickets", "app", f), "utf8");
const bodyOf = (p: Project) => join(p.dir, ".werk", "log.jsonl");

async function serve(p: Project) {
  const proc = p.start([process.execPath, join(import.meta.dir, "..", "src", "cli.ts"), "serve", "--port", "0"]);
  // wait for the first line naming the address
  const reader = proc.stdout.getReader();
  const { value } = await reader.read();
  expect(new TextDecoder().decode(value)).toContain("http://");
  return proc;
}
async function until<T>(f: () => T | undefined, ms = 8000): Promise<T | undefined> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = f();
    if (v) return v;
    await Bun.sleep(50);
  }
  return undefined;
}

test("29.1 second plan extends spec and continues numbers", async () => {
  const p = mkProj(["app-a", "app-b", "app-c"]);
  await withTarget(p);
  script(p, [
    { spec: SPEC1, tickets: T1 },
    { spec: SPEC2, tickets: { "03.md": ticket("Three rewritten", "app-c", "", "3"), "04.md": ticket("Four", "app-d", "", "4") } },
  ]);
  { const r0 = await p.werk(["plan", "app"]); if (r0.code !== 0) console.log(r0.out, r0.err); expect(r0.code).toBe(0); }
  expect(appendBoardEvent(boardFile(p), "ticket.moved", { id: "app/01", to: "building" }).ok).toBe(true);
  expect(appendBoardEvent(boardFile(p), "ticket.moved", { id: "app/02", to: "building" }).ok).toBe(true);
  expect(appendBoardEvent(boardFile(p), "ticket.moved", { id: "app/02", to: "merging" }).ok).toBe(true);
  expect(appendBoardEvent(boardFile(p), "ticket.moved", { id: "app/02", to: "done" }).ok).toBe(true);
  const t1 = tdir(p, "01.md"), t2 = tdir(p, "02.md");
  // new decided card under subtree (as the map holds an accepted card)
  const seq = logLines(p).length;
  appendFileSync(bodyOf(p), `${[
    { seq: seq + 1, at: "t", actor: "you", type: "node.added", payload: { id: "app-d", kind: "card", title: "Card d", parent: "app", status: "decided", who: "me", no_basis: "top" } },
    { seq: seq + 2, at: "t", actor: "you", type: "kill.added", payload: { id: "app-d", criterion: { form: "revisit" } } },
  ].map((e) => JSON.stringify(e)).join("\n")}\n`);
  const r = await p.werk(["plan", "app"]);
  expect(r.err).toBe("");
  expect(r.code).toBe(0);
  const b = board(p);
  expect([...b.tickets.keys()]).toEqual(["app/01", "app/02", "app/03", "app/04"]);
  expect(b.tickets.get("app/01")?.column).toBe("building");
  expect(b.tickets.get("app/02")?.column).toBe("done");
  expect(b.tickets.get("app/03")?.title).toBe("Three rewritten");
  expect(tdir(p, "03.md")).toContain("Three rewritten");
  expect(tdir(p, "01.md")).toBe(t1);
  expect(tdir(p, "02.md")).toBe(t2);
  expect(readFileSync(join(p.dir, ".werk", "specs", "app.md"), "utf8")).toContain("receipt");
  expect(readdirCount(p)).toBe(1);
});
const readdirCount = (p: Project) => require("node:fs").readdirSync(join(p.dir, ".werk", "specs")).filter((f: string) => f.endsWith(".md")).length;

test("29.2 archive not-needed ticket and restore", async () => {
  const p = mkProj(["app-a", "app-b", "app-c"]);
  await withTarget(p);
  script(p, [
    { spec: SPEC1, tickets: T1 },
    { spec: SPEC1.replace("2. As a person, I want a retry.\n", ""), tickets: { "01.md": ticket("One", "app, app-a", "", "1"), "03.md": ticket("Three", "app-c", "", "3") } },
  ]);
  { const r0 = await p.werk(["plan", "app"]); if (r0.code !== 0) console.log(r0.out, r0.err); expect(r0.code).toBe(0); }
  // remove card b (the person removes it)
  const rm = await p.werk(["remove", "app-b", "--actor", "you"]);
  expect(rm.code).toBe(0);
  const r = await p.werk(["plan", "app"]);
  expect(r.err).toBe("");
  expect(r.code).toBe(0);
  const t = board(p).tickets.get("app/02");
  expect(t?.archived).toBe(true);
  expect(r.out).toContain("no longer needs it");
  const arch = boardEvents(p).find((e) => e.type === "ticket.archived") as any;
  expect(arch.payload.reason).toContain("no longer needs it");
  expect((await p.werk(["ticket", "restore", "app/02"])).code).toBe(0);
  const t2 = board(p).tickets.get("app/02");
  expect(t2?.archived).toBe(false);
});

test("29.3 retitle blocks ready ticket, replan clears", async () => {
  const p = mkProj(["app-a", "app-b", "app-c"]);
  await withTarget(p);
  script(p, [{ spec: SPEC1, tickets: T1 }, { spec: SPEC1, tickets: T1 }]);
  { const r0 = await p.werk(["plan", "app"]); if (r0.code !== 0) console.log(r0.out, r0.err); expect(r0.code).toBe(0); }
  expect(board(p).tickets.get("app/01")?.column).toBe("ready");
  const srv = await serve(p);
  const pr = await p.werk(["propose", "app-a", "--title", "A brand new title"]);
  expect(pr.code).toBe(0);
  const ac = await p.werk(["accept", "app-a", "--actor", "you"]);
  expect(ac.err).toBe("");
  expect(ac.code).toBe(0);
  const got = await until(() => (board(p).tickets.get("app/01")?.column === "blocked" ? board(p).tickets.get("app/01") : undefined));
  srv.kill();
  expect(got?.column).toBe("blocked");
  expect(got?.reason).toContain("app-a");
  expect(got?.reason).toContain("title");
  const r = await p.werk(["plan", "app"]);
  expect(r.code).toBe(0);
  expect(board(p).tickets.get("app/01")?.column).toBe("ready");
  expect(board(p).tickets.get("app/01")?.reason ?? "").not.toContain("title changed");
});

test("29.4 note blocks nothing; body change blocks ready only", async () => {
  const p = mkProj(["app-a", "app-b", "app-c"], { "app-a": "Old body." });
  await withTarget(p);
  script(p, [{ spec: SPEC1, tickets: { ...T1, "02.md": ticket("Two", "app-b, app-a", "", "2") } }]);
  { const r0 = await p.werk(["plan", "app"]); if (r0.code !== 0) console.log(r0.out, r0.err); expect(r0.code).toBe(0); }
  expect(appendBoardEvent(boardFile(p), "ticket.moved", { id: "app/02", to: "building" }).ok).toBe(true);
  const srv = await serve(p);
  expect((await p.werk(["say", "app-a", "a note"])).code).toBe(0);
  await Bun.sleep(1000);
  expect(board(p).tickets.get("app/01")).toMatchObject({ column: "ready" });
  expect(board(p).tickets.get("app/01")?.reason).toBeUndefined();
  expect(board(p).tickets.get("app/02")?.column).toBe("building");
  // ticket 01 cites app-a
  const pr = await p.werk(["propose", "app-a", "--ops", JSON.stringify([{ tag: "elaborated", old: "Old body.", new: "New body." }])]);
  expect(pr.err).toBe("");
  const ac = await p.werk(["accept", "app-a", "--actor", "you"]);
  expect(ac.err).toBe("");
  const got = await until(() => (board(p).tickets.get("app/01")?.column === "blocked" ? board(p).tickets.get("app/01") : undefined));
  srv.kill();
  expect(got?.reason).toContain("app-a");
  expect(got?.reason).toContain("body");
  expect(board(p).tickets.get("app/02")?.column).toBe("building");
  expect(board(p).tickets.get("app/02")?.reason).toBeUndefined();
});

test("29.5 new uncited card reports failed check, blocks nothing", async () => {
  const p = mkProj(["app-a", "app-b", "app-c"]);
  await withTarget(p);
  script(p, [{ spec: SPEC1, tickets: T1 }]);
  { const r0 = await p.werk(["plan", "app"]); if (r0.code !== 0) console.log(r0.out, r0.err); expect(r0.code).toBe(0); }
  const proc = p.start([process.execPath, join(import.meta.dir, "..", "src", "cli.ts"), "serve", "--port", "0"]);
  const out = new Response(proc.stderr).text();
  await Bun.sleep(1000);
  const a = await p.werk(["add", "app-new", "--title", "New card", "--parent", "app", "--who", "me"]);
  expect(a.code).toBe(0);
  expect((await p.werk(["kill", "app-new", "--revisit"])).code).toBe(0);
  expect((await p.werk(["edit", "app-new", "--no-basis", "top"])).code).toBe(0);
  expect((await p.werk(["accept", "app-new", "--actor", "you"])).code).toBe(0);
  const d = await p.werk(["status", "app-new", "decided"]);
  expect(d.err).toBe("");
  await until(() => undefined, 1500);
  proc.kill();
  const err = await out;
  expect(err).toContain("cards-cited");
  expect(err).toContain("app-new");
  for (const t of board(p).tickets.values()) {
    expect(t.column).toBe("ready");
    expect(t.reason).toBeUndefined();
  }
}, 30000);
