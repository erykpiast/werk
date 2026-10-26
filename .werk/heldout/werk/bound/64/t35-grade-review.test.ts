import { afterEach, beforeEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ALL_GOOD, AREA_ROLES, findingsOf, gradeOf, line, withJudges } from "../src/build/judge-fixtures.ts";
import { createProject, type Project } from "./h.ts";
import { ctx, edit, ticketText } from "./hb.ts";

let p: Project;
let c: ReturnType<typeof ctx>;
beforeEach(() => {
  p = createProject();
  c = ctx(p);
});
afterEach(() => p.dispose());

const TWO = ["the list is sent", "an empty list is handled"];

test("35.1 a failed grade on one criterion sends its gap to the next builder pass", async () => {
  p.install(
    withJudges([[edit("ok.txt", "done")], [edit("a.txt", "x"), { pause: 30_000 }]], {
      grades: [
        gradeOf(line("criterion-1", 4), line("criterion-2", 2, "an empty list is still sent"), line("card-top", 4), line("scope", 5)),
        ALL_GOOD,
      ],
    }),
  );
  await c.seed({ ticket: ticketText(["top"], TWO) });
  const child = p.start(c.buildArgs());
  const until = Date.now() + 40_000;
  while (c.messages().length < 2 && Date.now() < until) await Bun.sleep(100);
  expect(c.messages().length).toBe(2);
  expect(c.messages()[1]?.text).toContain("an empty list is still sent");
  const pass = c.pipeline()?.passes[0];
  expect(pass?.result).toBe("red");
  expect(pass?.gate).toBe("grader");
  expect(c.ticket()?.column).toBe("building");
  child.kill("SIGKILL");
});

test("35.2 a later grade does not fail a line that passed before", async () => {
  p.install(
    withJudges([[edit("ok.txt", "done")], [edit("n.txt", "more")]], {
      grades: [
        gradeOf(line("criterion-1", 4), line("card-a", 2, "first gap"), line("card-b", 4), line("scope", 5)),
        gradeOf(line("criterion-1", 4), line("card-a", 4), line("card-b", 2, "a small detail that already existed"), line("scope", 5)),
      ],
    }),
  );
  await c.seed({
    cards: [
      { id: "a", title: "A message carries its images" },
      { id: "b", title: "The composer shows a menu" },
    ],
  });
  const r = await c.build();
  expect(r.stdout).toContain("merging after 2 passes");
  expect(c.launched("reviewer-design").length).toBe(1);
});

test("35.3 one HIGH security finding alone fails a passing grade", async () => {
  p.install(
    withJudges([[edit("ok.txt", "done")], [edit("n.txt", "more")]], {
      reviews: {
        "reviewer-security": [
          findingsOf({ severity: "HIGH", file: "ok.txt", line: 3, impact: "the secret is in plain text", fix: "read it from the environment" }),
          findingsOf(),
        ],
      },
    }),
  );
  await c.seed();
  const r = await c.build();
  const pass = c.pipeline()?.passes[0];
  expect(pass?.gate).toBe("reviewer");
  expect(pass?.reason).toContain("security HIGH at ok.txt:3");
  expect(c.messages()[1]?.text).toContain("the secret is in plain text");
  // all five reviewers read the first pass
  const first = new Set(c.launches().slice(0, 7).map((l) => l.role));
  for (const role of AREA_ROLES) expect(first.has(role)).toBe(true);
  expect(r.stdout).toContain("merging after 2 passes");
});

test("35.4 MEDIUM and unknown findings are recorded and do not block", async () => {
  p.install(
    withJudges([[edit("ok.txt", "done")]], {
      reviews: {
        "reviewer-design": [
          findingsOf(
            { severity: "MEDIUM", file: "a.ts", line: 1, impact: "i", fix: "f" },
            { severity: "mystery", file: "b.ts", line: 2, impact: "i", fix: "f" },
          ),
        ],
      },
    }),
  );
  await c.seed();
  const r = await c.build();
  expect(r.stdout).toContain("merging after 1 pass");
  expect(c.ticket()?.column).toBe("merging");
  const text = readFileSync(c.pipelinePath, "utf8");
  const ended = text.split("\n").filter((l) => l.includes('"step":"pass"') && l.includes('"step.ended"'));
  const file = JSON.parse(ended[0] as string).findings as string;
  const rec = JSON.parse(readFileSync(join(dirname(c.pipelinePath), file), "utf8"));
  expect(rec.map((f: { severity: string }) => f.severity)).toEqual(["MEDIUM", "mystery"]);
});

test("35.5 the grader starts with read-only tools only", async () => {
  p.install(withJudges([[edit("ok.txt", "done")]]));
  await c.seed();
  const r = await c.build();
  const args = c.launched("grader")[0]?.args ?? [];
  const tools = args[args.indexOf("--tools") + 1] ?? "";
  const allowed = (args[args.indexOf("--allowedTools") + 1] ?? "").split(",");
  for (const t of ["Read", "Grep", "Glob"]) expect(tools.split(",")).toContain(t);
  for (const t of ["Bash(git diff:*)", "Bash(git log:*)", "Bash(git show:*)"]) expect(allowed).toContain(t);
  for (const w of ["Edit", "Write", "MultiEdit", "NotebookEdit"]) expect(args.join(" ")).not.toContain(w);
  expect(r.stdout).toContain("merging after 1 pass");
});

test("35.6 the last counted pass with only a small gap merges and files a follow-up", async () => {
  const fail = gradeOf(line("criterion-1", 2, "not yet"), line("card-images", 2, "earlier gap", { builds: true }), line("scope", 5));
  const small = gradeOf(line("criterion-1", 4), line("card-images", 2, "an empty list is still sent", { builds: true }), line("scope", 5));
  p.install(
    withJudges(
      [1, 2, 3, 4, 5].map((n) => [edit(`f${n}.txt`, String(n)), edit("ok.txt", String(n))]),
      { grades: [fail, fail, fail, fail, small] },
    ),
  );
  await c.seed({ cards: [{ id: "images", title: "A message carries its images" }] });
  const r = await c.build("--cap", "5");
  expect(r.stdout).toContain("merging after 5 passes");
  expect(c.ticket()?.column).toBe("merging");
  const f = c.board().tickets.get("r/02");
  expect(f).toBeDefined();
  expect(f?.blockedBy).toEqual(["r/01"]);
  const file = readFileSync(join(p.dir, ".werk", "tickets", "r", "02.md"), "utf8");
  expect(file).toContain("cites: images");
  expect(file).toContain("an empty list is still sent");
});

test("35.7 the last counted pass with a missed criterion parks the ticket", async () => {
  const fail = gradeOf(line("criterion-1", 2, "not yet"), line("card-images", 2, "earlier gap", { builds: true }), line("scope", 5));
  const last = gradeOf(line("criterion-1", 2, "ok.txt is wrong"), line("card-images", 2, "a small gap", { builds: true }), line("scope", 5));
  p.install(
    withJudges(
      [1, 2, 3, 4, 5].map((n) => [edit(`f${n}.txt`, String(n)), edit("ok.txt", String(n))]),
      { grades: [fail, fail, fail, fail, last] },
    ),
  );
  await c.seed({
    cards: [{ id: "images", title: "A message carries its images" }],
    extraBoard: [{ type: "ticket.planned", id: "r/02", title: "Needs r/01", blocked_by: ["r/01"], reason: "waits for r/01" }],
  });
  const r = await c.build("--cap", "5");
  expect(r.code).toBe(1);
  const t = c.ticket();
  expect(t?.column).toBe("blocked");
  expect(t?.reason).toMatch(/cap/);
  expect(c.board().tickets.get("r/03")).toBeUndefined();
  expect(c.ticket("r/02")?.column).toBe("blocked");
});
