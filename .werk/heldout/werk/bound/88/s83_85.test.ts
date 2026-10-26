import { expect, test } from "bun:test";
import { freshProject } from "../src/test/project.ts";

// Probe: can the person start a build of a ticket? The test looks for a verb for it and runs it.
const ids = ["83.1", "83.2", "83.3", "83.4", "83.5", "84.1", "84.2", "84.3", "84.4", "84.5", "85.1", "85.2", "85.3", "85.4"];
for (const id of ids) {
  test(`${id} the person can start the build of a ticket`, async () => {
    const p = freshProject();
    const help = (await p.werk(["help"])).out;
    expect(help).toMatch(/^\s{2}(build|run|merge|start)\b/m);
    const run = await p.werk(["build", "checkout/01"]);
    expect(run.err).not.toContain("unknown verb");
  });
}
