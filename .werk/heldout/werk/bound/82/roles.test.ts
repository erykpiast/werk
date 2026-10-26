import { expect, test } from "bun:test";
import { modelFlags, roleModel } from "../src/agent/role-model.ts";

test("[76.3 evidence] the table gives the builder Sonnet with an Opus advisor and a reviewer Sonnet alone", () => {
  expect(modelFlags("builder")).toEqual(["--model", "claude-sonnet-5-5[1m]", "--advisor", "claude-opus-5-5"]);
  expect(modelFlags("reviewer-design")).toEqual(["--model", "claude-sonnet-5-5[1m]"]);
  expect(modelFlags("reviewer-security")).toEqual(["--model", "claude-sonnet-5-5[1m]"]);
});

test("[76.4] a role that the table does not know is reported as an error", () => {
  // The launch of an agent takes its flags from modelFlags; an unknown role must not be launched on a default model.
  let error: unknown;
  let flags: string[] = [];
  try {
    flags = modelFlags("mystery-role");
  } catch (e) {
    error = e;
  }
  expect(error, `modelFlags returned ${JSON.stringify(flags)} and threw nothing`).toBeDefined();
  expect(String(error)).toContain("mystery-role");
  expect(roleModel("mystery-role")).toBeUndefined();
});
