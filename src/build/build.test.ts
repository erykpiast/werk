import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { readBoard } from "../board/log-store.ts";
import type { LaunchRecord, MessageRecord } from "../fake-agent/launch-log.ts";
import type { Reply, Script } from "../fake-agent/script.ts";
import { open } from "../map/mark-fixtures.ts";
import { readPipeline } from "../pipeline/log-store.ts";
import { createProject, type Project } from "../test-env/project.ts";

const CLI = join(import.meta.dir, "..", "cli.ts");
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
const board = () => readBoard(boardPath());
const ticket = () => board().tickets.get("r/01");
const writeLines = (path: string, events: unknown[]) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, events.map((e) => `${JSON.stringify(e)}\n`).join(""));
};
const edit = (path: string, content: string) => ({ edit: path, content });
const builder = (...replies: Reply[]): Script => ({
  roles: { builder: { replies } },
});
const messages = () =>
  project.launches().filter((r): r is MessageRecord => r.kind === "message");
const launches = () =>
  project.launches().filter((r): r is LaunchRecord => r.kind === "launch");

async function seed(makefile = MAKEFILE) {
  writeFileSync(join(project.dir, "Makefile"), makefile);
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

const build = (...extra: string[]) =>
  project.run(["bun", CLI, "build", "r/01", "--poll-ms", "100", ...extra]);
const branches = async () =>
  (await project.run(["git", "branch", "--list", "r/01"])).stdout.trim();

beforeEach(() => {
  project = createProject();
});
afterEach(() => project.dispose());

test("a builder that passes the checks on pass 2 moves the ticket to merging", async () => {
  project.install(
    builder([edit("note.txt", "not yet")], [edit("ok.txt", "done")]),
  );
  await seed();
  const result = await build();
  expect(result.stdout).toContain("merging after 2 passes");
  expect(result.code).toBe(0);
  expect(ticket()?.column).toBe("merging");
  expect(ticket()?.branch).toBe("r/01");
  const log = await project.run(["git", "log", "--format=%s", "r/01"]);
  expect(log.stdout.split("\n").slice(0, 2)).toEqual(["pass 2", "pass 1"]);
  // The worktree folder is gone and the branch stays.
  expect(await branches()).toContain("r/01");
  const worktrees = await project.run(["git", "worktree", "list"]);
  expect(worktrees.stdout.trim().split("\n")).toHaveLength(1);
  // The sessions are on the board and the steps are in the pipeline log.
  expect(ticket()?.builds.map((b) => b.ended)).toEqual([true, true]);
  expect(ticket()?.passes.map((p) => p.result)).toEqual(["red", "green"]);
  const pipeline = [...readPipeline(pipelinePath()).builds.values()][0];
  expect(pipeline?.passes.map((p) => p.result)).toEqual(["red", "green"]);
  expect(pipeline?.passes[0]?.gate).toBe("check");
});

test("the launch record of pass 2 holds the last failure and the decided-card index", async () => {
  project.install(
    builder([edit("note.txt", "not yet")], [edit("ok.txt", "done")]),
  );
  await seed();
  await build();
  const [first, second] = messages().map((m) => m.text);
  expect(first).toStartWith("/implement");
  expect(first).toContain("Nothing is done yet");
  expect(first).toContain("Nothing has failed yet");
  expect(second).toContain("This is pass 2");
  expect(second).toContain("$ make check");
  expect(second).toContain("top  Seat price");
  expect(second).toContain("### #top — Seat price");
  // Each pass is a fresh launch of the builder, with its role outside the prompt.
  expect(launches().map((l) => l.role)).toEqual(["builder", "builder"]);
});

test("a builder that never passes stops at the cap and the ticket goes back to ready", async () => {
  project.install(builder([edit("a.txt", "1")], [edit("a.txt", "2")]));
  await seed();
  const result = await build("--cap", "2");
  expect(result.code).toBe(1);
  expect(result.stdout).toContain("ready after 2 passes");
  expect(ticket()?.column).toBe("ready");
  expect(ticket()?.reason).toBe("red at the retry cap of 2");
  expect(ticket()?.retries).toBe(2);
  expect(await branches()).toContain("r/01");
});

test("a red check that passes on its rerun is flaky and does not fail the pass", async () => {
  const flag = join(project.dir, "..", "flag");
  project.install(builder([edit("ok.txt", "done")]));
  await seed(`check:\n\t@test -f "${flag}" || { touch "${flag}"; exit 1; }\n`);
  const result = await build();
  expect(result.stdout).toContain("merging after 1 pass");
  const pass = [...readPipeline(pipelinePath()).builds.values()][0]?.passes[0];
  expect(pass?.result).toBe("green");
  expect(pass?.flaky).toEqual(["check"]);
});

test("a check that cannot run is check infrastructure and is not run again", async () => {
  project.install(builder([edit("a.txt", "1")]));
  await seed("check:\n\t@sh -c werk-no-such-tool\n");
  await build("--cap", "1");
  const pass = [...readPipeline(pipelinePath()).builds.values()][0]?.passes[0];
  expect(pass?.cause).toBe("check-infrastructure");
  const started = readFileSync(pipelinePath(), "utf8")
    .split("\n")
    .filter((line) => line.includes('"step.started"'))
    .filter((line) => line.includes('"step":"check"'));
  expect(started).toHaveLength(1);
});

test("a check that runs past its time limit is check infrastructure", async () => {
  project.install(builder([edit("a.txt", "1")]));
  await seed("check:\n\t@sleep 20\n");
  await build("--cap", "1", "--check-ms", "300");
  const pass = [...readPipeline(pipelinePath()).builds.values()][0]?.passes[0];
  expect(pass?.cause).toBe("check-infrastructure");
  expect(pass?.reason).toContain("time limit");
});

test("archiving the ticket during a pass stops the agent within about a second and keeps the branch", async () => {
  project.install(builder([edit("a.txt", "1"), { pause: 30_000 }]));
  await seed();
  const child = project.start([
    "bun",
    CLI,
    "build",
    "r/01",
    "--poll-ms",
    "100",
  ]);
  const until = Date.now() + 15_000;
  while (!ticket()?.builds.length && Date.now() < until) await Bun.sleep(50);
  expect(ticket()?.builds).toHaveLength(1);
  const archivedAt = Date.now();
  writeFileSync(
    boardPath(),
    `${readFileSync(boardPath(), "utf8")}${JSON.stringify({ type: "ticket.archived", id: "r/01" })}\n`,
  );
  const code = await child.exited;
  expect(Date.now() - archivedAt).toBeLessThan(2500);
  expect(code).toBe(1);
  expect(await branches()).toContain("r/01");
  // Nothing of the pass was committed or counted.
  const log = await project.run(["git", "log", "--format=%s", "r/01"]);
  expect(log.stdout.trim()).toBe("Add the Makefile\nStart");
  expect(ticket()?.passes).toEqual([]);
  expect(ticket()?.retries).toBe(0);
  expect(ticket()?.column).toBe("building");
  expect(ticket()?.builds[0]?.ended).toBe(true);
  const archived = [...readPipeline(pipelinePath()).builds.values()][0];
  expect(archived?.counted).toBe(0);
  expect(archived?.passes[0]?.archived).toBe(true);
  expect(archived?.passes[0]?.transcript).toBeDefined();
  const worktrees = await project.run(["git", "worktree", "list"]);
  expect(worktrees.stdout.trim().split("\n")).toHaveLength(1);
});

test("a ticket that is not in ready is refused and nothing is written", async () => {
  project.install(builder([edit("ok.txt", "done")]));
  await seed();
  await build();
  const again = await build();
  expect(again.code).toBe(1);
  expect(again.stderr).toContain("is in merging, not in ready");
  const unknown = await project.run(["bun", CLI, "build", "r/09"]);
  expect(unknown.code).toBe(1);
  expect(unknown.stderr).toContain("no ticket r/09");
  expect(existsSync(pipelinePath())).toBe(true);
});

test("bad arguments exit 2", async () => {
  expect((await project.run(["bun", CLI, "build"])).code).toBe(2);
  expect((await build("--cap", "0")).code).toBe(2);
  expect((await build("--nope", "1")).code).toBe(2);
});
