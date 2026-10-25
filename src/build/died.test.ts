import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { DeadBuild } from "../board/dead-builds.ts";
import { readBoard } from "../board/log-store.ts";
import type { MessageRecord } from "../fake-agent/launch-log.ts";
import type { Reply, Script } from "../fake-agent/script.ts";
import { open } from "../map/mark-fixtures.ts";
import { sweepDeadBuilds } from "../serve/dead-builds-watch.ts";
import { createProject, type Project } from "../test-env/project.ts";

const CLI = join(import.meta.dir, "..", "cli.ts");
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
const board = () => readBoard(boardPath());
const ticket = () => board().tickets.get("r/01");
const writeLines = (path: string, events: unknown[]) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, events.map((e) => `${JSON.stringify(e)}\n`).join(""));
};
const builder = (...replies: Reply[]): Script => ({
  roles: { builder: { replies } },
});
const git = (...args: string[]) => project.run(["git", ...args]);

/** A pid whose process has exited. */
async function deadPid(): Promise<number> {
  const child = Bun.spawn(["true"]);
  await child.exited;
  return child.pid;
}

/** A ticket in building whose build of `pass` started in `pid` and has no end. */
async function seed(pid: number, pass = 2) {
  writeFileSync(join(project.dir, "Makefile"), "check:\n\t@test -f ok.txt\n");
  await git("add", "-A");
  await git("commit", "-q", "-m", "Add the Makefile");
  writeLines(project.logPath, [
    ...open("top", { title: "Seat price", why: "Because." }),
    { type: "node.edited", id: "top", who: "me", noBasis: "test" },
    { type: "criterion.added", id: "top", form: "revisit" },
    { type: "node.decided", id: "top" },
  ]);
  writeLines(boardPath(), [
    { type: "ticket.planned", id: "r/01", title: "Make the check pass" },
    { type: "ticket.moved", id: "r/01", to: "building", actor: "loop" },
    {
      type: "build.started",
      id: "r/01",
      session: `build-r-01-1:p${pass}`,
      pid,
      log: "l",
      branch: "r/01",
    },
  ]);
  const file = join(project.dir, ".werk", "tickets", "r", "01.md");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, TICKET);
}

beforeEach(() => {
  project = createProject();
});
afterEach(() => project.dispose());

const sweep = (cap?: number) => {
  const started: DeadBuild[] = [];
  const handled = sweepDeadBuilds({
    folder: project.dir,
    logPath: project.logPath,
    cap,
    start: (dead) => started.push(dead),
  });
  return { started, handled };
};

test("a dead build gets its end with died, and a fresh pass starts", async () => {
  await seed(await deadPid());
  const { started, handled } = sweep();
  expect(handled).toEqual(["r/01"]);
  expect(started).toEqual([
    {
      ticket: "r/01",
      session: "build-r-01-1:p2",
      buildId: "build-r-01-1",
      pass: 2,
    },
  ]);
  expect(ticket()?.builds[0]?.ended).toBe(true);
  expect(ticket()?.builds[0]?.result).toBe("died");
  expect(ticket()?.passes).toEqual([{ n: 2, result: "red" }]);
  expect(ticket()?.column).toBe("building");
  // The same build is not handled twice.
  expect(sweep().handled).toEqual([]);
});

test("a build that dies on its last allowed pass stops with died and starts nothing", async () => {
  await seed(await deadPid(), 5);
  const { started } = sweep(5);
  expect(started).toEqual([]);
  expect(ticket()?.builds[0]?.result).toBe("died");
  expect(ticket()?.column).toBe("ready");
  expect(ticket()?.reason).toContain("died on pass 5");
});

test("a live build, whoever started it, is not touched", async () => {
  await seed(process.pid);
  const before = Bun.file(boardPath()).size;
  const { started, handled } = sweep();
  expect(started).toEqual([]);
  expect(handled).toEqual([]);
  expect(Bun.file(boardPath()).size).toBe(before);
});

test("the fresh pass starts from the last commit of the branch, with the death as the last failure", async () => {
  project.install(builder([{ edit: "ok.txt", content: "done" }]));
  await seed(await deadPid(), 1);
  // The dead pass committed one file and left another uncommitted in its worktree.
  const dir = mkdtempSync(join(tmpdir(), "werk-died-"));
  const wt = join(dir, "wt");
  await git("worktree", "add", "-q", "-B", "r/01", wt, "HEAD");
  writeFileSync(join(wt, "kept.txt"), "kept");
  await project.run(["git", "add", "-A"], undefined, wt);
  await project.run(["git", "commit", "-q", "-m", "pass 1"], undefined, wt);
  writeFileSync(join(wt, "lost.txt"), "lost");

  sweep();
  const result = await project.run([
    "bun",
    CLI,
    "build",
    "r/01",
    "--after-death",
    "build-r-01-1:p1",
    "--cap",
    "2",
  ]);
  expect(result.stdout).toContain("merging after 2 passes");
  expect(existsSync(wt)).toBe(false);
  const files = (await git("ls-tree", "--name-only", "r/01")).stdout;
  expect(files).toContain("kept.txt");
  expect(files).not.toContain("lost.txt");
  const log = await git("log", "--format=%s", "r/01");
  expect(log.stdout.split("\n").slice(0, 2)).toEqual(["pass 2", "pass 1"]);
  const [message] = project
    .launches()
    .filter((r): r is MessageRecord => r.kind === "message");
  expect(message?.text).toContain("This is pass 2");
  expect(message?.text).toContain("Pass 1 died");
  expect(ticket()?.column).toBe("merging");
});

test("a fresh pass after a death needs a ticket in building and a build session id", async () => {
  await seed(await deadPid());
  const bad = await project.run([
    "bun",
    CLI,
    "build",
    "r/01",
    "--after-death",
    "nope",
  ]);
  expect(bad.code).toBe(2);
  writeLines(boardPath(), [
    { type: "ticket.planned", id: "r/01", title: "Make the check pass" },
  ]);
  const ready = await project.run([
    "bun",
    CLI,
    "build",
    "r/01",
    "--after-death",
    "build-r-01-1:p1",
  ]);
  expect(ready.code).toBe(1);
  expect(ready.stderr).toContain("not in building");
});
