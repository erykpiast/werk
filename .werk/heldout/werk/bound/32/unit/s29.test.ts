import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { expect, test } from "bun:test";
import { readBoard } from "../../src/board/log-store.ts";
import { ticket } from "../../src/tickets/fixtures.ts";
import { werkHarness } from "./h.ts";

const { project, werk, must, decide } = werkHarness();

const store = () => dirname(project().logPath);
const boardPath = () => join(store(), "board.jsonl");
const board = () => readBoard(boardPath());
const seed = (...events: Record<string, unknown>[]) => {
  for (const e of events) appendFileSync(boardPath(), `${JSON.stringify(e)}\n`);
};

/** A planned subtree "sub" with a decided card "c1"; tickets 1..n on the board, ready, citing c1. */
async function planned(n = 3, cites = ["c1"]) {
  await decide("sub", { title: "Subtree" });
  await decide("c1", { parent: "sub", title: "Cited card" });
  const dir = join(store(), "tickets", "sub");
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(store(), "specs", "sub"), { recursive: true });
  writeFileSync(join(store(), "specs", "sub", "spec.md"), "# Spec\n\n## User stories\n\n1. A story\n");
  seed({ type: "plan.started", plan: "sub", pid: process.pid });
  for (let i = 1; i <= n; i++) {
    const nn = String(i).padStart(2, "0");
    writeFileSync(join(dir, `${nn}-t.md`), ticket({ cites: cites.join(", "), stories: "1" }));
    seed({ type: "ticket.planned", id: `sub/${nn}`, title: `Ticket ${nn}`, plan: "sub" });
  }
  seed({ type: "plan.ended", plan: "sub", result: "ok" });
}

const col = (id: string) => board().tickets.get(id)?.column;

test("29.1 a second plan extends the spec and continues the ticket numbers", async () => {
  await planned(3);
  seed(
    { type: "ticket.moved", id: "sub/01", to: "building", actor: "loop" },
    { type: "ticket.moved", id: "sub/02", to: "building", actor: "loop" },
    { type: "ticket.moved", id: "sub/02", to: "merging", actor: "loop" },
    { type: "ticket.merge", id: "sub/02" },
  );
  await decide("c2", { parent: "sub", title: "New card" });
  const r = await werk("plan", "sub", "--timeout", "30", "--silence", "30");
  expect(r.code).toBe(0);
  const b = board();
  expect(b.plans.size).toBe(1);
  expect(b.tickets.has("sub/04")).toBe(true);
  expect(col("sub/01")).toBe("building");
  expect(col("sub/02")).toBe("done");
});

test("29.2 an open ticket the new spec no longer needs is archived and can be restored", async () => {
  await planned(3);
  await must("remove", "c1", "--actor", "you");
  const r = await werk("plan", "sub", "--timeout", "30", "--silence", "30");
  expect(r.code).toBe(0);
  const t = board().tickets.get("sub/01");
  expect(t?.archived).toBe(true);
  expect(r.stdout + r.stderr).toMatch(/no longer needs/i);
  expect((await werk("ticket", "restore", "01", "--actor", "you")).code).toBe(0);
  expect(board().tickets.get("sub/01")?.archived).toBe(false);
});

test("29.3 retitling a cited card blocks the ready ticket, and a re-plan clears the block", async () => {
  await planned(1);
  expect(col("sub/01")).toBe("ready");
  await must("propose", "c1", "--title", "A new title");
  await must("accept", "c1", "--actor", "you");
  expect(col("sub/01")).toBe("blocked");
  expect(board().tickets.get("sub/01")?.reason).toMatch(/c1.*title/i);
  const r = await werk("plan", "sub", "--timeout", "30", "--silence", "30");
  expect(r.code).toBe(0);
  expect(col("sub/01")).toBe("ready");
});

test("29.4 a note blocks nothing and a building ticket is never blocked", async () => {
  await planned(2);
  seed({ type: "ticket.moved", id: "sub/02", to: "building", actor: "loop" });
  await must("say", "c1", "a note");
  expect(col("sub/01")).toBe("ready");
  expect(col("sub/02")).toBe("building");
  await must("propose", "c1", "--ops", JSON.stringify([{ tag: "new", new: "A new body block." }]));
  await must("accept", "c1", "--actor", "you");
  expect(col("sub/01")).toBe("blocked");
  expect(board().tickets.get("sub/01")?.reason).toMatch(/c1.*body/i);
  expect(col("sub/02")).toBe("building");
});

test("29.5 a new uncited card under a planned subtree reports a failed check", async () => {
  await planned(2);
  const r = await werk("add", "c9", "--title", "New card", "--parent", "sub");
  expect(r.stdout + r.stderr).toMatch(/cards-cited/);
  expect(r.stdout + r.stderr).toContain("c9");
  expect(col("sub/01")).toBe("ready");
  expect(col("sub/02")).toBe("ready");
  expect(board().tickets.get("sub/01")?.reason).toBe("");
});
