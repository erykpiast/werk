import { expect, test } from "bun:test";
import { modelFlags } from "../src/agent/role-model.ts";
import { card, seed, w, withRoot } from "./h.ts";

// Steps that start a build pass, a run or a review: the command line has no verb for them.
test("19.1 a build pass starts with the werk instructions, its subagents and the build-rule titles", async () => {
  const p = withRoot();
  seed(p, [card("how", "Build rules", { status: "decided", parent: "root" }), card("r1", "Rule one", { status: "decided", parent: "how" })]);
  const run = await w(p, "build");
  expect(run.err).not.toMatch(/unknown verb|no verb/i);
  expect(run.code).toBe(0);
  expect(p.launches().some((l) => l.role === "builder")).toBe(true);
});

test("19.3 a project with no build rules gets no title list in a build pass", async () => {
  const p = withRoot();
  seed(p, [card("how", "Build rules", { status: "decided", parent: "root" })]);
  const run = await w(p, "build");
  expect(run.code).toBe(0);
  expect(p.launches().some((l) => l.role === "builder")).toBe(true);
});

test("19.4 in werk's own checkout the instructions appear one time in a build pass", async () => {
  const p = withRoot();
  const run = await w(p, "build");
  expect(run.code).toBe(0);
  expect(p.launches().some((l) => l.role === "builder")).toBe(true);
});

test("19.2 a sample agent can be started for an open card", async () => {
  const p = withRoot();
  seed(p, [card("open1", "An open card", { parent: "root" })]);
  const run = await w(p, "sample", "open1");
  expect(run.code).toBe(0);
  expect(p.launches().some((l) => l.role === "sample")).toBe(true);
});

test("76.3 builder and reviewer roles resolve to Sonnet, and only the builder has an advisor", async () => {
  const p = withRoot();
  const run = await w(p, "build");
  expect(run.code).toBe(0);
  const builder = p.launches().find((l) => l.role === "builder");
  expect(builder?.args).toContain("--advisor");
  expect(modelFlags("reviewer-design")).toEqual(["--model", "claude-sonnet-5-5[1m]"]);
});

test("76.4 a role that the table does not know is reported as an error", () => {
  let message = "";
  try {
    modelFlags("mystery-role");
  } catch (e) {
    message = String(e);
  }
  expect(message).toContain("mystery-role");
});

test("76.5 no launch uses a model alias in a plan, a builder pass and a review", async () => {
  const p = withRoot();
  const run = await w(p, "build");
  expect(run.code).toBe(0);
  const launches = p.launches();
  expect(launches.some((l) => l.role === "builder")).toBe(true);
  expect(launches.some((l) => l.role.startsWith("reviewer-"))).toBe(true);
});
