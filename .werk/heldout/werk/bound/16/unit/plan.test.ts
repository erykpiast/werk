import { describe, expect, test } from "bun:test";
import { makeCard, useWerk } from "./support.ts";

const w = useWerk();

// The board comes from `werk plan`. The command line has no verb that plans a subtree,
// so each test starts with the plan and fails there when the verb is missing.
async function planned(t: ReturnType<typeof w>) {
  await makeCard(t, "root", { decided: true });
  await makeCard(t, "a", { parent: "root", decided: true });
  await makeCard(t, "b", { parent: "root", decided: true });
  const r = await t.run("plan", "root");
  expect(r.code, `werk plan: ${r.stderr}`).toBe(0);
}

describe("29 second plan", () => {
  test("29.1 a second plan extends the spec and continues the ticket numbers", async () => {
    const t = w();
    await planned(t);
    await makeCard(t, "c", { parent: "root", decided: true });
    const r = await t.run("plan", "root");
    expect(r.code, r.stderr).toBe(0);
    const board = await t.run("ticket", "list");
    expect(board.stdout).toMatch(/\b4\b/);
  });
  test("29.2 an open ticket the new spec no longer needs is archived and can be restored", async () => {
    const t = w();
    await planned(t);
    await t.ok("remove", "b");
    expect((await t.run("plan", "root")).code).toBe(0);
    expect((await t.run("ticket", "restore", "2", "--actor", "you")).code).toBe(0);
  });
  test("29.3 retitling a cited card blocks the ready ticket that cites it", async () => {
    const t = w();
    await planned(t);
    await t.ok("propose", "a", "--title", "New title");
    await t.ok("accept", "a", "--actor", "you");
    const board = await t.run("ticket", "list");
    expect(board.stdout).toMatch(/blocked/);
    expect(board.stdout).toMatch(/title changed/);
  });
  test("29.4 a note on a cited card blocks nothing, a changed body blocks the ready ticket", async () => {
    const t = w();
    await planned(t);
    await t.ok("say", "a", "a note");
    expect((await t.run("ticket", "list")).stdout).not.toMatch(/blocked/);
    await t.ok("propose", "a", "--ops", '[{"tag":"new","new":"more"}]');
    await t.ok("accept", "a", "--actor", "you");
    expect((await t.run("ticket", "list")).stdout).toMatch(/body changed/);
  });
  test("29.5 a card added under a planned subtree reports a failed cards-cited check", async () => {
    const t = w();
    await planned(t);
    await makeCard(t, "new-card", { parent: "root", decided: true });
    const r = await t.run("ticket-check", "tickets", "--root", "root", "--spec", "spec.md");
    expect(r.stdout + r.stderr).toMatch(/cards-cited[\s\S]*new-card/);
  });
});
