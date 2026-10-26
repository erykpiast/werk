import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { readBoard } from "../../src/board/log-store.ts";
import type { LaunchRecord, MessageRecord } from "../../src/fake-agent/launch-log.ts";
import type { Reply, Script } from "../../src/fake-agent/script.ts";
import { open } from "../../src/map/mark-fixtures.ts";
import { readPipeline } from "../../src/pipeline/log-store.ts";
import { createProject, type Project } from "../../src/test-env/project.ts";

const CLI = join(import.meta.dir, "..", "..", "src", "cli.ts");
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
const result = (text: string): Reply => [
  { event: { type: "result", subtype: "success", is_error: false, result: text } },
];
const verdict = (text: string): Reply => result(text);
const line = (id: string, score: number) => ({ line: id, score, gap: "" });
const ALL_GOOD = result(
  JSON.stringify({
    lines: [line("criterion-1", 4), line("card-top", 4), line("scope", 5)],
  }),
);
const NONE = result(JSON.stringify({ findings: [] }));
const AREAS = [
  "reviewer-design",
  "reviewer-maintainability",
  "reviewer-tests",
  "reviewer-security",
  "reviewer-performance",
];
const judges = () => ({
  grader: { replies: Array(5).fill(ALL_GOOD) },
  ...Object.fromEntries(AREAS.map((r) => [r, { replies: Array(5).fill(NONE) }])),
});
const script = (builds: Reply[], extra: Script["roles"] = {}): Script => ({
  roles: { ...judges(), builder: { replies: builds }, ...extra },
});
const builderMessages = () =>
  project
    .launches()
    .filter((r): r is MessageRecord => r.kind === "message" && r.role === "builder");
const launches = () =>
  project.launches().filter((r): r is LaunchRecord => r.kind === "launch");

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
  writeLines(boardPath(), [
    { type: "ticket.planned", id: "r/01", title: "Make the check pass" },
  ]);
  const file = join(project.dir, ".werk", "tickets", "r", "01.md");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, TICKET);
}

const build = (extra: string[], env?: Record<string, string>) =>
  project.run(["bun", CLI, "build", "r/01", "--poll-ms", "100", ...extra], env);
const transcriptOf = (pass: number) => {
  const file = readPipeline(pipelinePath()).builds.values().next().value?.passes[pass]
    ?.transcript;
  return readFileSync(join(dirname(pipelinePath()), file ?? "none"), "utf8");
};
const toolCall = (id = "t1") => ({
  event: {
    type: "assistant",
    message: {
      content: [{ type: "tool_use", id, name: "Bash", input: { command: "make" } }],
    },
  },
});

beforeEach(() => {
  project = createProject();
});
afterEach(() => project.dispose());

test("37.1 a silent builder is cancelled for silence and the next pass is told", async () => {
  project.install(
    script([[{ event: { type: "system", subtype: "init" } }, { pause: 20_000 }], [edit("ok.txt", "done")]]),
  );
  await seed();
  const r = await build(["--silence-ms", "400", "--progress-ms", "10000"]);
  expect(r.stdout).toContain("merging after 2 passes");
  expect(transcriptOf(0)).toMatch(/"act":"silent"/);
  expect(transcriptOf(0)).toMatch(/silent/);
  expect(builderMessages()[1]?.text).toContain("silent");
  expect(ticket()?.passes.map((p) => p.result)).toEqual(["red", "green"]);
  expect(builderMessages().length).toBe(2);
});

test("37.2 a slow start is not silence", async () => {
  project.install(script([[{ pause: 900 }, edit("ok.txt", "done")]]));
  await seed();
  const r = await build(["--silence-ms", "400", "--progress-ms", "10000"]);
  expect(r.stdout).toContain("merging after 1 pass");
  expect(transcriptOf(0)).not.toContain('"act":"silent"');
});

test("37.3 the classifier decides asks and no verdict means deny", async () => {
  project.install(
    script(
      [
        [
          { ask: { id: "a1", tool: "Bash", input: { command: "ls" } } },
          { ask: { id: "a2", tool: "Bash", input: { command: "pwd" } } },
          edit("ok.txt", "done"),
        ],
      ],
      {
        classifier: {
          replies: [
            verdict('{"verdict":"allow","comment":"read only"}'),
            verdict("hard to say"),
          ],
        },
      },
    ),
  );
  await seed();
  await build(["--silence-ms", "5000", "--progress-ms", "10000"]);
  const log = transcriptOf(0);
  expect(log).toContain("allowed Bash ls: read only");
  expect(log).toContain("denied Bash pwd: the classifier gave no verdict");
  expect(log).toContain('"content":"allowed"');
  expect(log).toContain("The overseer denied this call");
  expect(ticket()?.column).toBe("merging");
});

test("37.4 a looping verdict cancels the pass; no new call means no question", async () => {
  project.install(
    script([[toolCall(), { pause: 20_000 }], [edit("ok.txt", "done")]], {
      classifier: {
        replies: [verdict('{"verdict":"looping","reason":"make fails the same way"}')],
      },
    }),
  );
  await seed();
  const r = await build(["--silence-ms", "5000", "--progress-ms", "300"]);
  expect(r.stdout).toContain("merging after 2 passes");
  const log = transcriptOf(0);
  expect(log).toContain('"act":"looping"');
  expect(log).toContain("make fails the same way");
  expect(builderMessages()[1]?.text).toContain("make fails the same way");
});

test("37.4b with no new tool call since the last verdict the classifier is not asked", async () => {
  project.install(
    script([[toolCall(), { pause: 1500 }, edit("ok.txt", "done")]], {
      classifier: { replies: [verdict('{"verdict":"not looping","reason":"progress"}'), verdict('{"verdict":"not looping","reason":"progress"}'), verdict('{"verdict":"not looping","reason":"progress"}')] },
    }),
  );
  await seed();
  await build(["--silence-ms", "5000", "--flat-ms", "60000", "--progress-ms", "200"]);
  const asked = launches().filter((l) => l.role === "classifier").length;
  expect(asked).toBeLessThanOrEqual(1);
});

function psShim(): string {
  const dir = mkdtempSync(join(tmpdir(), "werk-ps-"));
  const ps = join(dir, "ps");
  writeFileSync(ps, "#!/bin/sh\necho 'ps: cannot read the process table' >&2\nexit 1\n");
  chmodSync(ps, 0o755);
  return dir;
}

test("37.5 a failed process probe cancels nothing", async () => {
  project.install(script([[toolCall(), { pause: 2500 }, edit("ok.txt", "done")]]));
  await seed();
  const shim = psShim();
  const r = await build(
    ["--silence-ms", "300", "--flat-ms", "400", "--progress-ms", "60000"],
    { PATH: `${shim}:${process.env.PATH}` },
  );
  expect(r.stdout).toContain("merging after 1 pass");
  const log = transcriptOf(0);
  expect(log).toContain('"act":"probe-failed"');
  expect(log).not.toContain('"act":"frozen"');
  expect(log).not.toContain('"act":"silent"');
});

test("37.5b with a failed probe the pass ends at the wall-clock limit", async () => {
  project.install(script([[toolCall(), { pause: 20_000 }], [edit("ok.txt", "done")]]));
  await seed();
  const shim = psShim();
  const r = await build(
    ["--silence-ms", "300", "--flat-ms", "400", "--progress-ms", "60000", "--agent-ms", "2500", "--cap", "1"],
    { PATH: `${shim}:${process.env.PATH}` },
  );
  const log = transcriptOf(0);
  expect(log).toContain('"act":"probe-failed"');
  expect(log).not.toContain('"act":"frozen"');
  expect(r.stdout).not.toContain("merging");
});
