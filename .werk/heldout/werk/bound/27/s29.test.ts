// Steps 29.1 to 29.5 need a plan of a decided subtree. The checkout has no plan verb and no spec or ticket writer.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { createProject, decidedEvents, type Project, seed, werk } from "./support.ts";

let p: Project;
beforeEach(() => {
  p = createProject();
  seed(p, decidedEvents("root", { title: "Root" }), decidedEvents("a", { title: "A", parent: "root" }));
});
afterEach(() => p.dispose());

const plan = () => werk(p, "plan", "root");

for (const id of ["29.1", "29.2", "29.3", "29.4", "29.5"]) {
  test(`${id} a person plans the subtree`, async () => {
    const first = await plan();
    expect(first.code, first.stderr).toBe(0);
    const again = await plan();
    expect(again.code, again.stderr).toBe(0);
    const list = await werk(p, "ticket", "list");
    expect(list.code, list.stderr).toBe(0);
  });
}
