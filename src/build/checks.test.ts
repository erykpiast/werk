import { expect, test } from "bun:test";
import { parseTicket } from "../tickets/ticket-parse.ts";
import { checkName, checksOf, DEFAULT_CHECKS, judgeCheck } from "./checks.ts";

const ticket = (checks: string) =>
  parseTicket(
    "01.md",
    `title: T\ncites:\nblocked_by:\nstories:\ntouches: x\n\n## What to build\n\nx\n\n## Acceptance criteria\n\n- [ ] y\n\n## Checks\n\n${checks}\n`,
  );

test("the checks are the make bullets in their order", () => {
  const found = ticket("- `make test`\n- make   lint\n- not a check");
  expect(found && checksOf(found)).toEqual(["make test", "make lint"]);
});

test("an empty Checks section gives the default checks", () => {
  const found = ticket("");
  expect(found && checksOf(found)).toEqual([...DEFAULT_CHECKS]);
});

test("a ticket with no Checks section gives the default checks", () => {
  const found = parseTicket("01.md", "title: T\n");
  expect(found && checksOf(found)).toEqual([...DEFAULT_CHECKS]);
});

test("an exit code of 0 is green and any other exit is red", () => {
  expect(judgeCheck({ exitCode: 0, timedOut: false })).toEqual({
    kind: "green",
  });
  expect(judgeCheck({ exitCode: 2, timedOut: false })).toEqual({
    kind: "red",
    reason: "exit code 2",
  });
});

test("a crash, a timeout and a missing tool are check infrastructure", () => {
  const kinds = [
    judgeCheck({ exitCode: null, timedOut: false, spawnError: "no make" }),
    judgeCheck({ exitCode: null, timedOut: true }),
    judgeCheck({ exitCode: null, timedOut: false }),
    judgeCheck({ exitCode: 127, timedOut: false }),
    judgeCheck({
      exitCode: 2,
      timedOut: false,
      output:
        "sh: x: command not found\nmake: *** [Makefile:2: check] Error 127",
    }),
  ].map((verdict) => verdict.kind);
  expect(kinds).toEqual(["infra", "infra", "infra", "infra", "infra"]);
});

test("a check is named by its make target", () => {
  expect(checkName("make typecheck")).toBe("typecheck");
});
