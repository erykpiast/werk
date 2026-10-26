import { afterEach, beforeEach, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { readBoard } from "../../src/board/log-store.ts";
import type { LaunchRecord, MessageRecord } from "../../src/fake-agent/launch-log.ts";
import type { Reply, Script } from "../../src/fake-agent/script.ts";
import { decided } from "../../src/map/mark-fixtures.ts";
import { readPipeline } from "../../src/pipeline/log-store.ts";
import { createProject, type Project } from "../../src/test-env/project.ts";

setDefaultTimeout(120000);

const CLI = join(import.meta.dir, "..", "..", "src", "cli.ts");
const MAKEFILE = "check:\n\t@test -f ok.txt\n";
const ticketText = (cites: string) => `title: Paste a screenshot
cites: ${cites}
blocked_by:
stories: 1
touches: composer

## What to build

Make ok.txt exist.

## Acceptance criteria

- [ ] ok.txt exists
- [ ] note.txt exists

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
  { event: { type: "result", subtype: "success", is_error: false, result: text } },
];
const line = (id: string, score: number, gap = "", more = {}) => ({ line: id, score, gap, ...more });
const gradeOf = (...lines: unknown[]): Reply => result(JSON.stringify({ lines }));
const findingsOf = (...findings: unknown[]): Reply => result(JSON.stringify({ findings }));
const AREA_ROLES = [
  "reviewer-design",
  "reviewer-maintainability",
  "reviewer-tests",
  "reviewer-security",
  "reviewer-performance",
];
type Judging = { grades?: Reply[]; reviews?: Record<string, Reply[]> };
const CARDS = ["images", "menu"];
const GOOD = gradeOf(
  line("criterion-1", 4), line("criterion-2", 4),
  line("card-images", 4), line("card-menu", 4), line("scope", 5),
);
const withJudges = (builds: Reply[], judging: Judging = {}): Script => ({
  roles: {
    builder: { replies: builds },
    grader: { replies: judging.grades ?? Array(6).fill(GOOD) },
    ...Object.fromEntries(
      AREA_ROLES.map((role) => [role, { replies: judging.reviews?.[role] ?? Array(6).fill(findingsOf()) }]),
    ),
  },
});
const launches = () => project.launches().filter((r): r is LaunchRecord => r.kind === "launch");
const launched = (role: string) => launches().filter((l) => l.role === role);
const messages = () =>
  project.launches().filter((r): r is MessageRecord => r.kind === "message" && r.role === "builder");

async function seed(cites = CARDS.join(", ")) {
  writeFileSync(join(project.dir, "Makefile"), MAKEFILE);
  await project.run(["git", "add", "-A"]);
  await project.run(["git", "commit", "-q", "-m", "Add the Makefile"]);
  writeLines(project.logPath, [
    ...decided("images", { title: "A message carries its images", why: "Because." }),
    ...decided("menu", { title: "The composer shows a menu", why: "Because." }),
  ]);
  writeLines(boardPath(), [{ type: "ticket.planned", id: "r/01", title: "Paste a screenshot" }]);
  const file = join(project.dir, ".werk", "tickets", "r", "01.md");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, ticketText(cites));
}
const build = (...extra: string[]) => project.run(["bun", CLI, "build", "r/01", "--poll-ms", "100", ...extra]);
const passes = () => [...readPipeline(pipelinePath()).builds.values()][0]?.passes ?? [];
const rawPipeline = () => readFileSync(pipelinePath(), "utf8");

beforeEach(() => {
  project = createProject();
});
afterEach(() => project.dispose());

test("35.1 a failed grade on one criterion sends its gap to the next builder pass", async () => {
  project.install(
    withJudges([[edit("ok.txt", "1")], [{ pause: 4000 }, edit("note.txt", "2")]], {
      grades: [
        gradeOf(
          line("criterion-1", 4), line("criterion-2", 2, "an empty list is still sent"),
          line("card-images", 4), line("card-menu", 4), line("scope", 5),
        ),
        GOOD,
      ],
    }),
  );
  await seed();
  const child = project.start(["bun", CLI, "build", "r/01", "--poll-ms", "100"]);
  const end = Date.now() + 60000;
  while (messages().length < 2 && Date.now() < end) await Bun.sleep(50);
  expect(messages()).toHaveLength(2);
  // The second pass is running: the board shows building, the first pass shows red at the grade.
  expect(ticket()?.column).toBe("building");
  expect(ticket()?.passes.map((p) => p.result)).toEqual(["red"]);
  expect(passes()[0]?.gate).toBe("grader");
  expect(messages()[1]?.text).toContain("an empty list is still sent");
  expect((await child.exited) === 0).toBe(true);
});

test("35.2 a later grade does not fail a line that passed before", async () => {
  project.install(
    withJudges([[edit("ok.txt", "1")], [edit("note.txt", "2")]], {
      grades: [
        gradeOf(
          line("criterion-1", 4), line("criterion-2", 4),
          line("card-images", 2, "an empty list is still sent"),
          line("card-menu", 4), line("scope", 5),
        ),
        gradeOf(
          line("criterion-1", 4), line("criterion-2", 4),
          line("card-images", 4),
          line("card-menu", 2, "a small detail that existed already"),
          line("scope", 5),
        ),
      ],
    }),
  );
  await seed();
  const r = await build();
  expect(r.stdout).toContain("merging after 2 passes");
  expect(passes().map((p) => p.result)).toEqual(["red", "green"]);
  // The second pass went on to the review.
  expect(launched("reviewer-design")).toHaveLength(1);
});

test("35.3 one HIGH security finding alone fails a passing grade", async () => {
  project.install(
    withJudges([[edit("ok.txt", "1")], [edit("note.txt", "2")]], {
      reviews: {
        "reviewer-security": [
          findingsOf({ severity: "HIGH", file: "ok.txt", line: 3, impact: "the secret is written in plain text", fix: "read it from the environment" }),
          findingsOf(),
        ],
      },
    }),
  );
  await seed();
  const r = await build();
  // All five reviewers read the first diff.
  expect(launches().filter((l) => l.role.startsWith("reviewer-")).slice(0, 5).map((l) => l.role).sort()).toEqual([...AREA_ROLES].sort());
  const first = passes()[0];
  expect(first?.gate).toBe("reviewer");
  expect(first?.result).toBe("red");
  expect(first?.reason).toContain("security HIGH at ok.txt:3");
  const second = messages()[1]?.text ?? "";
  expect(second).toContain("the secret is written in plain text");
  expect(second).toContain("read it from the environment");
  expect(r.stdout).toContain("merging after 2 passes");
});

test("35.4 MEDIUM and unknown findings are recorded and do not block", async () => {
  project.install(
    withJudges([[edit("ok.txt", "1")]], {
      reviews: {
        "reviewer-design": [findingsOf({ severity: "MEDIUM", file: "a.ts", line: 1, impact: "i", fix: "f" })],
        "reviewer-tests": [findingsOf({ severity: "mystery", file: "b.ts", line: 2, impact: "i", fix: "f" })],
      },
    }),
  );
  await seed();
  const r = await build();
  expect(r.stdout).toContain("merging after 1 pass");
  expect(ticket()?.column).toBe("merging");
  const ended = rawPipeline().split("\n").filter((l) => l.includes('"step":"pass"') && l.includes('"step.ended"'));
  const file = JSON.parse(ended[0] as string).findings as string;
  const recorded = JSON.parse(readFileSync(join(dirname(pipelinePath()), file), "utf8"));
  expect(recorded.map((f: { severity: string }) => f.severity).sort()).toEqual(["MEDIUM", "mystery"]);
});

test("35.5 the grader starts with read-only tools only", async () => {
  project.install(withJudges([[edit("ok.txt", "1")]]));
  await seed();
  const r = await build();
  expect(r.code).toBe(0);
  const [grader] = launched("grader");
  const args = grader?.args ?? [];
  const allowed = args[args.indexOf("--allowedTools") + 1]?.split(",") ?? [];
  expect(allowed).toEqual(["Read", "Grep", "Glob", "Bash(git diff:*)", "Bash(git log:*)", "Bash(git show:*)"]);
  for (const w of ["Edit", "Write", "MultiEdit", "NotebookEdit"]) expect(args.join(" ")).not.toContain(w);
  // The scores came back: the pass went on to the review and the ticket merged.
  expect(launched("reviewer-design")).toHaveLength(1);
});

const small = (gap: string) =>
  gradeOf(
    line("criterion-1", 4), line("criterion-2", 4),
    line("card-images", 2, gap, { builds: true }),
    line("card-menu", 4), line("scope", 5),
  );
const failing = (n: number) =>
  Array.from({ length: n }, (_, i) =>
    gradeOf(
      line("criterion-1", 2, `gap of pass ${i + 1}`), line("criterion-2", 4),
      line("card-images", 4), line("card-menu", 4), line("scope", 5),
    ),
  );
// Passes 1 to 4 of 35.6 fail the grade on the card line, so the line is still failing at pass 5.
const failingOnCard = (n: number) =>
  Array.from({ length: n }, (_, i) => small(`gap of pass ${i + 1}`));
const five = (): Reply[] => [1, 2, 3, 4, 5].map((i) => [edit(`f${i}.txt`, String(i))]);
// ok.txt must exist for the check, so pass 1 writes it and the others add files.
const fiveBuilds = (): Reply[] => [[edit("ok.txt", "1")], ...five().slice(1)];

test("35.6 the last counted pass with only a small gap merges and files a follow-up", async () => {
  project.install(
    withJudges(fiveBuilds(), {
      grades: [...failingOnCard(4), small("an empty list is still sent")],
    }),
  );
  await seed("images");
  const r = await build("--cap", "5");
  expect(r.stdout).toContain("merging after 5 passes");
  expect(passes().slice(0, 4).every((p) => p.gate === "grader" && p.result === "red")).toBe(true);
  expect(ticket()?.followups).toEqual(["r/02"]);
  const f = board().tickets.get("r/02");
  expect(f?.blockedBy).toEqual(["r/01"]);
  const file = readFileSync(join(project.dir, ".werk", "tickets", "r", "02.md"), "utf8");
  expect(file).toContain("cites: images");
  expect(file).toContain("an empty list is still sent");
});

test("35.6 (done) the ticket then moves to done", async () => {
  project.install(withJudges(fiveBuilds(), { grades: [...failingOnCard(4), small("an empty list is still sent")] }));
  await seed("images");
  await build("--cap", "5");
  // Nothing in the build verb moves a merging ticket to done; that is the merge loop's job.
  expect(ticket()?.column).toBe("done");
});

test("35.7 the last counted pass with a missed criterion parks the ticket", async () => {
  project.install(
    withJudges(fiveBuilds(), {
      grades: [
        ...failing(4),
        gradeOf(
          line("criterion-1", 2, "ok.txt is wrong"), line("criterion-2", 4),
          line("card-images", 2, "an empty list is still sent", { builds: true }),
          line("card-menu", 4), line("scope", 5),
        ),
      ],
    }),
  );
  await seed("images");
  // A ticket that needs r/01 waits behind it.
  writeFileSync(boardPath(), `${readFileSync(boardPath(), "utf8")}${JSON.stringify({ type: "ticket.planned", id: "r/02", title: "Needs the first", blocked_by: ["r/01"] })}\n`);
  const r = await build("--cap", "5");
  expect(r.code).toBe(1);
  expect(ticket()?.column).toBe("blocked");
  expect(ticket()?.reason).toContain("retry cap of 5");
  expect([...board().tickets.keys()].filter((id) => id !== "r/01" && id !== "r/02")).toEqual([]);
  expect(board().tickets.get("r/02")?.column).toBe("blocked");
});
