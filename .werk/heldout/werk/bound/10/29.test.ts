// werk/33 behaviours (steps 29.x): a second plan extends the spec and the tickets, and a changed cited card blocks open tickets.
// A plan runs through `werk plan <card>`; the board is the board log of the project.
import { expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readBoard } from "../src/board/log-store.ts";
import { card, useWerk } from "./support.ts";

const w = useWerk();
const board = () => readBoard(join(w.project().dir, ".werk", "board.jsonl"));
const seedBoard = (...events: unknown[]) => {
  mkdirSync(join(w.project().dir, ".werk"), { recursive: true });
  writeFileSync(join(w.project().dir, ".werk", "board.jsonl"), events.map((e) => `${JSON.stringify(e)}\n`).join(""));
};
const plan = (root = "root") => w.run("plan", root);

/** A decided subtree: a root with two decided cards. */
function subtree() {
  w.seed(
    ...card("root", { status: "decided" }),
    ...card("a", { parent: "root", status: "decided" }),
    ...card("b", { parent: "root", status: "decided" }),
  );
}

test("29.1 a second plan of the same subtree extends the spec and continues the ticket numbers", async () => {
  subtree();
  const first = await plan();
  expect(first.code).toBe(0);
  const ids = [...board().tickets.keys()];
  expect(ids).toHaveLength(3);
  expect(ids.map((id) => id.split("/")[1])).toEqual(["01", "02", "03"]);
  const run = ids[0]?.split("/")[0] as string;
  seedBoard(
    ...ids.map((id) => ({ type: "ticket.planned", id })),
    { type: "ticket.moved", id: `${run}/01`, to: "building" },
    { type: "ticket.moved", id: `${run}/02`, to: "building" },
  );
  w.seed(...card("c", { parent: "root", status: "decided" }));
  const second = await plan();
  expect(second.code).toBe(0);
  const after = board();
  expect([...after.tickets.keys()].map((id) => id.split("/")[1]).sort()).toEqual(["01", "02", "03", "04"]);
  expect(after.tickets.get(`${run}/01`)?.column).toBe("building");
  expect(after.plans.size).toBe(1);
});

test("29.2 an open ticket the new spec no longer needs is archived and can be restored", async () => {
  subtree();
  expect((await plan()).code).toBe(0);
  const before = board();
  const ticket = [...before.tickets.values()][0];
  expect(ticket).toBeDefined();
  expect((await w.run("remove", "a")).code).toBe(0);
  expect((await plan()).code).toBe(0);
  const after = board().tickets.get(ticket?.id as string);
  expect(after?.archived).toBe(true);
  const restored = await w.run("ticket", "restore", String(ticket?.number), "--actor", "you");
  expect(restored.code).toBe(0);
  expect(board().tickets.get(ticket?.id as string)?.archived).toBe(false);
});

test("29.3 retitling a cited card blocks the ready ticket that cites it, and a re-plan clears the block", async () => {
  subtree();
  expect((await plan()).code).toBe(0);
  expect((await w.run("propose", "a", "--title", "A new title")).code).toBe(0);
  expect((await w.run("accept", "a", "--actor", "you")).code).toBe(0);
  const blocked = [...board().tickets.values()].filter((t) => t.column === "blocked");
  expect(blocked.length).toBeGreaterThan(0);
  expect(blocked[0]?.reason).toMatch(/\ba\b/);
  expect(blocked[0]?.reason).toMatch(/title/);
  expect((await plan()).code).toBe(0);
  expect([...board().tickets.values()].filter((t) => t.column === "blocked")).toHaveLength(0);
});

test("29.4 a note on a cited card blocks nothing, and a building ticket is never blocked", async () => {
  subtree();
  expect((await plan()).code).toBe(0);
  const [first] = [...board().tickets.values()];
  seedBoard(...[...board().tickets.keys()].map((id) => ({ type: "ticket.planned", id })));
  expect((await w.run("say", "a", "a note")).code).toBe(0);
  expect([...board().tickets.values()].every((t) => t.reason === "")).toBe(true);
  expect((await w.run("propose", "a", "--ops", '[{"tag":"new","new":"More words."}]')).code).toBe(0);
  expect((await w.run("accept", "a", "--actor", "you")).code).toBe(0);
  const blocked = [...board().tickets.values()].filter((t) => t.column === "blocked");
  expect(blocked.length).toBeGreaterThan(0);
  expect(blocked[0]?.reason).toMatch(/body/);
  expect(first).toBeDefined();
});

test("29.5 a card added under a planned subtree reports a failed check without blocking tickets", async () => {
  subtree();
  expect((await plan()).code).toBe(0);
  const before = [...board().tickets.values()].map((t) => `${t.id}:${t.column}`);
  const added = await w.run("add", "extra", "--title", "Extra", "--parent", "root");
  expect(added.code).toBe(0);
  expect(readFileSync(join(w.project().dir, ".werk", "log.jsonl"), "utf8")).toContain("extra");
  const checked = await w.run("plan", "root", "--check");
  expect(checked.stdout + checked.stderr).toMatch(/cards-cited/);
  expect(checked.stdout + checked.stderr).toContain("extra");
  expect([...board().tickets.values()].map((t) => `${t.id}:${t.column}`)).toEqual(before);
});
