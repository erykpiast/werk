import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { readBoard } from "../../src/board/log-store.ts";
import type { LaunchRecord, MessageRecord } from "../../src/fake-agent/launch-log.ts";
import {
  AREA_ROLES, findingsOf, gradeOf, line, withJudges,
} from "../../src/build/judge-fixtures.ts";
import { decided } from "../../src/map/mark-fixtures.ts";
import { readPipeline } from "../../src/pipeline/log-store.ts";
import { CLI, createProject, type Project } from "./h.ts";

const GOOD = gradeOf(line("criterion-1", 4), line("card-images", 4), line("scope", 5));
const GOODS = Array(5).fill(GOOD);
const MAKEFILE = "check:\n\t@test -f ok.txt\n";
let project: Project;
beforeEach(() => {
  project = createProject();
});
afterEach(() => project.dispose());

const boardPath = () => join(project.dir, ".werk", "board.jsonl");
const pipelinePath = () => join(project.dir, ".werk", "pipeline.jsonl");
const board = () => readBoard(boardPath());
const ticket = (id = "r/01") => board().tickets.get(id);
const edit = (path: string, content: string) => ({ edit: path, content });
const lines = (path: string, events: unknown[]) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, events.map((e) => `${JSON.stringify(e)}\n`).join(""));
};
const messages = () =>
  project.launches().filter((r): r is MessageRecord => r.kind === "message" && r.role === "builder");
const launched = (role: string) =>
  project.launches().filter((r): r is LaunchRecord => r.kind === "launch" && r.role === role);
const passes = () => [...readPipeline(pipelinePath()).builds.values()][0]?.passes ?? [];

async function seed(cards: { id: string; title: string }[], criteria = ["ok.txt exists"], title = "Paste a screenshot") {
  writeFileSync(join(project.dir, "Makefile"), MAKEFILE);
  await project.run(["git", "add", "-A"]);
  await project.run(["git", "commit", "-q", "-m", "Add the Makefile"]);
  lines(project.logPath, cards.flatMap((c) => decided(c.id, { title: c.title, why: "Because." })));
  lines(boardPath(), [{ type: "ticket.planned", id: "r/01", title }]);
  const text = `title: ${title}\ncites: ${cards.map((c) => c.id).join(", ")}\nblocked_by:\nstories: 1\ntouches: checks\n\n## What to build\n\nMake ok.txt exist.\n\n## Acceptance criteria\n\n${criteria.map((c) => `- [ ] ${c}`).join("\n")}\n\n## Checks\n\n- \`make check\`\n`;
  const file = join(project.dir, ".werk", "tickets", "r", "01.md");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}
const build = (...extra: string[]) =>
  project.run(["bun", CLI, "build", "r/01", "--poll-ms", "100", ...extra]);
const ONE = [{ id: "images", title: "A message carries its images" }];
const TWO = [...ONE, { id: "menu", title: "The composer shows a menu" }];

test("35.1 a failed criterion grade sends its gap to the next pass; ticket stays building", async () => {
  project.install(
    withJudges([[edit("ok.txt", "done")], [edit("note.txt", "m"), { pause: 6000 }]], {
      grades: [
        gradeOf(line("criterion-1", 2, "an empty list is still sent"), line("criterion-2", 4), line("card-images", 4), line("scope", 5)),
        gradeOf(line("criterion-1", 4), line("criterion-2", 4), line("card-images", 4), line("scope", 5)),
      ],
    }),
  );
  await seed(ONE, ["a screenshot pastes", "the list is sent"]);
  const child = project.start(["bun", CLI, "build", "r/01", "--poll-ms", "100"]);
  const end = Date.now() + 30000;
  while (messages().length < 2 && Date.now() < end) await Bun.sleep(50);
  expect(messages()).toHaveLength(2);
  expect(passes()[0]?.result).toBe("red");
  expect(passes()[0]?.gate).toBe("grader");
  expect(messages()[1]?.text).toContain("an empty list is still sent");
  expect(ticket()?.column).toBe("building");
  child.kill();
  await child.exited;
});

test("35.2 a later grade does not fail a line that passed before", async () => {
  project.install(
    withJudges([[edit("ok.txt", "d")], [edit("n.txt", "m")]], {
      grades: [
        gradeOf(line("criterion-1", 4), line("card-images", 2, "images gap"), line("card-menu", 4), line("scope", 5)),
        gradeOf(line("criterion-1", 4), line("card-images", 4), line("card-menu", 2, "a new small detail"), line("scope", 5)),
      ],
    }),
  );
  await seed(TWO);
  const r = await build();
  expect(r.stdout).toContain("merging after 2 passes");
  expect(launched("reviewer-design")).toHaveLength(1);
});

const SEC = (extra: unknown[] = []) => findingsOf(...extra);
test("35.3 one HIGH security finding alone fails a passing grade", async () => {
  project.install(
    withJudges([[edit("ok.txt", "d")], [edit("n.txt", "m")]], {
      grades: GOODS,
      reviews: {
        "reviewer-security": [
          SEC([{ severity: "HIGH", file: "ok.txt", line: 3, impact: "secret in plain text", fix: "use env" }]),
          SEC(),
        ],
      },
    }),
  );
  await seed(ONE);
  const r = await build();
  expect(passes()[0]?.gate).toBe("reviewer");
  expect(passes()[0]?.reason).toContain("security HIGH at ok.txt:3");
  expect(messages()[1]?.text).toContain("secret in plain text");
  expect(r.stdout).toContain("merging after 2 passes");
  // The five reviewers run together: all five launched in pass 1.
  for (const role of AREA_ROLES) expect(launched(role).length).toBeGreaterThanOrEqual(1);
});

test("35.4 MEDIUM and unknown findings are recorded and do not block", async () => {
  project.install(
    withJudges([[edit("ok.txt", "d")]], {
      grades: GOODS,
      reviews: {
        "reviewer-design": [
          findingsOf(
            { severity: "MEDIUM", file: "a.ts", line: 1, impact: "i", fix: "f" },
            { severity: "weird", file: "b.ts", line: 2, impact: "i", fix: "f" },
          ),
        ],
      },
    }),
  );
  await seed(ONE);
  const r = await build();
  expect(r.stdout).toContain("merging after 1 pass");
  expect(ticket()?.column).toBe("merging");
  const ended = readFileSync(pipelinePath(), "utf8").split("\n").filter((l) => l.includes('"step":"pass"') && l.includes('"step.ended"'));
  const file = JSON.parse(ended[0] as string).findings as string;
  const rec = JSON.parse(readFileSync(join(dirname(pipelinePath()), file), "utf8"));
  expect(rec.map((f: { severity: string }) => f.severity)).toEqual(["MEDIUM", "weird"]);
});

test("35.5 grader starts with read-only tools only", async () => {
  project.install(withJudges([[edit("ok.txt", "d")]], { grades: GOODS }));
  await seed(ONE);
  await build();
  const [g] = launched("grader");
  const args = g?.args ?? [];
  const allowed = args[args.indexOf("--allowedTools") + 1]?.split(",") ?? [];
  expect(allowed).toEqual(["Read", "Grep", "Glob", "Bash(git diff:*)", "Bash(git log:*)", "Bash(git show:*)"]);
  expect(args.join(" ")).not.toMatch(/Edit|Write|MultiEdit/);
  expect(ticket()?.column).toBe("merging");
});

const small = (gap: string, also: unknown[] = []) =>
  gradeOf(line("criterion-1", 4), ...also, line("card-images", 2, gap, { builds: true }), line("scope", 5));
const failBefore = (i: number) =>
  gradeOf(line("criterion-1", 4), line("card-images", 2, `gap ${i}`, { builds: true, person: true }), line("scope", 5));

test("35.6 last counted pass with only a small gap merges and files a follow-up", async () => {
  project.install(
    withJudges(
      [[edit("ok.txt", "d")], [edit("a.txt", "1")], [edit("b.txt", "2")], [edit("c.txt", "3")], [edit("d.txt", "4")]],
      { grades: [failBefore(1), failBefore(2), failBefore(3), failBefore(4), small("an empty list is still sent")] },
    ),
  );
  await seed(ONE);
  const r = await build("--cap", "5");
  console.log("35.6", r.stdout, r.stderr);
  expect(r.stdout).toContain("merging after 5 passes");
  expect(ticket()?.column).toBe("merging");
  const f = board().tickets.get("r/02");
  expect(f).toBeDefined();
  expect(f?.blockedBy).toEqual(["r/01"]);
  const file = readFileSync(join(project.dir, ".werk", "tickets", "r", "02.md"), "utf8");
  expect(file).toContain("cites: images");
  expect(file).toContain("an empty list is still sent");
});

test("35.7 last pass with a missed criterion parks the ticket as blocked with a reason", async () => {
  const bad = (i: number) =>
    gradeOf(line("criterion-1", 2, `crit gap ${i}`), line("card-images", 2, "small gap", { builds: true }), line("scope", 5));
  project.install(
    withJudges(
      [[edit("ok.txt", "d")], [edit("a.txt", "1")], [edit("b.txt", "2")], [edit("c.txt", "3")], [edit("d.txt", "4")]],
      { grades: [bad(1), bad(2), bad(3), bad(4), bad(5)] },
    ),
  );
  await seed(ONE);
  const r = await build("--cap", "5");
  console.log("35.7", r.stdout, JSON.stringify(ticket()?.column), ticket()?.reason);
  expect(r.code).toBe(1);
  expect(board().tickets.get("r/02")).toBeUndefined();
  expect(ticket()?.reason).toContain("retry cap");
  expect(ticket()?.column).toBe("blocked");
});
