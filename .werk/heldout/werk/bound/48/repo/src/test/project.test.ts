// The harness at its seam: a fresh project per test, removed when the test ends (#werk-base-test-project).
import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject } from "./project.ts";

let left: { dir: string; target: string; pid: number } | undefined;

test("a fresh project is a git repository with an empty map, beside a target git repository", async () => {
  const project = freshProject();
  expect(readFileSync(join(project.dir, ".werk", "log.jsonl"), "utf8")).toBe("");
  for (const dir of [project.dir, project.target]) {
    const top = await project.run(["git", "rev-parse", "--show-toplevel"], { cwd: dir });
    expect(top).toEqual({ code: 0, out: `${dir}\n`, err: "" });
  }
  expect(project.dir).not.toBe(project.target);
});

test("each test gets its own project", () => {
  expect(freshProject().dir).not.toBe(freshProject().dir);
});

test("a werk command runs in the project and gives its exit code and output", async () => {
  const project = freshProject();
  const help = await project.werk(["help"]);
  expect(help.code).toBe(0);
  expect(help.out).toStartWith("Usage: werk <verb>");
  const unknown = await project.werk(["frobnicate"]);
  expect(unknown.code).toBe(2);
  expect(unknown.err).toStartWith("werk: unknown verb frobnicate");
});

test.failing("a test that fails leaves its project and its processes behind", () => {
  const project = freshProject();
  const proc = project.start(["sleep", "30"]);
  left = { dir: project.dir, target: project.target, pid: proc.pid };
  expect("this test").toBe("failing");
});

test("the harness removed the failed test's project and stopped its process", () => {
  if (left === undefined) throw new Error("the failing test did not run");
  expect(existsSync(left.dir)).toBe(false);
  expect(existsSync(left.target)).toBe(false);
  expect(() => process.kill(left?.pid ?? 0, 0)).toThrow();
});
