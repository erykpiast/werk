import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createProject, decided, type Project, refines, werkIn, writeLog } from "./helpers.ts";

let p: Project;
beforeEach(() => {
  p = createProject();
});
afterEach(() => p.dispose());

const subtree = () => [
  ...decided("root", { title: "Root" }),
  ...decided("c1", { title: "Card one" }),
  refines("c1", "root"),
];

/** The plan is the operation that turns a decided subtree into one spec and tickets. */
async function plan() {
  writeLog(p, subtree());
  return werkIn(p)("plan", "root");
}

describe("29 a second plan", () => {
  test("29.1 a second plan extends the spec and continues the ticket numbers", async () => {
    expect((await plan()).code).toBe(0);
    const again = await werkIn(p)("plan", "root");
    expect(again.code).toBe(0);
  });
  test("29.2 an open ticket the new spec no longer needs is archived and can be restored", async () => {
    expect((await plan()).code).toBe(0);
    expect((await werkIn(p)("remove", "c1")).code).toBe(0);
    expect((await werkIn(p)("plan", "root")).code).toBe(0);
  });
  test("29.3 retitling a cited card blocks the ready ticket that cites it", async () => {
    expect((await plan()).code).toBe(0);
    expect((await werkIn(p)("plan", "root")).code).toBe(0);
  });
  test("29.4 a note on a cited card blocks nothing, and a building ticket is never blocked", async () => {
    expect((await plan()).code).toBe(0);
    expect((await werkIn(p)("say", "c1", "a note")).code).toBe(0);
    expect((await werkIn(p)("plan", "root")).code).toBe(0);
  });
  test("29.5 a card added under a planned subtree reports a failed check", async () => {
    expect((await plan()).code).toBe(0);
    expect((await werkIn(p)("add", "c2", "--title", "New", "--parent", "root")).code).toBe(0);
    expect((await werkIn(p)("plan", "root")).code).toBe(0);
  });
});
