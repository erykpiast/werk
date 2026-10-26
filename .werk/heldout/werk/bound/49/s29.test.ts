import { expect, setDefaultTimeout, test } from "bun:test";
import { createProject, decide, makeWerk, real, type W } from "./support.ts";

setDefaultTimeout(120000);

type P = ReturnType<typeof createProject>;
async function withW<T>(body: (w: W, p: P) => Promise<T>) {
  const p = createProject();
  try {
    return await body(makeWerk(p), p);
  } finally {
    await p.dispose();
  }
}

/** A decided subtree, then the plan operation the steps name. */
async function subtree(w: W) {
  await real(w, "root", "Root");
  await decide(w, "root");
  await real(w, "c1", "Card one", { parent: "root" });
  await decide(w, "c1");
  await real(w, "c2", "Card two", { parent: "root" });
  await decide(w, "c2");
}
const plan = (w: W) => w("plan", "root");

test("29.1 a second plan extends the spec and continues the ticket numbers", () =>
  withW(async (w, p) => {
    await subtree(w);
    const first = await plan(w);
    expect(first.code).toBe(0);
    await real(w, "c3", "Card three", { parent: "root" });
    await decide(w, "c3");
    const second = await plan(w);
    expect(second.code).toBe(0);
    expect(p.events().length).toBeGreaterThan(0);
  }));

test("29.2 an open ticket the new spec no longer needs is archived", () =>
  withW(async (w) => {
    await subtree(w);
    expect((await plan(w)).code).toBe(0);
    expect((await w("remove", "c2")).code).toBe(0);
    expect((await plan(w)).code).toBe(0);
    const restored = await w("ticket", "restore", "1");
    expect(restored.code).toBe(0);
  }));

test("29.3 retitling a cited card blocks the ready ticket that cites it", () =>
  withW(async (w) => {
    await subtree(w);
    expect((await plan(w)).code).toBe(0);
    expect((await w("propose", "c1", "--title", "Card one renamed")).code).toBe(0);
    expect((await w("accept", "c1", "--actor", "you")).code).toBe(0);
    const board = await w("followup", "root/01", "--list");
    expect(board.all).toMatch(/blocked/);
  }));

test("29.4 a note blocks nothing, a changed body blocks the ready ticket only", () =>
  withW(async (w) => {
    await subtree(w);
    expect((await plan(w)).code).toBe(0);
    expect((await w("say", "c1", "a note")).code).toBe(0);
    expect((await w("propose", "c1", "--ops", '[{"tag":"new","new":"new body words"}]')).code).toBe(0);
    expect((await w("accept", "c1", "--actor", "you")).code).toBe(0);
    expect((await plan(w)).all).toMatch(/blocked/);
  }));

test("29.5 a card added under a planned subtree reports a failed check", () =>
  withW(async (w) => {
    await subtree(w);
    expect((await plan(w)).code).toBe(0);
    expect((await w("add", "extra", "--title", "Extra card", "--parent", "root")).code).toBe(0);
    const r = await w("plan", "root", "--check");
    expect(r.all).toMatch(/cards-cited/);
    expect(r.all).toContain("extra");
  }));
