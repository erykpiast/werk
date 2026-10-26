import { afterEach, beforeEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  AREA_ROLES,
  edit,
  findingsOf,
  grade,
  line,
  makeEnv,
  withJudgesT as withJudges,
  type Env,
} from "./35-37-support.ts";

let t: Env;
beforeEach(() => {
  t = makeEnv();
});
afterEach(() => t.dispose());

const ever = (column: string) =>
  readFileSync(t.boardPath(), "utf8")
    .split("\n")
    .filter((l) => l.includes('"ticket.moved"') && l.includes(`"to":"${column}"`));

test("35.1 a failed grade on one criterion sends its gap to pass 2, and the ticket stays building", async () => {
  t.project.install(
    withJudges([[edit("ok.txt", "x")], [edit("note.txt", "y"), { pause: 30_000 }]], {
      grades: [
        grade({ "criterion-1": line("criterion-1", 2, "an empty list is still sent") }),
      ],
    }),
  );
  await t.seed();
  const child = t.project.start(["bun", join(import.meta.dir, "../../src/cli.ts"), "build", "r/01", "--poll-ms", "100"]);
  const until = Date.now() + 25_000;
  while (t.messages().length < 2 && Date.now() < until) await Bun.sleep(100);
  expect(t.messages()).toHaveLength(2);
  expect(t.messages()[1]?.text).toContain("an empty list is still sent");
  const first = t.pipelinePasses().passes[0];
  expect(first?.result).toBe("red");
  expect(first?.gate).toBe("grader");
  expect(ever("merging")).toHaveLength(0);
  expect(t.ticket()?.column).toBe("building");
  child.kill("SIGKILL");
});

test("35.2 a later grade does not fail a line that passed before", async () => {
  t.project.install(
    withJudges([[edit("ok.txt", "x")], [edit("note.txt", "y")]], {
      grades: [
        grade({
          "card-images": line("card-images", 2, "the images are lost"),
        }),
        grade({
          "card-menu": line("card-menu", 2, "a small detail that existed at the first grade"),
        }),
      ],
    }),
  );
  await t.seed();
  const r = await t.build();
  expect(r.stdout).toContain("merging after 2 passes");
  // Pass 2 went on to the review: the five reviewers ran once, in pass 2 only.
  expect(t.launches("reviewer-design")).toHaveLength(1);
  expect(t.launches("grader")).toHaveLength(2);
});

test("35.3 one HIGH security finding alone fails a passing grade", async () => {
  t.project.install(
    withJudges([[edit("ok.txt", "x")], [edit("note.txt", "y")]], {
      reviews: {
        "reviewer-security": [
          findingsOf({
            severity: "HIGH",
            file: "ok.txt",
            line: 3,
            impact: "the token is logged",
            fix: "drop the log line",
          }),
          findingsOf(),
        ],
      },
    }),
  );
  await t.seed();
  const r = await t.build();
  expect(r.stdout).toContain("merging after 2 passes");
  for (const role of AREA_ROLES) expect(t.launches(role).length).toBeGreaterThanOrEqual(1);
  const first = t.pipelinePasses().passes[0];
  expect(first?.result).toBe("red");
  expect(first?.gate).toBe("reviewer");
  expect(first?.reason).toContain("security HIGH at ok.txt:3");
  const second = t.messages()[1]?.text ?? "";
  expect(second).toContain("the token is logged");
  expect(second).toContain("drop the log line");
});

test("35.4 MEDIUM and unknown findings are recorded and do not block", async () => {
  t.project.install(
    withJudges([[edit("ok.txt", "x")]], {
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
  await t.seed();
  const r = await t.build();
  expect(r.stdout).toContain("merging after 1 pass");
  expect(t.ticket()?.column).toBe("merging");
  const ended = readFileSync(t.pipelinePath(), "utf8")
    .split("\n")
    .filter((l) => l.includes('"step":"pass"') && l.includes('"step.ended"'));
  const file = JSON.parse(ended[0] as string).findings as string;
  const recorded = JSON.parse(readFileSync(join(dirname(t.pipelinePath()), file), "utf8"));
  expect(recorded.map((f: { severity: string }) => f.severity)).toEqual(["MEDIUM", "weird"]);
});

test("35.5 the grader starts with read-only tools only", async () => {
  t.project.install(withJudges([[edit("ok.txt", "x")]]));
  await t.seed();
  const r = await t.build();
  expect(r.stdout).toContain("merging");
  const [g] = t.launches("grader");
  const args = g?.args ?? [];
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
  for (const w of ["Edit", "Write", "MultiEdit", "NotebookEdit"]) expect(args.join(" ")).not.toContain(w);
  // The grader's scores came back to the loop: the ticket merged.
  expect(t.ticket()?.column).toBe("merging");
});

const smallGap = () =>
  grade({
    "card-images": line("card-images", 2, "an empty list is still sent", { builds: true }),
  });
const hardFail = () =>
  grade({ "criterion-1": line("criterion-1", 2, "ok.txt is wrong") });

test("35.6 the last counted pass with only a small gap merges and files a follow-up", async () => {
  t.project.install(
    withJudges(Array(5).fill([edit("ok.txt", "x")]), {
      grades: [smallGap(), smallGap(), smallGap(), smallGap(), smallGap()],
    }),
  );
  await t.seed();
  const r = await t.build("--cap", "5");
  expect(r.stdout).toContain("merging after 5 passes");
  expect(t.ticket()?.column).toBe("merging");
  const f = t.board().tickets.get("r/02");
  expect(f?.column).toBe("ready");
  expect(f?.blockedBy).toEqual(["r/01"]);
  const file = readFileSync(join(t.project.dir, ".werk", "tickets", "r", "02.md"), "utf8");
  expect(file).toContain("cites: images");
  expect(file).toContain("an empty list is still sent");
  // "and then to done": nothing in a build run merges the branch and moves the ticket to done.
  expect(t.ticket()?.column).toBe("done");
});

test("35.7 the last counted pass with a missed criterion parks the ticket as blocked", async () => {
  const bad = grade({
    "criterion-1": line("criterion-1", 2, "ok.txt is wrong"),
    "card-images": line("card-images", 2, "small gap", { builds: true }),
  });
  t.project.install(withJudges(Array(5).fill([edit("ok.txt", "x")]), { grades: Array(5).fill(bad) }));
  await t.seed();
  const r = await t.build("--cap", "5");
  expect(r.stdout).toContain("after 5 passes");
  expect(t.board().tickets.get("r/02")).toBeUndefined();
  expect(t.ticket()?.reason).toContain("retry cap");
  expect(t.ticket()?.column).toBe("blocked");
});
