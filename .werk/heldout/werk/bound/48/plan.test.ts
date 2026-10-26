import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { card, setupWerk } from "./support.ts";

const { werk, seed, boardPath, logLines } = setupWerk();

const board = () =>
  readFileSync(boardPath(), "utf8")
    .split("\n")
    .filter((l) => l !== "")
    .map((l) => JSON.parse(l) as Record<string, unknown>);

async function plan() {
  const r = await werk("plan", "root");
  expect(r.stderr).not.toContain("unknown verb");
  expect(r.code).toBe(0);
}

function subtree() {
  seed(
    card("root", { title: "Root", status: "decided" }),
    card("a", { title: "Card A", status: "decided", parent: "root" }),
    card("b", { title: "Card B", status: "decided", parent: "root" }),
  );
}

test("29.1 a second plan of the same subtree extends the spec and continues the ticket numbers", async () => {
  subtree();
  await plan();
  const first = board().filter((e) => e.type === "ticket.planned");
  expect(first.length).toBeGreaterThan(0);
  seed(card("c", { title: "Card C", status: "decided", parent: "root" }));
  await plan();
  const all = board().filter((e) => e.type === "ticket.planned");
  const ids = all.map((e) => String(e.id));
  expect(new Set(ids).size).toBe(ids.length);
  expect(all.length).toBeGreaterThan(first.length);
});

test("29.2 an open ticket the new spec no longer needs is archived and can be restored", async () => {
  subtree();
  await plan();
  seed([{ type: "node.removed", id: "b" }]);
  await plan();
  const archived = board().filter((e) => e.type === "ticket.archived");
  expect(archived).toHaveLength(1);
  const id = String(archived[0]?.id);
  const r = await werk("ticket", "restore", id.split("/")[1] as string);
  expect(r.code).toBe(0);
});

test("29.3 retitling a cited card blocks the ready ticket that cites it, and a re-plan clears the block", async () => {
  subtree();
  await plan();
  const r = await werk("propose", "a", "--title", "A new title");
  expect(r.code).toBe(0);
  await werk("accept", "a", "--actor", "you");
  const moves = board().filter(
    (e) => e.type === "ticket.moved" && e.to === "blocked",
  );
  expect(moves.length).toBeGreaterThan(0);
  expect(String(moves[0]?.reason)).toContain("title");
  await plan();
  expect(
    board().filter((e) => e.type === "ticket.moved" && e.to === "ready").length,
  ).toBeGreaterThan(0);
});

test("29.4 a note on a cited card blocks nothing, and a building ticket is never blocked", async () => {
  subtree();
  await plan();
  const before = board().length;
  expect((await werk("say", "a", "just a note")).code).toBe(0);
  expect(board()).toHaveLength(before);
  expect(logLines().length).toBeGreaterThan(0);
  const r = await werk("propose", "a", "--why", "a different why");
  expect(r.code).toBe(0);
  await werk("accept", "a", "--actor", "you");
  const moves = board().filter(
    (e) => e.type === "ticket.moved" && e.to === "blocked",
  );
  expect(moves.length).toBeGreaterThan(0);
  expect(String(moves[0]?.reason)).toMatch(/body|why/);
});

test("29.5 a card added under a planned subtree reports a failed check without blocking tickets", async () => {
  subtree();
  await plan();
  const before = board().length;
  expect(
    (await werk("add", "new", "--title", "New card", "--parent", "root")).code,
  ).toBe(0);
  await werk("accept", "new", "--actor", "you");
  const check = await werk("plan", "root", "--check");
  expect(check.stdout + check.stderr).toContain("cards-cited");
  expect(check.stdout + check.stderr).toContain("new");
  expect(board()).toHaveLength(before);
});
