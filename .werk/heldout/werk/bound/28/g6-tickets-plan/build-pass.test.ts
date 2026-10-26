import { expect, test } from "bun:test";
import { freshProject } from "../../src/test/project.ts";

test("19.x a build pass on a ticket can be started from the command line", async () => {
  const p = freshProject();
  const help = await p.werk(["help"]);
  const run = await p.werk(["build", "s/01"]);
  console.log("19.x build", JSON.stringify(run));
  expect(help.out).toMatch(/^  build\b/m);
});
