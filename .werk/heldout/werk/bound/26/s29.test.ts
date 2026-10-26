import { afterEach, beforeEach, expect, test } from "bun:test";
import { createProject, dec, type Project, runner, seed } from "./helpers.ts";

let project: Project;
beforeEach(() => {
  project = createProject();
});
afterEach(() => project.dispose());

// Every 29 step starts from a planned subtree: the plan verb writes one spec and its tickets.
async function plan() {
  seed(project, dec("sub", undefined, { title: "Subtree" }), dec("c1", "sub"));
  return runner(project)("plan", "sub");
}
for (const id of ["29.1", "29.2", "29.3", "29.4", "29.5"]) {
  test(`${id} needs a plan of a decided subtree`, async () => {
    const r = await plan();
    expect(r.code, r.stderr).toBe(0);
    const board = await runner(project)("ticket", "list");
    expect(board.code, board.stderr).toBe(0);
  });
}
