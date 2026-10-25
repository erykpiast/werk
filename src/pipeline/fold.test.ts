import { expect, test } from "bun:test";
import { parseLog } from "../map/fold.ts";
import { checkPipelineEvent, foldPipeline } from "./fold.ts";

const COST = { usd: 0.1, input: 1, output: 2, cacheRead: 3, cacheWrite: 4 };
const at = "2026-01-01T00:00:00Z";

const start = (step: string, pass: number, more: object = {}) => ({
  type: "step.started",
  step,
  id: `${step}-${pass}`,
  build: "b1",
  ticket: "r/01",
  pass,
  at,
  ...more,
});
const end = (
  step: string,
  pass: number,
  result: string,
  more: object = {},
) => ({
  type: "step.ended",
  step,
  id: `${step}-${pass}`,
  build: "b1",
  ticket: "r/01",
  pass,
  at,
  ms: 5,
  cost: COST,
  result,
  ...more,
});

const fold = (events: unknown[]) =>
  foldPipeline(parseLog(events.map((e) => JSON.stringify(e)).join("\n")));
const build = (events: unknown[]) => fold(events).builds.get("b1");

test("a pass start, a red check end and a pass end fold into one red pass with its gate and cause", () => {
  const b = build([
    start("pass", 1),
    end("check", 1, "red", {
      gate: "unit test",
      cause: "check-infrastructure",
      file: "pipeline-files/check-1.txt",
    }),
    end("pass", 1, "red"),
  ]);
  expect(b?.passes).toHaveLength(1);
  expect(b?.passes[0]).toMatchObject({
    n: 1,
    result: "red",
    gate: "unit test",
    cause: "check-infrastructure",
    file: "pipeline-files/check-1.txt",
    counted: true,
  });
  expect(b?.ticket).toBe("r/01");
  expect(b?.last).toMatchObject({ pass: 1, gate: "unit test" });
});

test("the next pass names the cause of the last failure, and a cause the check set stays", () => {
  const b = build([
    start("pass", 1),
    end("check", 1, "red", { gate: "lint" }),
    end("pass", 1, "red"),
    start("pass", 2, { cause: "builder-error", reason: "wrong import" }),
    end("check", 2, "red", {
      gate: "unit test",
      cause: "check-infrastructure",
    }),
    end("pass", 2, "red"),
    start("pass", 3, { cause: "builder-error" }),
  ]);
  expect(b?.passes[0]).toMatchObject({
    cause: "builder-error",
    reason: "wrong import",
  });
  expect(b?.passes[1]?.cause).toBe("check-infrastructure");
  expect(b?.passes[2]?.result).toBe("running");
  expect(b?.last).toMatchObject({ pass: 2, cause: "check-infrastructure" });
});

test("a pass whose cause is spec gap or conflict does not count toward the cap", () => {
  const b = build([
    start("pass", 1),
    end("grader", 1, "red", { gate: "grader" }),
    end("pass", 1, "red"),
    start("pass", 2, { cause: "spec-gap" }),
    end("check", 2, "red", { gate: "lint" }),
    end("pass", 2, "red"),
    start("pass", 3, { cause: "conflict" }),
    end("check", 3, "red", { gate: "lint" }),
    end("pass", 3, "red"),
    start("pass", 4, { cause: "builder-error" }),
    end("pass", 4, "red", { gate: "stalled" }),
  ]);
  expect(b?.passes.map((p) => p.counted)).toEqual([false, false, true, true]);
  expect(b?.counted).toBe(2);
  expect(b?.passes[3]?.gate).toBe("stalled");
});

test("a flaky check on a green pass is kept on the pass and costs nothing", () => {
  const b = build([
    start("pass", 1),
    end("check", 1, "green", { gate: "unit test", cause: "flaky" }),
    end("check", 1, "green", { cause: "flaky" }),
    end("pass", 1, "green"),
  ]);
  expect(b?.passes[0]).toMatchObject({
    result: "green",
    flaky: ["unit test", "check"],
    counted: false,
  });
  expect(b?.last).toBeUndefined();
});

test("the first red step names the gate, and a red step with no gate uses its step name", () => {
  const b = build([
    start("pass", 1),
    end("reviewer", 1, "red", { reason: "weak tests" }),
    end("merge", 1, "red", { gate: "merge loop" }),
    end("pass", 1, "red"),
  ]);
  expect(b?.passes[0]).toMatchObject({
    gate: "reviewer",
    reason: "weak tests",
  });
});

test("a plan step belongs to no build, and a bad line is a problem while later lines fold", () => {
  const text = [
    JSON.stringify({
      type: "step.started",
      step: "plan",
      id: "p1",
      at,
      cards: ["a"],
    }),
    "not json",
    JSON.stringify({ type: "other" }),
    JSON.stringify(start("pass", 1)),
  ].join("\n");
  const folded = foldPipeline(parseLog(text));
  expect(folded.builds.get("b1")?.passes).toHaveLength(1);
  expect(folded.builds.size).toBe(1);
  expect(folded.problems.map((p) => p.line)).toEqual([2, 3]);
});

test("an event is checked for its shape", () => {
  expect(checkPipelineEvent(null)).toContain("object");
  expect(checkPipelineEvent({ type: "x" })).toContain("type");
  expect(checkPipelineEvent({ type: "step.started", step: "x" })).toContain(
    "step",
  );
  expect(
    checkPipelineEvent({ type: "step.started", step: "plan", at }),
  ).toContain("id");
  expect(
    checkPipelineEvent({ type: "step.started", step: "plan", id: "p" }),
  ).toContain("at");
  expect(
    checkPipelineEvent({ type: "step.started", step: "pass", id: "p", at }),
  ).toContain("build");
  expect(
    checkPipelineEvent({ ...start("pass", 1), pass: undefined }),
  ).toContain("pass");
  expect(checkPipelineEvent({ ...start("pass", 1), cause: "odd" })).toContain(
    "cause",
  );
  expect(checkPipelineEvent({ ...end("pass", 1, "amber") })).toContain(
    "result",
  );
  expect(checkPipelineEvent({ ...end("pass", 1, "red"), ms: "x" })).toContain(
    "ms",
  );
  expect(checkPipelineEvent({ ...end("pass", 1, "red"), cost: 1 })).toContain(
    "cost",
  );
  expect(checkPipelineEvent(end("pass", 1, "red"))).toBeNull();
  expect(checkPipelineEvent(start("pass", 1))).toBeNull();
});
