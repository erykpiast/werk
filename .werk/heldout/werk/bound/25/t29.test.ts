import { afterEach, beforeEach, expect, test } from "bun:test";
import { createProject, decided, open, seed, werkIn, type Project } from "./support.ts";

let p: Project;
let werk: ReturnType<typeof werkIn>;
beforeEach(() => {
  p = createProject();
  werk = werkIn(p);
  seed(p, [decided("root", { title: "Root" }), decided("card-a", { parent: "root" }), { type: "node.reopened", id: "root", reason: "rejected", at: "2026-10-10T09:00:00.000Z" }]);
});
afterEach(() => p.dispose());

/** Every scenario of ticket 29 starts from "a person has planned a subtree". Planning is a command of the werk line. */
const planned = async () => {
  const verbs = (await werk("help")).stdout;
  expect(verbs).toMatch(/^\s+plan\s/m);
  const r = await werk("plan", "root");
  expect(r.stderr).not.toMatch(/unknown verb/);
  return r;
};

for (const id of ["29.1", "29.2", "29.3", "29.4", "29.5"]) {
  test(`${id} needs a plan of a subtree`, async () => {
    await planned();
  });
}
