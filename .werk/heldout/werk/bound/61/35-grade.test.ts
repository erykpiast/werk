import { afterEach, beforeEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { readPipeline } from "../src/pipeline/log-store.ts";
import { CLI } from "./cli.ts";
import { ALL_GOOD, AREA_ROLES, edit, findingsOf, gradeOf, kit, line, withJudges } from "./build-kit.ts";

let k: ReturnType<typeof kit>;
beforeEach(() => {
  k = kit();
});
afterEach(() => k.project.dispose());

const TWO = ["The pasted image is stored", "An empty list is not sent"];
const cardsAB = [
  { id: "msg-images", title: "A message carries its images" },
  { id: "composer-menu", title: "The composer shows a menu" },
];

test("35.1 a failed grade on one criterion sends its gap to the next builder pass", async () => {
  k.project.install(
    withJudges([[edit("ok.txt", "done")], [edit("note.txt", "more"), { pause: 20_000 }]], {
      grades: [gradeOf(line("criterion-1", 4), line("criterion-2", 2, "an empty list is still sent"), line("card-top", 4), line("scope", 5))],
    }),
  );
  await k.seed({ criteria: TWO });
  const child = k.project.start(["bun", CLI, "build", "r/01", "--poll-ms", "100"]);
  const until = Date.now() + 25_000;
  while (k.messages().length < 2 && Date.now() < until) await Bun.sleep(100);
  expect(k.messages().length).toBe(2);
  expect(k.pass(0)?.gate).toBe("grader");
  expect(k.pass(0)?.result).toBe("red");
  expect(k.messages()[1]?.text).toContain("an empty list is still sent");
  expect(k.ticket()?.column).toBe("building");
  expect(k.ticket()?.column).not.toBe("merging");
  child.kill();
  await child.exited;
});

test("35.2 a later grade does not fail a line that passed before", async () => {
  k.project.install(
    withJudges([[edit("ok.txt", "done")], [edit("note.txt", "more")]], {
      grades: [
        gradeOf(line("criterion-1", 4), line("card-msg-images", 2, "the first card has a named gap"), line("card-composer-menu", 4), line("scope", 5)),
        gradeOf(line("criterion-1", 4), line("card-msg-images", 4), line("card-composer-menu", 2, "a new small detail that already existed"), line("scope", 5)),
      ],
    }),
  );
  await k.seed({ cards: cardsAB });
  const r = await k.build();
  expect(r.stdout).toContain("merging after 2 passes");
  expect(k.launched("reviewer-design")).toHaveLength(1);
  expect(k.pass(1)?.result).toBe("green");
});

test("35.3 one HIGH security finding alone fails a passing grade", async () => {
  k.project.install(
    withJudges([[edit("ok.txt", "done")], [edit("note.txt", "more")]], {
      reviews: {
        "reviewer-security": [findingsOf({ severity: "HIGH", file: "ok.txt", line: 3, impact: "the secret is in plain text", fix: "read it from the env" }), findingsOf()],
      },
    }),
  );
  await k.seed();
  await k.build();
  expect(k.pass(0)?.gate).toBe("reviewer");
  expect(k.pass(0)?.reason).toContain("security");
  expect(k.pass(0)?.reason).toContain("HIGH");
  for (const role of AREA_ROLES) expect(k.launched(role).length).toBeGreaterThanOrEqual(1);
  expect(k.messages()[1]?.text).toContain("the secret is in plain text");
});

test("35.4 MEDIUM and unknown findings are recorded and do not block", async () => {
  k.project.install(
    withJudges([[edit("ok.txt", "done")]], {
      reviews: {
        "reviewer-design": [findingsOf({ severity: "MEDIUM", file: "a.ts", line: 1, impact: "i", fix: "f" }, { severity: "odd", file: "b.ts", line: 2, impact: "i", fix: "f" })],
      },
    }),
  );
  await k.seed();
  const r = await k.build();
  expect(r.stdout).toContain("merging after 1 pass");
  expect(k.ticket()?.column).toBe("merging");
  const ended = readFileSync(k.pipelinePath, "utf8").split("\n").filter((l) => l.includes('"step":"pass"') && l.includes('"step.ended"'));
  const file = JSON.parse(ended[0] as string).findings as string;
  const rec = JSON.parse(readFileSync(join(dirname(k.pipelinePath), file), "utf8"));
  expect(rec.map((f: { severity: string }) => f.severity)).toEqual(["MEDIUM", "odd"]);
});

test("35.5 the grader starts with read-only tools only", async () => {
  k.project.install(withJudges([[edit("ok.txt", "done")]]));
  await k.seed();
  const r = await k.build();
  const [grader] = k.launched("grader");
  const args = grader?.args ?? [];
  const tools = args[args.indexOf("--tools") + 1] ?? "";
  const allowed = args[args.indexOf("--allowedTools") + 1] ?? "";
  for (const t of ["Read", "Grep", "Glob"]) expect(tools.split(",")).toContain(t);
  for (const g of ["git diff", "git log", "git show"]) expect(allowed).toContain(g);
  for (const w of ["Edit", "Write", "MultiEdit", "NotebookEdit"]) expect(args.join(" ")).not.toContain(w);
  expect(r.stdout).toContain("merging after 1 pass");
});

test("35.6 the last counted pass with only a small gap merges and files a follow-up", async () => {
  const gap = "an empty list is still sent";
  await k.seed({ cards: [{ id: "msg-images", title: "A message carries its images" }] });
  k.project.install(
    withJudges([[edit("note.txt", "1")], [edit("note.txt", "2")], [edit("note.txt", "3")], [edit("note.txt", "4")], [edit("ok.txt", "done")]], {
      grades: [
        ...[0, 1, 2, 3].map(() => gradeOf(line("criterion-1", 4), line("card-msg-images", 1, "the card is not built yet", { builds: true }), line("scope", 5))),
        gradeOf(line("criterion-1", 4), line("card-msg-images", 2, gap, { builds: true }), line("scope", 5)),
      ],
    }),
  );
  // Passes 1 to 4 must reach the grade step, so the checks pass from the start.
  await Bun.write(join(k.project.dir, "ok.txt"), "x");
  await k.project.run(["git", "add", "-A"]);
  await k.project.run(["git", "commit", "-q", "-m", "ok exists"]);
  const r = await k.build("--cap", "5");
  expect(r.stdout).toContain("merging after 5 passes");
  expect(k.ticket()?.column).toBe("merging");
  const follow = k.board().tickets.get("r/02");
  expect(follow?.blockedBy).toEqual(["r/01"]);
  const text = readFileSync(join(k.project.dir, ".werk", "tickets", "r", "02.md"), "utf8");
  expect(text).toContain("cites: msg-images");
  expect(text).toContain(gap);
  // The step says the ticket then moves on to done. Nothing in the product writes that move.
  expect(await Bun.file(k.boardPath).text()).toContain("ticket.merge");
});

test("35.7 the last counted pass with a missed criterion parks the ticket as blocked, with no follow-up", async () => {
  k.project.install(
    withJudges([[edit("note.txt", "1")], [edit("note.txt", "2")], [edit("note.txt", "3")], [edit("note.txt", "4")], [edit("note.txt", "5")]], {
      grades: [
        ...[0, 1, 2, 3].map(() => gradeOf(line("criterion-1", 2, "criterion not met yet"), line("card-top", 4), line("scope", 5))),
        gradeOf(line("criterion-1", 2, "criterion missed"), line("card-top", 2, "a small gap", { builds: true }), line("scope", 5)),
      ],
    }),
  );
  await k.seed();
  await Bun.write(join(k.project.dir, "ok.txt"), "x");
  await k.project.run(["git", "add", "-A"]);
  await k.project.run(["git", "commit", "-q", "-m", "ok exists"]);
  const r = await k.build("--cap", "5");
  expect(r.stdout).toContain("after 5 passes");
  expect(k.ticket()?.column).toBe("blocked");
  expect(k.ticket()?.reason).toContain("cap");
  expect(k.board().tickets.get("r/02")).toBeUndefined();
});
