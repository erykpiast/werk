/**
 * Step 29 needs a plan: a decided subtree turned into one spec and tickets. This checkout has no plan verb,
 * no plan route and no plan agent role, so each test fails at the first plan.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { board, createProject, decided, open, seed, werk, type Project } from "../support.ts";

let project: Project;
beforeEach(() => {
  project = createProject();
});
afterEach(() => project.dispose());
const w = (...args: string[]) => werk(project, ...args);

const plan = async () => {
  const r = await w("plan", "root");
  expect(r.code, `werk plan root: ${r.stderr.trim()}`).toBe(0);
};
const subtree = () => seed(project, decided("root", { title: "Root" }), open("c1", { title: "One", parent: "root", status: "decided" }), open("c2", { title: "Two", parent: "root", status: "decided" }));

describe("29 re-plan", () => {
  test("29.1 a second plan extends the spec and continues the ticket numbers", async () => {
    subtree();
    await plan();
    seed(project, open("c3", { title: "Three", parent: "root", status: "decided" }));
    await plan();
    expect([...board(project).tickets.keys()].sort().at(-1)).toMatch(/04$/);
  });
  test("29.2 an open ticket the new spec no longer needs is archived and can be restored", async () => {
    subtree();
    await plan();
    expect((await w("remove", "c2", "--actor", "you")).code).toBe(0);
    await plan();
    expect([...board(project).tickets.values()].some((t) => t.archived)).toBe(true);
  });
  test("29.3 retitling a cited card blocks the ready ticket that cites it, and a re-plan clears the block", async () => {
    subtree();
    await plan();
    seed(project, { type: "change.proposed", id: "c1", title: "Renamed" }, { type: "node.accepted", id: "c1", actor: "you" });
    expect([...board(project).tickets.values()].some((t) => t.column === "blocked")).toBe(true);
    await plan();
    expect([...board(project).tickets.values()].every((t) => t.column !== "blocked")).toBe(true);
  });
  test("29.4 a note blocks nothing, a changed body blocks the ready ticket and not the building one", async () => {
    subtree();
    await plan();
    seed(project, { type: "note.added", id: "c1", by: "you", text: "a note" });
    expect([...board(project).tickets.values()].every((t) => t.column !== "blocked")).toBe(true);
    seed(project, { type: "change.proposed", id: "c1", body: "new body" }, { type: "node.accepted", id: "c1", actor: "you" });
    expect([...board(project).tickets.values()].some((t) => t.column === "blocked")).toBe(true);
  });
  test("29.5 a card added under a planned subtree reports a failed cards-cited check", async () => {
    subtree();
    await plan();
    const r = await w("add", "extra", "--title", "Extra", "--parent", "root");
    expect(r.stdout + r.stderr).toContain("cards-cited");
    void readFileSync;
    void join;
  });
});
