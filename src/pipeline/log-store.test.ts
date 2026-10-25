import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendPipelineEvent,
  pipelineLogBeside,
  pipelineLogPathFor,
  readPipeline,
  writeDetailFile,
} from "./log-store.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "werk-pipeline-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const COST = { usd: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
const at = "2026-01-01T00:00:00Z";
const base = { build: "b1", pass: 1, at };

test("the pipeline log sits beside the map log", () => {
  expect(pipelineLogPathFor("/p", {})).toBe("/p/.werk/pipeline.jsonl");
  expect(pipelineLogPathFor("/p", { WERK_LOG: "/x/y/log.jsonl" })).toBe(
    "/x/y/pipeline.jsonl",
  );
  expect(pipelineLogBeside("/a/log.jsonl")).toBe("/a/pipeline.jsonl");
});

test("an event is appended as one line, and a refused event appends nothing", () => {
  const path = join(dir, "sub", "pipeline.jsonl");
  expect(readPipeline(path).builds.size).toBe(0);
  const ok = appendPipelineEvent(path, {
    type: "step.started",
    step: "pass",
    id: "pass-1",
    ...base,
  });
  expect(ok.ok).toBe(true);
  const refused = appendPipelineEvent(path, { type: "step.started" });
  expect(refused.ok).toBe(false);
  expect(readFileSync(path, "utf8").trim().split("\n")).toHaveLength(1);
});

test("an append after a line with no newline starts a new line", () => {
  const path = join(dir, "pipeline.jsonl");
  writeFileSync(
    path,
    JSON.stringify({ type: "step.started", step: "pass", id: "a", ...base }),
  );
  appendPipelineEvent(path, {
    type: "step.ended",
    step: "pass",
    id: "a",
    ms: 1,
    cost: COST,
    result: "green",
    ...base,
  });
  expect(readPipeline(path).builds.get("b1")?.passes[0]?.result).toBe("green");
});

test("a check end names the file with its full output, and git ignores that file", async () => {
  const path = join(dir, ".werk", "pipeline.jsonl");
  const git = (...args: string[]) =>
    Bun.spawn(["git", ...args], { cwd: dir, stdout: "pipe", stderr: "pipe" });
  await git("init", "-q").exited;
  const file = writeDetailFile(path, "check/unit test:1", "txt", "FAIL\n");
  expect(file).toBe("pipeline-files/check_unit_test_1.txt");
  expect(readFileSync(join(dir, ".werk", file), "utf8")).toBe("FAIL\n");
  // A second write keeps the ignore rule.
  writeDetailFile(path, "other", "txt", "x");

  appendPipelineEvent(path, {
    type: "step.ended",
    step: "check",
    id: "check-1",
    gate: "unit test",
    result: "red",
    ms: 3,
    cost: COST,
    file,
    ...base,
  });
  const logged = readPipeline(path).builds.get("b1")?.passes[0]?.file;
  expect(logged).toBe(file);

  const ignored = git("check-ignore", "-q", `.werk/${file}`);
  expect(await ignored.exited).toBe(0);
  const log = git("check-ignore", "-q", ".werk/pipeline.jsonl");
  expect(await log.exited).toBe(1);
  expect(existsSync(join(dir, ".werk", "pipeline.jsonl"))).toBe(true);
});
