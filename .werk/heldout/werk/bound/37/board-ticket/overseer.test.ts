import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { readBoard } from "../../src/board/log-store.ts";
import type { LaunchRecord, MessageRecord } from "../../src/fake-agent/launch-log.ts";
import type { Reply } from "../../src/fake-agent/script.ts";
import { createOverseer } from "../../src/overseer/overseer.ts";
import { open } from "../../src/map/mark-fixtures.ts";
import { readPipeline } from "../../src/pipeline/log-store.ts";
import { createProject, type Project } from "../../src/test-env/project.ts";
import { CLI } from "./support.ts";

const MAKEFILE = "check:\n\t@test -f ok.txt\n";
const TICKET = `title: Make the check pass
cites: top
blocked_by:
stories: 1
touches: checks

## What to build

Make ok.txt exist.

## Acceptance criteria

- [ ] ok.txt exists

## Checks

- \`make check\`
`;

let project: Project;
const boardPath = () => join(project.dir, ".werk", "board.jsonl");
const pipelinePath = () => join(project.dir, ".werk", "pipeline.jsonl");
const ticket = () => readBoard(boardPath()).tickets.get("r/01");
const writeLines = (path: string, events: unknown[]) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, events.map((e) => `${JSON.stringify(e)}\n`).join(""));
};
const edit = (path: string, content: string) => ({ edit: path, content });
const messages = () => project.launches().filter((r): r is MessageRecord => r.kind === "message");
const launches = () => project.launches().filter((r): r is LaunchRecord => r.kind === "launch");
const verdict = (text: string): Reply => [{ event: { type: "result", subtype: "success", result: text } }];
const transcriptOf = (pass: number) => {
  const file = readPipeline(pipelinePath()).builds.values().next().value?.passes[pass]?.transcript;
  return readFileSync(join(dirname(pipelinePath()), file ?? "none"), "utf8");
};
const toolCall = {
  event: { type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "make" } }] } },
};

async function seed() {
  writeFileSync(join(project.dir, "Makefile"), MAKEFILE);
  await project.run(["git", "add", "-A"]);
  await project.run(["git", "commit", "-q", "-m", "Add the Makefile"]);
  writeLines(project.logPath, [
    ...open("top", { title: "Seat price", why: "Because." }),
    { type: "node.edited", id: "top", who: "me", noBasis: "test" },
    { type: "criterion.added", id: "top", form: "revisit" },
    { type: "node.decided", id: "top" },
  ]);
  writeLines(boardPath(), [{ type: "ticket.planned", id: "r/01", title: "Make the check pass" }]);
  const file = join(project.dir, ".werk", "tickets", "r", "01.md");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, TICKET);
}
const build = (extra: string[], env?: Record<string, string>) =>
  project.run(["bun", CLI, "build", "r/01", "--poll-ms", "100", ...extra], env);

beforeEach(() => {
  project = createProject();
});
afterEach(() => project.dispose());

test("37.1 a silent builder is cancelled and the next pass is told why", async () => {
  project.install({
    roles: {
      builder: {
        replies: [[{ event: { type: "system", subtype: "init" } }, { pause: 20_000 }], [edit("ok.txt", "done")]],
      },
    },
  });
  await seed();
  const r = await build(["--silence-ms", "300", "--progress-ms", "10000", "--cap", "3"]);
  expect(r.stdout).toContain("merging after 2 passes");
  expect(transcriptOf(0)).toMatch(/"act":"silent".*no event for/);
  expect(messages().filter((m) => m.role === "builder")[1]?.text).toContain("silent");
  expect(launches().filter((l) => l.role === "builder")).toHaveLength(2);
  expect(ticket()?.passes.map((p) => p.result)).toEqual(["red", "green"]);
  expect(ticket()?.retries).toBe(1);
});

test("37.2 a slow start is not treated as silence", async () => {
  project.install({ roles: { builder: { replies: [[{ pause: 900 }, edit("ok.txt", "done")]] } } });
  await seed();
  const r = await build(["--silence-ms", "300", "--progress-ms", "10000"]);
  expect(r.stdout).toContain("merging after 1 pass");
  expect(transcriptOf(0)).not.toContain('"act":"silent"');
  expect(launches().filter((l) => l.role === "builder")).toHaveLength(1);
});

test("37.3 a permission ask is decided by the classifier, and no verdict means deny", async () => {
  project.install({
    roles: {
      builder: {
        replies: [
          [
            { ask: { id: "a1", tool: "Bash", input: { command: "ls" } } },
            { pause: 2500 },
            { ask: { id: "a2", tool: "Bash", input: { command: "pwd" } } },
            edit("ok.txt", "done"),
          ],
        ],
      },
      classifier: {
        replies: [verdict('{"verdict":"allow","comment":"read only listing"}'), verdict("hard to say")],
      },
    },
  });
  await seed();
  const r = await build(["--silence-ms", "8000", "--progress-ms", "20000"]);
  expect(r.stdout).toContain("merging after 1 pass");
  const log = transcriptOf(0);
  expect(log).toContain("allowed Bash ls: read only listing");
  expect(log).toContain("denied Bash pwd: the classifier gave no verdict");
  // The builder's call went ahead for a1, and a2 returned as an error result while the builder continued.
  const lines = log.split("\n").filter((l) => l.includes("tool_result"));
  expect(lines.some((l) => l.includes('"tool_use_id":"a1"') && l.includes('"is_error":false'))).toBe(true);
  expect(lines.some((l) => l.includes('"tool_use_id":"a2"') && l.includes('"is_error":true'))).toBe(true);
});

test("37.4 a looping verdict cancels the pass and the reason reaches the next brief", async () => {
  project.install({
    roles: {
      builder: { replies: [[toolCall, { pause: 20_000 }], [edit("ok.txt", "done")]] },
      classifier: { replies: [verdict('{"verdict":"looping","reason":"make fails the same way"}')] },
    },
  });
  await seed();
  const r = await build(["--silence-ms", "5000", "--progress-ms", "300"]);
  expect(r.stdout).toContain("merging after 2 passes");
  const log = transcriptOf(0);
  expect(log).toContain('"act":"looping"');
  expect(log).toContain("make fails the same way");
  expect(messages().filter((m) => m.role === "builder")[1]?.text).toContain("make fails the same way");
});

test("37.4b the classifier is not asked again when no new tool call came", async () => {
  project.install({
    roles: {
      builder: { replies: [[toolCall, { pause: 3000 }, edit("ok.txt", "done")]] },
      classifier: {
        replies: [verdict('{"verdict":"not looping","reason":"fine"}'), verdict('{"verdict":"looping","reason":"second ask"}')],
      },
    },
  });
  await seed();
  const r = await build(["--silence-ms", "8000", "--progress-ms", "300", "--flat-ms", "60000"]);
  expect(r.stdout).toContain("merging after 1 pass");
  expect(launches().filter((l) => l.role === "classifier")).toHaveLength(1);
});

test("37.5 a failed process probe cancels nothing", async () => {
  project.install({
    roles: { builder: { replies: [[toolCall, { pause: 2500 }, edit("ok.txt", "done")]] } },
  });
  await seed();
  const stubDir = mkdtempSync(join(tmpdir(), "werk-ps-stub-"));
  const ps = join(stubDir, "ps");
  writeFileSync(ps, "#!/bin/sh\necho 'ps: cannot read the process table' >&2\nexit 1\n");
  chmodSync(ps, 0o755);
  const r = await build(
    ["--silence-ms", "300", "--flat-ms", "400", "--progress-ms", "20000", "--agent-ms", "30000"],
    { PATH: [dirname(CLI).replace(/src$/, "fake"), stubDir, process.env.PATH ?? ""].join(delimiter) },
  );
  expect(r.stdout).toContain("merging after 1 pass");
  const log = transcriptOf(0);
  expect(log).toContain('"act":"probe-failed"');
  expect(log).not.toContain('"act":"frozen"');
  expect(log).not.toContain('"act":"silent"');
});

test("37.4c the classifier reads the brief and the new tool calls, and is not asked without a new call", async () => {
  let now = 0;
  const prompts: string[] = [];
  const notes: string[] = [];
  const cancels: string[] = [];
  let answerWith = '{"verdict":"not looping","reason":"moving on"}';
  const overseer = createOverseer(
    { silenceMs: 1_000_000, flatMs: 1_000_000, progressMs: 100, sampleMs: 1_000_000 },
    {
      now: () => now,
      cancel: (r) => cancels.push(r),
      killProcesses: () => {},
      reply: () => {},
      note: (act, text) => notes.push(`${act}: ${text}`),
      classify: async (p) => {
        prompts.push(p);
        return answerWith;
      },
      probe: async () => ({ ok: false, why: "no" }),
    },
    { brief: "THE BRIEF TEXT", ticket: "t", asks: true },
  );
  const call = (id: string, command: string) =>
    overseer.event({ type: "assistant", message: { content: [{ type: "tool_use", id, name: "Bash", input: { command } }] } });
  const done = (id: string) =>
    overseer.event({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id }] } });
  call("c1", "make check");
  done("c1");
  now = 200;
  await overseer.tick();
  expect(prompts).toHaveLength(1);
  expect(prompts[0]).toContain("THE BRIEF TEXT");
  expect(prompts[0]).toContain("Bash make check");
  // No new call since the last verdict: not asked again.
  now = 400;
  await overseer.tick();
  now = 600;
  await overseer.tick();
  expect(prompts).toHaveLength(1);
  answerWith = '{"verdict":"looping","reason":"same failing call"}';
  call("c2", "make check again");
  done("c2");
  now = 800;
  await overseer.tick();
  expect(prompts).toHaveLength(2);
  expect(prompts[1]).toContain("Bash make check again");
  expect(prompts[1]).not.toContain("- Bash make check\n");
  expect(cancels[0]).toContain("same failing call");
  expect(notes.join("\n")).toContain("looping: same failing call");
});
