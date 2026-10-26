import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { readBoard } from "../../src/board/log-store.ts";
import { judgeRoles } from "../../src/build/judge-fixtures.ts";
import type { LaunchRecord, MessageRecord } from "../../src/fake-agent/launch-log.ts";
import type { Reply } from "../../src/fake-agent/script.ts";
import { decided } from "../../src/map/mark-fixtures.ts";
import { readPipeline } from "../../src/pipeline/log-store.ts";
import { FAKE_DIR } from "../../src/test-env/env.ts";
import { CLI, createProject, type Project } from "./h.ts";

let project: Project;
beforeEach(() => {
  project = createProject();
});
afterEach(() => project.dispose());

const boardPath = () => join(project.dir, ".werk", "board.jsonl");
const pipelinePath = () => join(project.dir, ".werk", "pipeline.jsonl");
const ticket = () => readBoard(boardPath()).tickets.get("r/01");
const edit = (path: string, content: string) => ({ edit: path, content });
const messages = () =>
  project.launches().filter((r): r is MessageRecord => r.kind === "message" && r.role === "builder");
const launched = (role: string) =>
  project.launches().filter((r): r is LaunchRecord => r.kind === "launch" && r.role === role);
const verdict = (text: string): Reply => [{ event: { type: "result", subtype: "success", result: text } }];
const transcriptOf = (pass: number) => {
  const file = readPipeline(pipelinePath()).builds.values().next().value?.passes[pass]?.transcript;
  return readFileSync(join(dirname(pipelinePath()), file ?? "none"), "utf8");
};
const callOf = (id: string, command = "make") => ({
  event: {
    type: "assistant",
    message: { content: [{ type: "tool_use", id, name: "Bash", input: { command } }] },
  },
});
const resultOf = (id: string) => ({
  event: { type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, content: "ok" }] } },
});
const TICKET = `title: Make the check pass\ncites: top\nblocked_by:\nstories: 1\ntouches: checks\n\n## What to build\n\nMake ok.txt exist.\n\n## Acceptance criteria\n\n- [ ] ok.txt exists\n\n## Checks\n\n- \`make check\`\n`;
async function seed() {
  writeFileSync(join(project.dir, "Makefile"), "check:\n\t@test -f ok.txt\n");
  await project.run(["git", "add", "-A"]);
  await project.run(["git", "commit", "-q", "-m", "Add the Makefile"]);
  writeFileSync(project.logPath, decided("top", { title: "Seat price", why: "Because." }).map((e) => `${JSON.stringify(e)}\n`).join(""));
  writeFileSync(boardPath(), `${JSON.stringify({ type: "ticket.planned", id: "r/01", title: "Make the check pass" })}\n`);
  const file = join(project.dir, ".werk", "tickets", "r", "01.md");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, TICKET);
}
const build = (extra: string[], env?: Record<string, string>) =>
  project.run(["bun", CLI, "build", "r/01", "--poll-ms", "100", ...extra], env);
const GOOD = judgeRoles({
  grades: Array(5).fill([{ event: { type: "result", subtype: "success", is_error: false, result: JSON.stringify({ lines: [{ line: "criterion-1", score: 4, gap: "" }, { line: "card-top", score: 4, gap: "" }, { line: "scope", score: 5, gap: "" }] }) } }]),
});

test("37.1 silent builder is cancelled; next brief says silent; counts against cap", async () => {
  project.install({
    roles: {
      ...GOOD,
      builder: { replies: [[{ event: { type: "system", subtype: "init" } }, { pause: 20000 }], [{ event: { type: "system", subtype: "init" } }, { pause: 20000 }]] },
    },
  });
  await seed();
  const r = await build(["--silence-ms", "400", "--progress-ms", "10000", "--cap", "2"]);
  console.log("37.1", r.stdout, r.stderr);
  expect(transcriptOf(0)).toContain('"act":"silent"');
  expect(transcriptOf(0)).toContain("silent");
  expect(messages()).toHaveLength(2);
  expect(messages()[1]?.text).toContain("silent");
  expect(r.stdout).toContain("after 2 passes");
  expect(ticket()?.retries).toBe(2);
});

test("37.2 slow start is not silence", async () => {
  project.install({ roles: { ...GOOD, builder: { replies: [[{ pause: 900 }, edit("ok.txt", "d")]] } } });
  await seed();
  const r = await build(["--silence-ms", "400", "--progress-ms", "10000"]);
  expect(r.stdout).toContain("merging after 1 pass");
  expect(transcriptOf(0)).not.toContain('"act":"silent"');
});

test("37.3 asks: allow goes ahead, no verdict denies", async () => {
  project.install({
    roles: {
      ...GOOD,
      builder: {
        replies: [[
          { ask: { id: "a1", tool: "Bash", input: { command: "ls" } } },
          { ask: { id: "a2", tool: "Bash", input: { command: "pwd" } } },
          edit("ok.txt", "d"),
        ]],
      },
      classifier: { replies: [verdict('{"verdict":"allow","comment":"fine for this ticket"}'), verdict("unclear")] },
    },
  });
  await seed();
  const r = await build(["--silence-ms", "5000", "--progress-ms", "10000"]);
  const log = transcriptOf(0);
  console.log("37.3", log.split("\n").filter((l) => l.includes('"ask"')).join("\n"));
  expect(log).toContain("allowed Bash ls: fine for this ticket");
  expect(log).toContain("denied Bash pwd: the classifier gave no verdict");
  expect(r.stdout).toContain("merging after 1 pass");
});

test("37.4 looping cancels the pass, reason reaches next brief; no new call means no ask", async () => {
  project.install({
    roles: {
      ...GOOD,
      builder: { replies: [[callOf("t1"), { pause: 20000 }], [edit("ok.txt", "d")]] },
      classifier: { replies: [verdict('{"verdict":"looping","reason":"make fails the same way"}')] },
    },
  });
  await seed();
  const r = await build(["--silence-ms", "5000", "--progress-ms", "300"]);
  expect(r.stdout).toContain("merging after 2 passes");
  expect(transcriptOf(0)).toContain('"act":"looping"');
  expect(transcriptOf(0)).toContain("make fails the same way");
  expect(messages()[1]?.text).toContain("make fails the same way");
});

test("37.4b the classifier is not asked again when no new tool call came", async () => {
  project.install({
    roles: {
      ...GOOD,
      builder: { replies: [[callOf("t1"), resultOf("t1"), { pause: 3000 }, edit("ok.txt", "d")]] },
      classifier: { replies: [verdict('{"verdict":"not looping","reason":"moving"}'), verdict('{"verdict":"looping","reason":"should not be asked"}')] },
    },
  });
  await seed();
  const r = await build(["--silence-ms", "9000", "--progress-ms", "300"]);
  expect(r.stdout).toContain("merging after 1 pass");
  expect(launched("classifier")).toHaveLength(1);
});

test("37.5 a failed process probe cancels nothing", async () => {
  const bin = join(project.dir, "..", "badps");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "ps"), "#!/bin/sh\nexit 1\n");
  chmodSync(join(bin, "ps"), 0o755);
  project.install({
    roles: {
      ...GOOD,
      builder: { replies: [[callOf("t1"), { pause: 2500 }, resultOf("t1"), edit("ok.txt", "d")]] },
    },
  });
  await seed();
  const PATH = `${FAKE_DIR}:${bin}:${process.env.PATH}`;
  const r = await build(["--silence-ms", "400", "--flat-ms", "400", "--progress-ms", "20000"], { PATH });
  const log = transcriptOf(0);
  console.log("37.5", r.stdout, log.split("\n").filter((l) => l.includes("probe")).slice(0, 2).join("\n"));
  expect(log).toContain("probe-failed");
  expect(log).not.toContain('"act":"frozen"');
  expect(r.stdout).toContain("merging after 1 pass");
});
