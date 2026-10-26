import { afterEach, beforeEach, expect, test } from "bun:test";
import { createProject, type Project } from "../src/test-env/project.ts";
import { werk } from "./g5-helpers.ts";

let p: Project;
beforeEach(() => {
  p = createProject();
});
afterEach(() => p.dispose());

// No product operation plans a subtree: the help lists no plan verb, so each step stops at its first When.
async function planVerb() {
  const r = await werk(p, "plan", "root");
  return r;
}

for (const id of ["29.1", "29.2", "29.3", "29.4", "29.5"]) {
  test(`${id} a plan of a subtree exists as an operation`, async () => {
    const r = await planVerb();
    expect(r.stderr).not.toContain('unknown verb "plan"');
  });
}
