// Held-out steps 19.1, 19.2 (sample part), 19.3, 19.4: a person starts a build pass or samples
// options. The test looks for the way a person does it: a verb of the command line.
import { expect, test } from "bun:test";
import { freshProject } from "../../src/test/project.ts";

test("19.1/19.3/19.4: the person can start a build pass on a ticket", async () => {
  const p = freshProject();
  const help = await p.werk(["help"]);
  expect(help.code).toBe(0);
  expect(help.out).toMatch(/^\s{2}(build|pass|run)\b/m);
});

test("19.2: the person can sample options for an open card", async () => {
  const p = freshProject();
  const help = await p.werk(["help"]);
  expect(help.out).toMatch(/^\s{2}sample\b/m);
});
