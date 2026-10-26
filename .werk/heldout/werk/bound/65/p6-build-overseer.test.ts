import { afterEach, beforeEach, expect, setDefaultTimeout, test } from "bun:test";
setDefaultTimeout(120_000);
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { readBoard } from "../src/board/log-store.ts";
import type { LaunchRecord, MessageRecord } from "../src/fake-agent/launch-log.ts";
import type { Reply } from "../src/fake-agent/script.ts";
import {
  AREA_ROLES,
  findingsOf,
  gradeOf,
  judgeRoles,
  line,
  withJudges,
} from "../src/build/judge-fixtures.ts";
import { decided } from "../src/map/mark-fixtures.ts";
import { readPipeline } from "../src/pipeline/log-store.ts";
import { createProject, type Project } from "../src/test-env/project.ts";

const CLI = join(import.meta.dir, "..", "src", "cli.ts");
const MAKEFILE = "check:\n\t@test -f ok.txt\n";

let project: Project;
const extraDirs: string[] = [];
const boardPath = () => join(project.dir, ".werk", "board.jsonl");
const pipelinePath = () => join(project.dir, ".werk", "pipeline.jsonl");
const board = () => readBoard(boardPath());
const ticket = (id = "r/01") => board().tickets.get(id);
const writeLines = (path: string, events: unknown[]) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, events.map((e) => `${JSON.stringify(e)}\n`).join(""));
};
const edit = (path: string, content: string) => ({ edit: path, content });
const messages = () =>
  project
    .launches()
    .filter(
      (r): r is MessageRecord => r.kind === "message" && r.role === "builder",
    );
const launches = () =>
  project.launches().filter((r): r is LaunchRecord => r.kind === "launch");
const launched = (role: string) => launches().filter((l) => l.role === role);
const passesOf = () =>
  [...readPipeline(pipelinePath()).builds.values()][0]?.passes ?? [];
const transcriptOf = (pass: number) => {
  const file = passesOf()[pass]?.transcript;
  return readFileSync(join(dirname(pipelinePath()), file ?? "none"), "utf8");
};
const result = (text: string): Reply => [
  { event: { type: "result", subtype: "success", result: text } },
];

type Seed = {
  criteria?: string[];
  cards?: { id: string; title: string }[];
  extraTickets?: boolean;
};
async function seed({
  criteria = ["ok.txt exists"],
  cards = [{ id: "top", title: "Seat price" }],
  extraTickets = false,
}: Seed = {}) {
  writeFileSync(join(project.dir, "Makefile"), MAKEFILE);
  await project.run(["git", "add", "-A"]);
  await project.run(["git", "commit", "-q", "-m", "Add the Makefile"]);
  writeLines(
    project.logPath,
    cards.flatMap((c) => decided(c.id, { title: c.title, why: "Because." })),
  );
  const planned: unknown[] = [
    { type: "ticket.planned", id: "r/01", title: "Paste a screenshot" },
  ];
  if (extraTickets)
    planned.push({
      type: "ticket.planned",
      id: "r/02",
      title: "Needs the first",
      blocked_by: ["r/01"],
    });
  writeLines(boardPath(), planned);
  const text = `title: Paste a screenshot
cites: ${cards.map((c) => c.id).join(", ")}
blocked_by:
stories: 1
touches: checks

## What to build

Make ok.txt exist.

## Acceptance criteria

${criteria.map((c) => `- [ ] ${c}`).join("\n")}

## Checks

- \`make check\`
`;
  const file = join(project.dir, ".werk", "tickets", "r", "01.md");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
  if (extraTickets) {
    writeFileSync(
      join(project.dir, ".werk", "tickets", "r", "02.md"),
      text.replace("title: Paste a screenshot", "title: Needs the first").replace("blocked_by:", "blocked_by: r/01"),
    );
  }
}
const build = (...extra: string[]) =>
  project.run(["bun", CLI, "build", "r/01", "--poll-ms", "100", ...extra]);
const overseen = (...extra: string[]) =>
  build("--silence-ms", "400", "--progress-ms", "10000", ...extra);

async function until(test: () => boolean, ms = 20_000) {
  const stop = Date.now() + ms;
  while (!test() && Date.now() < stop) await Bun.sleep(25);
  return test();
}

beforeEach(() => {
  project = createProject();
});
afterEach(async () => {
  await project.dispose();
  for (const d of extraDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const TWO = ["ok.txt exists", "the list is not empty"];

test("35.1 a failed grade on one criterion sends its gap to the next builder pass", async () => {
  project.install(
    withJudges(
      [[edit("ok.txt", "done")], [edit("note.txt", "more"), { pause: 2500 }]],
      {
        grades: [
          gradeOf(
            line("criterion-1", 4),
            line("criterion-2", 2, "an empty list is still sent"),
            line("card-top", 4),
            line("scope", 5),
          ),
        ],
      },
    ),
  );
  await seed({ criteria: TWO });
  const child = project.start([
    "bun", CLI, "build", "r/01", "--poll-ms", "100",
  ]);
  expect(await until(() => messages().length >= 2)).toBe(true);
  // The second builder pass has started: the board still shows the ticket building.
  expect(ticket()?.column).toBe("building");
  expect(ticket()?.passes.map((p) => p.result)).toEqual(["red"]);
  expect(messages()[1]?.text).toContain("an empty list is still sent");
  expect(passesOf()[0]?.gate).toBe("grader");
  expect(passesOf()[0]?.result).toBe("red");
  child.kill("SIGKILL");
  await child.exited;
});

test("35.2 a later grade does not fail a line that passed before", async () => {
  project.install(
    withJudges([[edit("ok.txt", "done")], [edit("note.txt", "more")]], {
      grades: [
        gradeOf(
          line("criterion-1", 4),
          line("card-images", 2, "images are dropped"),
          line("card-menu", 4),
          line("scope", 5),
        ),
        gradeOf(
          line("criterion-1", 4),
          line("card-images", 4),
          line("card-menu", 2, "a small detail that existed at the first grade"),
          line("scope", 5),
        ),
      ],
    }),
  );
  await seed({
    cards: [
      { id: "images", title: "A message carries its images" },
      { id: "menu", title: "The composer shows a menu" },
    ],
  });
  const r = await build();
  expect(r.stdout).toContain("merging after 2 passes");
  expect(passesOf().map((p) => p.result)).toEqual(["red", "green"]);
  // The pass went on to the review: the five reviewers ran in pass 2.
  expect(launched("reviewer-security")).toHaveLength(1);
});

test("35.3 one HIGH security finding alone fails a passing grade", async () => {
  const pausedNone = [{ pause: 1200 }, ...findingsOf()] as Reply;
  const script = withJudges([[edit("ok.txt", "done")], [edit("note.txt", "more")]], {
    reviews: {
      "reviewer-security": [
        [
          { pause: 1200 },
          ...findingsOf({
            severity: "HIGH",
            file: "ok.txt",
            line: 3,
            impact: "the secret is written in plain text",
            fix: "read it from the environment",
          }),
        ],
        findingsOf(),
      ],
      ...Object.fromEntries(
        AREA_ROLES.filter((r) => r !== "reviewer-security").map((r) => [
          r,
          [[{ pause: 1200 }, ...findingsOf()], findingsOf()],
        ]),
      ),
    },
  });
  void pausedNone;
  project.install(script);
  await seed();
  const child = project.start(["bun", CLI, "build", "r/01", "--poll-ms", "100"]);
  // All five reviewers start before the first one ends (read at the same time).
  const reviewers = () => launches().filter((l) => l.role.startsWith("reviewer-"));
  expect(await until(() => reviewers().length >= 1)).toBe(true);
  const t0 = Date.now();
  const allFive = await until(() => reviewers().length >= 5, 1000);
  expect(allFive).toBe(true);
  expect(Date.now() - t0).toBeLessThan(1000);
  const out = await new Response(child.stdout).text();
  await child.exited;
  expect(out).toContain("merging after 2 passes");
  const pass = passesOf()[0];
  expect(pass?.gate).toBe("reviewer");
  expect(pass?.reason).toContain("security HIGH at ok.txt:3");
  const second = messages()[1]?.text ?? "";
  expect(second).toContain("the secret is written in plain text");
  expect(second).toContain("read it from the environment");
});

test("35.4 MEDIUM and unknown findings are recorded and do not block", async () => {
  project.install(
    withJudges([[edit("ok.txt", "done")]], {
      reviews: {
        "reviewer-design": [
          findingsOf({ severity: "MEDIUM", file: "a.ts", line: 1, impact: "i", fix: "f" }),
        ],
        "reviewer-tests": [
          findingsOf({ severity: "unknown-sev", file: "c.ts", line: 3, impact: "i", fix: "f" }),
        ],
      },
    }),
  );
  await seed();
  const r = await build();
  expect(r.stdout).toContain("merging after 1 pass");
  expect(ticket()?.column).toBe("merging");
  const events = readFileSync(pipelinePath(), "utf8")
    .split("\n")
    .filter((l) => l.includes('"step":"pass"') && l.includes('"step.ended"'));
  const file = JSON.parse(events[0] as string).findings as string;
  const recorded = JSON.parse(readFileSync(join(dirname(pipelinePath()), file), "utf8"));
  expect(recorded.map((f: { severity: string }) => f.severity).sort()).toEqual([
    "MEDIUM",
    "unknown-sev",
  ]);
});

test("35.5 the grader starts with read-only tools only", async () => {
  project.install(withJudges([[edit("ok.txt", "done")]]));
  await seed();
  const r = await build();
  expect(r.stdout).toContain("merging after 1 pass");
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
  for (const write of ["Edit", "Write", "MultiEdit", "NotebookEdit"])
    expect(args.join(" ")).not.toContain(write);
  // The scores came back to the loop: the pass is green and graded.
  expect(passesOf()[0]?.result).toBe("green");
});

const bad = gradeOf(
  line("criterion-1", 2, "ok.txt is wrong"),
  line("card-top", 4),
  line("scope", 5),
);

test("35.6 the last counted pass with only a small gap merges and files a follow-up", async () => {
  const small = gradeOf(
    line("criterion-1", 4),
    line("card-images", 2, "an empty list is still sent", { builds: true }),
    line("scope", 5),
  );
  const badImages = gradeOf(
    line("criterion-1", 4),
    line("card-images", 2, "an empty list is still sent"),
    line("scope", 5),
  );
  project.install(
    withJudges(
      [
        [edit("ok.txt", "done")],
        [edit("n1.txt", "1")],
        [edit("n2.txt", "2")],
        [edit("n3.txt", "3")],
        [edit("n4.txt", "4")],
      ],
      { grades: [badImages, badImages, badImages, badImages, small] },
    ),
  );
  await seed({ cards: [{ id: "images", title: "A message carries its images" }] });
  const r = await build("--cap", "5");
  expect(r.stdout).toContain("merging after 5 passes");
  expect(r.stdout).toContain("follow-up r/02 filed");
  const t = ticket();
  expect(t?.followups).toEqual(["r/02"]);
  const f = board().tickets.get("r/02");
  expect(f?.blockedBy).toEqual(["r/01"]);
  const text = readFileSync(join(project.dir, ".werk", "tickets", "r", "02.md"), "utf8");
  expect(text).toContain("cites: images");
  expect(text).toContain("an empty list is still sent");
  expect(t?.column).toBe("merging");
  // "and then to done": needs the merge loop, which is not part of `werk build`.
  expect(t?.column).toBe("done");
});

test("35.7 the last counted pass with a missed criterion parks the ticket", async () => {
  const miss = gradeOf(
    line("criterion-1", 2, "ok.txt is wrong"),
    line("card-top", 2, "a small gap", { builds: true }),
    line("scope", 5),
  );
  project.install(
    withJudges(
      [
        [edit("ok.txt", "done")],
        [edit("n1.txt", "1")],
        [edit("n2.txt", "2")],
        [edit("n3.txt", "3")],
        [edit("n4.txt", "4")],
      ],
      { grades: [bad, bad, bad, bad, miss] },
    ),
  );
  await seed({ extraTickets: true });
  const r = await build("--cap", "5");
  expect(r.code).toBe(1);
  expect(board().tickets.get("r/03")).toBeUndefined();
  expect(board().tickets.get("r/02")?.blockedBy).toEqual(["r/01"]);
  expect(ticket()?.followups).toEqual([]);
  expect(ticket()?.reason).toContain("retry cap");
  expect(ticket()?.retries).toBe(5);
  // The step says the ticket "shows as blocked".
  expect(ticket()?.column).toBe("blocked");
  expect(board().tickets.get("r/02")?.column).not.toBe("done");
});

const silentPass: Reply = [{ event: { type: "system", subtype: "init" } }, { pause: 20_000 }];

test("37.1 a silent builder is cancelled and the next pass is told why", async () => {
  project.install(withJudges([silentPass, [edit("ok.txt", "done")]]));
  await seed();
  const r = await overseen();
  expect(r.stdout).toContain("merging after 2 passes");
  expect(transcriptOf(0)).toContain('"act":"silent"');
  expect(messages()[1]?.text).toContain("silent");
  expect(ticket()?.passes.map((p) => p.result)).toEqual(["red", "green"]);
  expect(ticket()?.retries).toBe(1);
  // The silent pass counts against the cap: with a cap of 1 the ticket stops after it.
  await project.dispose();
  project = createProject();
  project.install(withJudges([silentPass, [edit("ok.txt", "done")]]));
  await seed();
  const capped = await overseen("--cap", "1");
  expect(capped.stdout).toContain("ready after 1 pass");
  expect(ticket()?.retries).toBe(1);
});

test("37.2 a slow start is not treated as silence", async () => {
  project.install(withJudges([[{ pause: 900 }, edit("ok.txt", "done")]]));
  await seed();
  const r = await overseen();
  expect(r.stdout).toContain("merging after 1 pass");
  expect(transcriptOf(0)).not.toContain('"act":"silent"');
});

test("37.3 a permission ask is decided by the classifier, and no verdict means deny", async () => {
  project.install({
    roles: {
      ...judgeRoles(),
      builder: {
        replies: [
          [
            { ask: { id: "a1", tool: "Bash", input: { command: "make lint" } } },
            { pause: 500 },
            { ask: { id: "a2", tool: "Bash", input: { command: "ls" } } },
            edit("ok.txt", "done"),
          ],
        ],
      },
      classifier: {
        replies: [
          result('{"verdict":"allow","comment":"fits the ticket"}'),
          result("hard to say"),
        ],
      },
    },
  });
  await seed();
  const r = await build("--silence-ms", "5000", "--progress-ms", "10000");
  const log = transcriptOf(0);
  expect(log).toContain("allowed Bash make lint: fits the ticket");
  expect(log).toContain('"content":"allowed"');
  expect(log).toContain("denied Bash ls: the classifier gave no verdict");
  expect(log).toContain("The overseer denied this call: the classifier gave no verdict");
  expect(r.stdout).toContain("merging after 1 pass");
});

const toolCall = {
  event: {
    type: "assistant",
    message: {
      content: [
        { type: "tool_use", id: "t1", name: "Bash", input: { command: "make" } },
      ],
    },
  },
};

test("37.4 a looping verdict cancels the pass and the reason reaches the next brief", async () => {
  project.install({
    roles: {
      ...judgeRoles(),
      builder: {
        replies: [[toolCall, { pause: 20_000 }], [edit("ok.txt", "done")]],
      },
      classifier: {
        replies: [
          result('{"verdict":"looping","reason":"make fails the same way"}'),
        ],
      },
    },
  });
  await seed();
  const r = await build("--silence-ms", "5000", "--progress-ms", "300");
  expect(r.stdout).toContain("merging after 2 passes");
  const log = transcriptOf(0);
  expect(log).toContain('"act":"looping"');
  expect(log).toContain("make fails the same way");
  expect(messages()[1]?.text).toContain("make fails the same way");

  // But when no new tool call came since the last verdict, the classifier is not asked.
  await project.dispose();
  project = createProject();
  project.install({
    roles: {
      ...judgeRoles(),
      builder: { replies: [[toolCall, { pause: 3000 }, edit("ok.txt", "done")]] },
      classifier: {
        replies: [
          result('{"verdict":"not looping","reason":"moving"}'),
          result('{"verdict":"not looping","reason":"moving"}'),
          result('{"verdict":"not looping","reason":"moving"}'),
        ],
      },
    },
  });
  await seed();
  await build("--silence-ms", "5000", "--progress-ms", "300", "--flat-ms", "60000");
  expect(launched("classifier")).toHaveLength(1);
});

function psShim(): string {
  const dir = mkdtempSync(join(tmpdir(), "werk-p6-shim-"));
  extraDirs.push(dir);
  const ps = join(dir, "ps");
  writeFileSync(ps, "#!/bin/sh\necho 'ps: cannot read the process table' >&2\nexit 1\n");
  chmodSync(ps, 0o755);
  return dir;
}

test("37.5 a failed process probe cancels nothing", async () => {
  const path = `${psShim()}${delimiter}${process.env.PATH}`;
  const run = (...extra: string[]) =>
    project.run(
      ["bun", CLI, "build", "r/01", "--poll-ms", "100", "--silence-ms", "5000", "--flat-ms", "300", ...extra],
      { PATH: path },
    );
  project.install(withJudges([[toolCall, { pause: 1500 }, edit("ok.txt", "done")]]));
  await seed();
  const r = await run();
  const log = transcriptOf(0);
  expect(log).toContain('"act":"probe-failed"');
  expect(log).not.toContain('"act":"frozen"');
  expect(log).not.toContain('"act":"silent"');
  expect(r.stdout).toContain("merging after 1 pass");

  // The pass ends at the wall-clock limit when the tool call never returns.
  await project.dispose();
  project = createProject();
  project.install(withJudges([[toolCall, { pause: 20_000 }]]));
  await seed();
  const t0 = Date.now();
  const stuck = await run("--cap", "1", "--agent-ms", "2500");
  const log2 = transcriptOf(0);
  expect(log2).toContain('"act":"probe-failed"');
  expect(log2).not.toContain('"act":"frozen"');
  expect(stuck.stdout).toContain("ready after 1 pass");
  expect(passesOf()[0]?.reason ?? "").toContain("time limit");
  expect(Date.now() - t0).toBeLessThan(15_000);
});
