import { expect, test } from "bun:test";
import { freshProject } from "../src/test/project.ts";

// Probe: can the person start the run / merge loop from outside? The test looks for a verb for it.
const ids = ["87.1", "87.2", "87.3", "87.4", "87.5", "88.1", "88.2", "88.3", "88.4", "88.5"];
for (const id of ids) {
  test(`${id} the person can start the run or merge loop`, async () => {
    const p = freshProject();
    const help = (await p.werk(["help"])).out;
    expect(help).toMatch(/^\s{2}(run|merge|loop|start)\b/m);
  });
}
