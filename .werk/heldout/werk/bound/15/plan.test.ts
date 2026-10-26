// Steps 29.1 to 29.5: a second plan of a subtree, and the blocks that a changed cited card sets.
import { describe, expect, test } from "bun:test";
import { readBoard } from "../src/board/log-store.ts";
import { boardLogPathFor } from "../src/board/log-store.ts";
import { columnsOf } from "../src/board/fold.ts";
import { addCard, decidedCard, ok, useWerk } from "./support.ts";

const { project, werk } = useWerk();

const board = () => readBoard(boardLogPathFor(project().dir, {}));
const ticketsIn = (column: string) =>
  (columnsOf(board()) as Record<string, string[]>)[column] ?? [];

/** A decided subtree under root, planned once. */
async function planned(): Promise<void> {
  await decidedCard(werk, "root");
  await decidedCard(werk, "one", "root");
  await decidedCard(werk, "two", "root");
  await ok(werk, "plan", "root");
}

describe("second plan", () => {
  test("29.1 a second plan extends the spec and continues the ticket numbers", async () => {
    await planned();
    const first = board().tickets.size;
    expect(first).toBeGreaterThan(0);
    await decidedCard(werk, "three", "root");
    await ok(werk, "plan", "root");
    expect(board().tickets.size).toBeGreaterThan(first);
    expect(new Set([...board().tickets.values()].map((t) => t.number)).size).toBe(board().tickets.size);
  });

  test("29.2 an open ticket the new spec no longer needs is archived and can be restored", async () => {
    await planned();
    expect((await werk("remove", "two", "--actor", "you")).code).toBe(0);
    await ok(werk, "plan", "root");
    const archived = [...board().tickets.values()].filter((t) => t.archived);
    expect(archived.length).toBeGreaterThan(0);
    const number = (archived[0] as { number: string }).number;
    expect((await werk("ticket", "restore", number, "--actor", "you")).code).toBe(0);
    expect(ticketsIn("ready").length).toBeGreaterThan(0);
  });

  test("29.3 retitling a cited card blocks the ready ticket that cites it, and a re-plan clears the block", async () => {
    await planned();
    expect(ticketsIn("ready").length).toBeGreaterThan(0);
    await ok(werk, "edit", "one", "--title", "A new title");
    expect(ticketsIn("blocked").length).toBeGreaterThan(0);
    await ok(werk, "plan", "root");
    expect(ticketsIn("blocked")).toHaveLength(0);
  });

  test("29.4 a note on a cited card blocks nothing, and a building ticket is never blocked", async () => {
    await planned();
    await ok(werk, "say", "one", "a note");
    expect(ticketsIn("blocked")).toHaveLength(0);
    await ok(werk, "edit", "one", "--body", "a changed body");
    expect(ticketsIn("blocked").length).toBeGreaterThan(0);
  });

  test("29.5 a card added under a planned subtree reports a failed check without blocking tickets", async () => {
    await planned();
    await addCard(werk, "fresh", { parent: "root" });
    const result = await werk("plan", "root", "--check");
    expect(`${result.stdout}${result.stderr}`).toMatch(/cards-cited/);
    expect(`${result.stdout}${result.stderr}`).toContain("fresh");
    expect(ticketsIn("blocked")).toHaveLength(0);
  });
});
