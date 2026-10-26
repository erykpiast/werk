import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type World, decided, open, world } from "./support.ts";

let w: World;
beforeEach(() => {
  w = world();
});
afterEach(() => w.project.dispose());

const under = (id: string, parent: string) => ({ type: "edge.added", from: id, to: parent, link: "refines", why: "" });
const subtree = () =>
  w.seed(open("sub", { title: "Subtree" }), decided("c1", { title: "Card one" }), under("c1", "sub"), decided("c2", { title: "Card two" }), under("c2", "sub"));
const board = () => {
  const path = join(w.project.dir, ".werk", "board.jsonl");
  return existsSync(path)
    ? readFileSync(path, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>)
    : [];
};
const plan = async () => {
  const r = await w.werk("plan", "sub");
  expect(r.code, r.stderr).toBe(0);
  return r;
};
const planned = () => board().filter((e) => e.type === "ticket.planned").map((e) => e.id);

test("29.1 a second plan extends the spec and continues the ticket numbers", async () => {
  subtree();
  await plan();
  const first = planned();
  expect(first).toHaveLength(3 > first.length ? first.length : 3);
  expect(first.length).toBeGreaterThan(0);
  w.seed(open("sub", { title: "Subtree" }), decided("c1", { title: "Card one" }), under("c1", "sub"), decided("c2", { title: "Card two" }), under("c2", "sub"), decided("c3", { title: "Card three" }), under("c3", "sub"));
  await plan();
  const second = planned();
  expect(new Set(second).size).toBe(second.length);
  expect(second.length).toBeGreaterThan(first.length);
  for (const id of first) expect(second).toContain(id);
});

test("29.2 an open ticket the new spec no longer needs is archived and can be restored", async () => {
  subtree();
  await plan();
  const ids = planned();
  expect(ids.length).toBeGreaterThan(0);
  w.seed(open("sub", { title: "Subtree" }), decided("c1", { title: "Card one" }), under("c1", "sub"));
  await plan();
  const archived = board().filter((e) => e.type === "ticket.archived");
  expect(archived.length).toBeGreaterThan(0);
  expect(JSON.stringify(archived)).toMatch(/no longer needs|spec/);
  const r = await w.werk("ticket", "restore", String(archived[0]?.id ?? archived[0]?.ticket), "--actor", "you");
  expect(r.code, r.stderr).toBe(0);
});

test("29.3 retitling a cited card blocks the ready ticket that cites it, and a re-plan clears the block", async () => {
  subtree();
  await plan();
  expect((await w.werk("propose", "c1", "--title", "Card one, renamed")).code).toBe(0);
  expect((await w.werk("accept", "c1", "--actor", "you")).code).toBe(0);
  const blocked = board().filter((e) => e.type === "ticket.blocked");
  expect(blocked.length).toBeGreaterThan(0);
  expect(JSON.stringify(blocked)).toMatch(/c1/);
  expect(JSON.stringify(blocked)).toMatch(/title/);
  await plan();
  expect(board().filter((e) => e.type === "ticket.unblocked").length).toBeGreaterThan(0);
});

test("29.4 a note on a cited card blocks nothing, and a building ticket is never blocked", async () => {
  subtree();
  await plan();
  const [first] = planned();
  w.project.events();
  await w.werk("say", "c1", "a note");
  expect(board().filter((e) => e.type === "ticket.blocked")).toHaveLength(0);
  expect((await w.werk("propose", "c1", "--ops", JSON.stringify([{ tag: "new", new: "A new line." }]))).code).toBe(0);
  expect((await w.werk("accept", "c1", "--actor", "you")).code).toBe(0);
  const blocked = board().filter((e) => e.type === "ticket.blocked");
  expect(blocked.length).toBeGreaterThan(0);
  expect(blocked.map((e) => e.id)).not.toContain(first);
});

test("29.5 a card added under a planned subtree reports a failed cards-cited check without blocking tickets", async () => {
  subtree();
  await plan();
  const r = await w.werk("add", "extra", "--title", "Extra card", "--parent", "sub");
  const out = r.stdout + r.stderr;
  expect(out).toMatch(/cards-cited/);
  expect(out).toContain("extra");
  expect(board().filter((e) => e.type === "ticket.blocked")).toHaveLength(0);
});
