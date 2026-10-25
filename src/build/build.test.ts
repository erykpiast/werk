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
const result = (text: string): Reply => [
  {
    event: {
      type: "result",
      subtype: "success",
      is_error: false,
      result: text,
    },
  },
];
const line = (id: string, score: number, gap = "", more = {}) => ({
  line: id,
  score,
  gap,
  ...more,
});
const gradeOf = (...lines: unknown[]): Reply =>
  result(JSON.stringify({ lines }));
const ALL_GOOD = gradeOf(
  line("criterion-1", 4),
  line("card-top", 4),
  line("scope", 5),
);
const findingsOf = (...findings: unknown[]): Reply =>
  result(JSON.stringify({ findings }));
const AREA_ROLES = [
  "reviewer-design",
  "reviewer-maintainability",
  "reviewer-tests",
  "reviewer-security",
  "reviewer-performance",
];
type Judging = { grades?: Reply[]; reviews?: Record<string, Reply[]> };
/** A script with the builder replies, and a grader and five reviewers that find nothing unless the test says so. */
const withJudges = (builds: Reply[], judging: Judging = {}): Script => ({
  roles: {
    builder: { replies: builds },
    grader: { replies: judging.grades ?? Array(5).fill(ALL_GOOD) },
    ...Object.fromEntries(
      AREA_ROLES.map((role) => [
        role,
        { replies: judging.reviews?.[role] ?? Array(5).fill(findingsOf()) },
      ]),
    ),
  },
});
const builder = (...replies: Reply[]): Script => withJudges(replies);
/** The prompts that the builder sessions got. */
const messages = () =>
  project
    .launches()
    .filter(
      (r): r is MessageRecord => r.kind === "message" && r.role === "builder",
    );
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
  const roles = launches().map((l) => l.role);
  expect(roles.filter((role) => role === "builder")).toHaveLength(2);
  // Pass 1 is red at its check, so no judge ran. The green pass 2 runs the grader, then the five reviewers.
  expect(roles.slice(0, 3)).toEqual(["builder", "builder", "grader"]);
  expect(roles.slice(3, 8).sort()).toEqual([...AREA_ROLES].sort());
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

const launched = (role: string) => launches().filter((l) => l.role === role);

test("a grade of 2 on one criterion fails the pass, and the next builder prompt holds that gap", async () => {
  project.install(
    withJudges([[edit("ok.txt", "done")], [edit("note.txt", "more")]], {
      grades: [
        gradeOf(
          line("criterion-1", 2, "ok.txt is empty: the check cannot tell"),
          line("card-top", 4),
          line("scope", 5),
        ),
        ALL_GOOD,
      ],
    }),
  );
  await seed();
  const result = await build();
  expect(result.stdout).toContain("merging after 2 passes");
  expect(messages().map((m) => m.text)[1]).toContain(
    "ok.txt is empty: the check cannot tell",
  );
  // A failed grade stops before the review: only the second pass ran reviewers.
  expect(launched("reviewer-design")).toHaveLength(1);
  const pass = [...readPipeline(pipelinePath()).builds.values()][0]?.passes[0];
  expect(pass?.gate).toBe("grader");
});

test("a second grade passes a line the first grade passed, even with a new gap there", async () => {
  project.install(
    withJudges([[edit("ok.txt", "done")], [edit("note.txt", "more")]], {
      grades: [
        gradeOf(
          line("criterion-1", 2, "first gap"),
          line("card-top", 4),
          line("scope", 5),
        ),
        gradeOf(
          line("criterion-1", 4),
          line("card-top", 2, "a detail the first grade did not name"),
          line("scope", 5),
        ),
      ],
    }),
  );
  await seed();
  const result = await build();
  expect(result.stdout).toContain("merging after 2 passes");
});

test("a second grade fails a line that passed before when it names a regression", async () => {
  project.install(
    withJudges([[edit("ok.txt", "done")], [edit("note.txt", "more")]], {
      grades: [
        gradeOf(
          line("criterion-1", 2, "first gap"),
          line("card-top", 4),
          line("scope", 5),
        ),
        gradeOf(
          line("criterion-1", 4),
          line("card-top", 2, "pass 2 broke the card", { regression: true }),
          line("scope", 5),
        ),
      ],
    }),
  );
  await seed();
  const result = await build("--cap", "2");
  expect(result.stdout).toContain("ready after 2 passes");
});

test("a line the grader leaves out scores 0 and fails the pass", async () => {
  project.install(
    withJudges([[edit("ok.txt", "done")]], {
      grades: [gradeOf(line("criterion-1", 4), line("scope", 5))],
    }),
  );
  await seed();
  const result = await build("--cap", "1");
  expect(result.stdout).toContain("ready after 1 pass");
  const pass = [...readPipeline(pipelinePath()).builds.values()][0]?.passes[0];
  expect(pass?.gate).toBe("grader");
  expect(pass?.reason).toContain("card-top");
});

test("a HIGH finding from the security reviewer alone fails the pass and names the finding", async () => {
  project.install(
    withJudges([[edit("ok.txt", "done")], [edit("note.txt", "more")]], {
      reviews: {
        "reviewer-security": [
          findingsOf({
            severity: "HIGH",
            file: "ok.txt",
            line: 3,
            impact: "the secret is written in plain text",
            fix: "read it from the environment",
          }),
          findingsOf(),
        ],
      },
    }),
  );
  await seed();
  const result = await build();
  expect(result.stdout).toContain("merging after 2 passes");
  const pass = [...readPipeline(pipelinePath()).builds.values()][0]?.passes[0];
  expect(pass?.gate).toBe("reviewer");
  expect(pass?.reason).toContain("security HIGH at ok.txt:3");
  const second = messages().map((m) => m.text)[1];
  expect(second).toContain("the secret is written in plain text");
  expect(second).toContain("read it from the environment");
});

test("a MEDIUM, a LOW and an unknown severity are recorded and do not block", async () => {
  project.install(
    withJudges([[edit("ok.txt", "done")]], {
      reviews: {
        "reviewer-design": [
          findingsOf(
            {
              severity: "MEDIUM",
              file: "a.ts",
              line: 1,
              impact: "i",
              fix: "f",
            },
            { severity: "LOW", file: "b.ts", line: 2, impact: "i", fix: "f" },
            {
              severity: "trivial",
              file: "c.ts",
              line: 3,
              impact: "i",
              fix: "f",
            },
          ),
        ],
      },
    }),
  );
  await seed();
  const result = await build();
  expect(result.stdout).toContain("merging after 1 pass");
  const events = readFileSync(pipelinePath(), "utf8")
    .split("\n")
    .filter((l) => l.includes('"step":"pass"') && l.includes('"step.ended"'));
  const file = JSON.parse(events[0] as string).findings as string;
  const recorded = JSON.parse(
    readFileSync(join(dirname(pipelinePath()), file), "utf8"),
  );
  expect(recorded.map((f: { severity: string }) => f.severity)).toEqual([
    "MEDIUM",
    "LOW",
    "trivial",
  ]);
});

test("a broken grader and a silent reviewer each fail the pass as a failed step", async () => {
  project.install(
    withJudges([[edit("ok.txt", "done")]], {
      grades: [result("I could not decide.")],
    }),
  );
  await seed();
  await build("--cap", "1");
  const pass = [...readPipeline(pipelinePath()).builds.values()][0]?.passes[0];
  expect(pass?.gate).toBe("grader");
  expect(pass?.reason).toContain("broken");
});

test("a reviewer that exits with no answer fails the pass and the next builder prompt names it", async () => {
  const script = withJudges([
    [edit("ok.txt", "done")],
    [edit("note.txt", "x")],
  ]);
  script.roles["reviewer-tests"] = {
    replies: [
      [{ crash: 3 }],
      [
        {
          event: {
            type: "result",
            subtype: "success",
            is_error: false,
            result: '{"findings":[]}',
          },
        },
      ],
    ],
  };
  project.install(script);
  await seed();
  await build();
  const pass = [...readPipeline(pipelinePath()).builds.values()][0]?.passes[0];
  expect(pass?.gate).toBe("reviewer");
  expect(messages().map((m) => m.text)[1]).toContain(
    "the reviewer-tests failed",
  );
});

test("the grader's launch record holds the read-only tool list and no write tool", async () => {
  project.install(builder([edit("ok.txt", "done")]));
  await seed();
  await build();
  const [grader] = launched("grader");
  const args = grader?.args ?? [];
  expect(args[args.indexOf("--tools") + 1]).toBe("Read,Grep,Glob,Bash");
  const allowed = args[args.indexOf("--allowedTools") + 1]?.split(",") ?? [];
  expect(allowed).toEqual([
    "Read",
    "Grep",
    "Glob",
    "Bash(git diff:*)",
    "Bash(git log:*)",
    "Bash(git show:*)",
  ]);
  for (const write of ["Edit", "Write", "MultiEdit", "NotebookEdit"]) {
    expect(args.join(" ")).not.toContain(write);
  }
  // A reviewer has the same list.
  const [reviewer] = launched("reviewer-security");
  expect(reviewer?.args).toContain("Read,Grep,Glob,Bash");
});

test("checks stop at the first red, so no grader runs on a red pass", async () => {
  project.install(builder([edit("a.txt", "1")]));
  await seed();
  await build("--cap", "1");
  expect(launched("grader")).toEqual([]);
});

test("the last counted pass that fails only on a small gap merges and files a follow-up that quotes it", async () => {
  const small = (gap: string) =>
    gradeOf(
      line("criterion-1", 4),
      line("card-top", 2, gap, { builds: true }),
      line("scope", 5),
    );
  project.install(
    withJudges([[edit("ok.txt", "done")], [edit("note.txt", "more")]], {
      grades: [
        small("an empty seat list is still sent"),
        small("the list is still sent\nwhen empty"),
      ],
    }),
  );
  await seed();
  const result = await build("--cap", "2");
  expect(result.stdout).toContain("merging after 2 passes");
  expect(result.stdout).toContain("follow-up r/02 filed");
  expect(result.code).toBe(0);
  expect(ticket()?.column).toBe("merging");
  expect(ticket()?.followups).toEqual(["r/02"]);
  const followup = board().tickets.get("r/02");
  expect(followup?.column).toBe("ready");
  expect(followup?.blockedBy).toEqual(["r/01"]);
  const file = readFileSync(
    join(project.dir, ".werk", "tickets", "r", "02.md"),
    "utf8",
  );
  expect(file).toContain("cites: top");
  expect(file).toContain('#top: "the list is still sent when empty"');
  expect(file).toContain("- `make check`");
  // The first pass had the same gap, but it was not the last counted pass.
  const first = [...readPipeline(pipelinePath()).builds.values()][0]?.passes[0];
  expect(first?.result).toBe("red");
});

test("a small gap on the last pass does not merge when an acceptance criterion is also unmet", async () => {
  const grade = gradeOf(
    line("criterion-1", 2, "ok.txt is wrong"),
    line("card-top", 2, "a small gap", { builds: true }),
    line("scope", 5),
  );
  project.install(
    withJudges([[edit("ok.txt", "done")], [edit("note.txt", "more")]], {
      grades: [grade, grade],
    }),
  );
  await seed();
  const result = await build("--cap", "2");
  expect(result.stdout).toContain("ready after 2 passes");
  expect(board().tickets.get("r/02")).toBeUndefined();
});

test("a small gap that a person must settle fails the last pass", async () => {
  const grade = gradeOf(
    line("criterion-1", 4),
    line("card-top", 2, "which price?", { builds: true, person: true }),
    line("scope", 5),
  );
  project.install(withJudges([[edit("ok.txt", "done")]], { grades: [grade] }));
  await seed();
  const result = await build("--cap", "1");
  expect(result.stdout).toContain("ready after 1 pass");
});
