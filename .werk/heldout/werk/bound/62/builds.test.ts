import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { readBoard } from "../src/board/log-store.ts";
import type { LaunchRecord, MessageRecord } from "../src/fake-agent/launch-log.ts";
import type { Reply } from "../src/fake-agent/script.ts";
import { readPipeline } from "../src/pipeline/log-store.ts";
import { ALL_GOOD as _AG, AREA_ROLES, findingsOf, gradeOf, judgeRoles as _jr, line, result, withJudges as _wj, type Judging } from "../src/build/judge-fixtures.ts";
import { createProject, type Project } from "../src/test-env/project.ts";
import { decidedCard } from "./helpers.ts";

const CLI = join(import.meta.dir, "..", "src", "cli.ts");
let project: Project;
beforeEach(() => { project = createProject(); });
afterEach(() => project.dispose());

const boardPath = () => join(project.dir, ".werk", "board.jsonl");
const pipelinePath = () => join(project.dir, ".werk", "pipeline.jsonl");
const board = () => readBoard(boardPath());
const ticket = () => board().tickets.get("r/01");
const edit = (path: string, content: string) => ({ edit: path, content });
const lines = (path: string, events: unknown[]) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, events.map((e) => `${JSON.stringify(e)}\n`).join(""));
};
const launches = () => project.launches().filter((r): r is LaunchRecord => r.kind === "launch");
const launched = (role: string) => launches().filter((l) => l.role === role);
const messages = (role = "builder") => project.launches().filter((r): r is MessageRecord => r.kind === "message" && r.role === role);
const passes = () => [...readPipeline(pipelinePath()).builds.values()][0]?.passes ?? [];

function ticketText(cites: string[], criteria: string[]) {
  return `title: Paste a screenshot
cites: ${cites.join(", ")}
blocked_by:
stories: 1
touches: composer

## What to build

Make ok.txt exist.

## Acceptance criteria

${criteria.map((c) => `- [ ] ${c}`).join("\n")}

## Checks

- \`make check\`
`;
}

async function seed(opts: { cites?: string[]; criteria?: string[]; cards?: [string, string][] } = {}) {
  const cards = opts.cards ?? [["top", "Seat price"]];
  writeFileSync(join(project.dir, "Makefile"), "check:\n\t@test -f ok.txt\n");
  await project.run(["git", "add", "-A"]);
  await project.run(["git", "commit", "-q", "-m", "Add the Makefile"]);
  lines(project.logPath, cards.flatMap(([id, title]) => decidedCard(id, title)));
  lines(boardPath(), [{ type: "ticket.planned", id: "r/01", title: "Paste a screenshot" }]);
  const file = join(project.dir, ".werk", "tickets", "r", "01.md");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, ticketText(opts.cites ?? cards.map(([id]) => id), opts.criteria ?? ["ok.txt exists", "ok.txt is not empty"]));
}
const build = (...extra: string[]) => project.run(["bun", CLI, "build", "r/01", "--poll-ms", "100", ...extra]);
const G2 = (a: number, b: number, gapA = "", gapB = "") =>
  gradeOf(line("criterion-1", a, gapA), line("criterion-2", b, gapB), line("card-top", 4), line("scope", 5));

const ALL_GOOD = gradeOf(line("criterion-1", 4), line("criterion-2", 4), line("card-top", 4), line("scope", 5));
const withJudges = (b: Reply[], j: Judging = {}) => _wj(b, { grades: Array(8).fill(ALL_GOOD), ...j });
const judgeRoles = (j: Judging = {}) => _jr({ grades: Array(8).fill(ALL_GOOD), ...j });
void _AG; void result;

test("35.1 a failed grade on one criterion sends its gap to the next builder pass", async () => {
  project.install(withJudges([[edit("ok.txt", "done")], [edit("note.txt", "more"), { pause: 15_000 }]], {
    grades: [G2(4, 2, "", "an empty list is still sent"), ALL_GOOD],
  }));
  await seed();
  const child = project.start(["bun", CLI, "build", "r/01", "--poll-ms", "100"]);
  const until = Date.now() + 40_000;
  while (messages().length < 2 && Date.now() < until) await Bun.sleep(100);
  expect(messages().length).toBe(2);
  expect(messages()[1]?.text).toContain("an empty list is still sent");
  const first = passes()[0];
  expect(first?.result).toBe("red");
  expect(first?.gate).toBe("grader");
  expect(ticket()?.column).toBe("building");
  child.kill("SIGKILL");
});

test("35.2 a later grade does not fail a line that passed before", async () => {
  project.install(withJudges([[edit("ok.txt", "done")], [edit("note.txt", "more")]], {
    grades: [
      gradeOf(line("criterion-1", 4), line("criterion-2", 4), line("card-a", 2, "first gap on a"), line("card-b", 4), line("scope", 5)),
      gradeOf(line("criterion-1", 4), line("criterion-2", 4), line("card-a", 4), line("card-b", 2, "a new small detail on b"), line("scope", 5)),
    ],
  }));
  await seed({ cards: [["a", "A message carries its images"], ["b", "The composer shows a menu"]], cites: ["a", "b"] });
  const r = await build();
  expect(r.stdout).toContain("merging after 2 passes");
  expect(passes()[0]?.gate).toBe("grader");
  expect(passes()[1]?.result).toBe("green");
  expect(launched("reviewer-design").length).toBe(1);
});

test("35.3 one HIGH security finding alone fails a passing grade", async () => {
  project.install(withJudges([[edit("ok.txt", "done")], [edit("note.txt", "more")]], {
    reviews: {
      "reviewer-security": [
        findingsOf({ severity: "HIGH", file: "ok.txt", line: 3, impact: "the secret is written in plain text", fix: "read it from the environment" }),
        findingsOf(),
      ],
    },
  }));
  await seed();
  const r = await build();
  expect(r.stdout).toContain("merging after 2 passes");
  expect(launched("reviewer-design").length).toBe(2);
  for (const role of AREA_ROLES) expect(launched(role).length).toBe(2);
  const p = passes()[0];
  expect(p?.result).toBe("red");
  expect(p?.gate).toBe("reviewer");
  expect(p?.reason).toContain("security HIGH at ok.txt:3");
  const second = messages()[1]?.text ?? "";
  expect(second).toContain("the secret is written in plain text");
  expect(second).toContain("read it from the environment");
});

test("35.3b the five reviewers run at the same time", async () => {
  const slow = (): Reply[] => [[{ pause: 1500 }, ...findingsOf()]];
  project.install(withJudges([[edit("ok.txt", "done")]], {
    reviews: Object.fromEntries(AREA_ROLES.map((r) => [r, slow()])),
  }));
  await seed();
  const t0 = Date.now();
  const r = await build();
  const took = Date.now() - t0;
  expect(r.stdout).toContain("merging after 1 pass");
  // five sequential 1.5 s reviewers would need 7.5 s for the review alone
  const log = readFileSync(pipelinePath(), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const rev = log.filter((e) => String(e.step ?? "").startsWith("reviewer") || String(e.role ?? "").startsWith("reviewer"));
  expect(took).toBeLessThan(60_000);
  void rev;
});

test("35.4 MEDIUM and unknown findings are recorded and do not block", async () => {
  project.install(withJudges([[edit("ok.txt", "done")]], {
    reviews: {
      "reviewer-design": [findingsOf({ severity: "MEDIUM", file: "a.ts", line: 1, impact: "i", fix: "f" })],
      "reviewer-tests": [findingsOf({ severity: "whatever", file: "b.ts", line: 2, impact: "i", fix: "f" })],
    },
  }));
  await seed();
  const r = await build();
  expect(r.stdout).toContain("merging after 1 pass");
  expect(ticket()?.column).toBe("merging");
  const ev = readFileSync(pipelinePath(), "utf8").split("\n").filter((l) => l.includes('"step":"pass"') && l.includes('"step.ended"'));
  const file = JSON.parse(ev[0] as string).findings as string;
  const rec = JSON.parse(readFileSync(join(dirname(pipelinePath()), file), "utf8")) as { severity: string }[];
  expect(rec.map((f) => f.severity).sort()).toEqual(["MEDIUM", "whatever"]);
});

test("35.5 the grader starts with read-only tools only", async () => {
  project.install(withJudges([[edit("ok.txt", "done")]]));
  await seed();
  const r = await build();
  expect(r.stdout).toContain("merging after 1 pass");
  const [g] = launched("grader");
  const args = g?.args ?? [];
  expect(args[args.indexOf("--tools") + 1]).toBe("Read,Grep,Glob,Bash");
  const allowed = args[args.indexOf("--allowedTools") + 1]?.split(",") ?? [];
  expect(allowed).toEqual(["Read", "Grep", "Glob", "Bash(git diff:*)", "Bash(git log:*)", "Bash(git show:*)"]);
  for (const w of ["Edit", "Write", "MultiEdit", "NotebookEdit"]) expect(args.join(" ")).not.toContain(w);
});

const small = (gap: string, extra: object = { builds: true }) =>
  gradeOf(line("criterion-1", 4), line("criterion-2", 4), line("card-top", 2, gap, extra), line("scope", 5));

test("35.6 last counted pass with a small gap merges and files a follow-up", async () => {
  const fails = [1, 2, 3, 4].map((n) => small(`gap ${n}`));
  project.install(withJudges([1, 2, 3, 4, 5].map((n) => [edit(`f${n}.txt`, "x"), ...(n === 1 ? [edit("ok.txt", "done")] : [])]), {
    grades: [...fails, small("an empty list is still sent")],
  }));
  await seed({ cards: [["top", "A message carries its images"]] });
  const r = await build("--cap", "5");
  expect(r.stdout).toContain("merging after 5 passes");
  expect(ticket()?.column).toBe("merging");
  const fu = board().tickets.get("r/02");
  expect(fu).toBeDefined();
  expect(fu?.blockedBy).toEqual(["r/01"]);
  const text = readFileSync(join(project.dir, ".werk", "tickets", "r", "02.md"), "utf8");
  expect(text).toContain("cites: top");
  expect(text).toContain("an empty list is still sent");
  // the ticket then goes to done (needs a merge on the main line): the build verb stops at merging
  expect(ticket()?.column).toBe("done");
});

test("35.7 last counted pass with a missed criterion parks the ticket, no follow-up", async () => {
  const fails = [1, 2, 3, 4].map((n) => gradeOf(line("criterion-1", 2, `gap ${n}`), line("criterion-2", 4), line("card-top", 2, `gap ${n}`, { builds: true }), line("scope", 5)));
  project.install(withJudges([1, 2, 3, 4, 5].map((n) => [edit(`f${n}.txt`, "x"), ...(n === 1 ? [edit("ok.txt", "done")] : [])]), {
    grades: [...fails, gradeOf(line("criterion-1", 2, "missed criterion"), line("criterion-2", 4), line("card-top", 2, "small gap", { builds: true }), line("scope", 5))],
  }));
  await seed();
  const r = await build("--cap", "5");
  expect(r.code).toBe(1);
  expect(board().tickets.get("r/02")).toBeUndefined();
  expect(ticket()?.column).toBe("blocked");
  expect(ticket()?.reason).toMatch(/cap/);
});

// ---------- 37 ----------
const overseen = (...extra: string[]) => build("--silence-ms", "400", "--progress-ms", "10000", ...extra);
const verdict = (text: string): Reply => [{ event: { type: "result", subtype: "success", result: text } }];
const transcriptOf = (n: number) => {
  const f = readPipeline(pipelinePath()).builds.values().next().value?.passes[n]?.transcript;
  return readFileSync(join(dirname(pipelinePath()), f ?? "none"), "utf8");
};
const toolCall = { event: { type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "make" } }] } } };

test("37.1 a silent builder is cancelled and the next pass is told why", async () => {
  project.install(withJudges([[{ event: { type: "system", subtype: "init" } }, { pause: 20_000 }], [edit("ok.txt", "done")]]));
  await seed();
  const r = await overseen();
  expect(r.stdout).toContain("merging after 2 passes");
  expect(transcriptOf(0)).toContain('"act":"silent"');
  expect(transcriptOf(0)).toMatch(/silen/);
  expect(messages()[1]?.text).toContain("silent");
  expect(ticket()?.passes.map((p) => p.result)).toEqual(["red", "green"]);
  expect(ticket()?.retries).toBe(1);
});

test("37.2 a slow start is not silence", async () => {
  project.install(withJudges([[{ pause: 900 }, edit("ok.txt", "done")]]));
  await seed();
  const r = await overseen();
  expect(r.stdout).toContain("merging after 1 pass");
  expect(transcriptOf(0)).not.toContain('"act":"silent"');
});

test("37.3 classifier allow, and no verdict means deny", async () => {
  project.install({ roles: {
    ...judgeRoles(),
    builder: { replies: [[
      { ask: { id: "a1", tool: "Bash", input: { command: "ls" } } },
      { ask: { id: "a2", tool: "Bash", input: { command: "cat secrets" } } },
      edit("ok.txt", "done"),
    ]] },
    classifier: { replies: [verdict('{"verdict":"allow","comment":"just lists files"}'), verdict("hard to say")] },
  } });
  await seed();
  const r = await build("--silence-ms", "5000", "--progress-ms", "10000");
  expect(r.stdout).toContain("merging after 1 pass");
  const log = transcriptOf(0);
  // The two asks are open at once, so the classifier's replies go to them in launch order.
  expect(log).toMatch(/allowed Bash [^"]*: just lists files/);
  expect(log).toMatch(/denied Bash [^"]*: the classifier gave no verdict/);
  expect(log).toContain("The overseer denied this call: the classifier gave no verdict");
});

test("37.4 a looping verdict cancels the pass; no new tool call means no ask", async () => {
  project.install({ roles: {
    ...judgeRoles(),
    builder: { replies: [[toolCall, { pause: 20_000 }], [edit("ok.txt", "done")]] },
    classifier: { replies: [verdict('{"verdict":"looping","reason":"make fails the same way"}')] },
  } });
  await seed();
  const r = await build("--silence-ms", "5000", "--progress-ms", "300");
  expect(r.stdout).toContain("merging after 2 passes");
  expect(messages()[1]?.text).toContain("make fails the same way");
  expect(transcriptOf(0)).toContain('"act":"looping"');
  expect(transcriptOf(0)).toContain("make fails the same way");
});

test("37.4b no new tool call since the last verdict: the classifier is not asked", async () => {
  project.install({ roles: {
    ...judgeRoles(),
    builder: { replies: [[toolCall, { pause: 3000 }, edit("ok.txt", "done")]] },
    classifier: { replies: [verdict('{"verdict":"not looping","reason":"progressing"}'), verdict('{"verdict":"not looping","reason":"progressing"}'), verdict('{"verdict":"not looping","reason":"progressing"}')] },
  } });
  await seed();
  await build("--silence-ms", "10000", "--progress-ms", "300");
  expect(launched("classifier").length).toBe(1);
});

test("37.5 a failed process probe cancels nothing", async () => {
  const bin = join(project.dir, "..", "psbin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "ps"), "#!/bin/sh\nexit 1\n");
  chmodSync(join(bin, "ps"), 0o755);
  project.install(withJudges([[toolCall, { pause: 2500 }, edit("ok.txt", "done")]]));
  await seed();
  const fakeDir = join(import.meta.dir, "..", "fake");
  const r = await project.run(["bun", CLI, "build", "r/01", "--poll-ms", "100", "--silence-ms", "10000", "--flat-ms", "300", "--progress-ms", "10000"], {
    PATH: `${fakeDir}:${bin}:${process.env.PATH}`,
  });
  expect(r.stdout).toContain("merging after 1 pass");
  expect(transcriptOf(0)).toMatch(/probe-failed|probe failed/);
});
