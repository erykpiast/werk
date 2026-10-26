import { expect, test } from "bun:test";
import { useProject } from "../src/test-env/project.ts";
import { card, seedLog, werk } from "./helpers.ts";

const project = useProject();

test("06.1 an agent adds an excerpt: output says proposed, card unchanged", async () => {
  const p = project();
  seedLog(p, card("c1", "A decided card", "decided", { body: "its words" }));
  const added = await werk(
    p,
    "add",
    "ex1",
    "--kind",
    "excerpt",
    "--title",
    "A quote",
    "--body",
    "verbatim words",
  );
  expect(added.stderr).toBe("");
  expect(added.stdout.trim()).toBe("proposed");
  const link = await werk(p, "link", "c1", "ex1", "--type", "supported_by");
  expect(link.code).toBe(0);
  const shown = await werk(p, "show", "ex1");
  expect(shown.stdout).toContain("proposed");
  const c1 = await werk(p, "show", "c1");
  expect(c1.stdout).toContain("[decided]");
  expect(c1.stdout).toContain("its words");
  expect(c1.stdout).toContain("[held]");
});

test("06.2 accepting the excerpt makes its link live", async () => {
  const p = project();
  seedLog(p, [
    ...card("c1", "A decided card", "decided"),
    {
      type: "node.proposed",
      id: "ex1",
      kind: "excerpt",
      title: "A quote",
      status: "open",
    },
    { type: "edge.added", from: "c1", to: "ex1", link: "supported_by" },
  ]);
  const before = await werk(p, "show", "c1");
  expect(before.stdout).toContain("[held]");
  const acc = await werk(p, "accept", "ex1", "--actor", "you");
  expect(acc.stdout.trim()).toBe("accepted");
  const after = await werk(p, "show", "c1");
  expect(after.stdout).toContain("supported_by");
  expect(after.stdout).toContain("ex1");
  expect(after.stdout).not.toContain("[held]");
  expect(after.stdout).not.toContain("[proposed]");
});
