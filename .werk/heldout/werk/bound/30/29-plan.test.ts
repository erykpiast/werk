import { expect, test } from "bun:test";
import { useProject } from "../src/test-env/project.ts";
import { werk } from "./helpers.ts";

const project = useProject();

// 29.x all start from "a person has planned a subtree". Probe for an operation that plans.
test("29.x the command line has a way to plan a subtree", async () => {
  const p = project();
  const help = await werk(p, "help");
  expect(help.stdout).toMatch(/\bplan\b/);
  const plan = await werk(p, "plan", "root");
  expect(plan.stderr).not.toContain("unknown verb");
});
