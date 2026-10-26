import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { appendBoardEvent, readBoard } from "../../src/board/log-store.ts";
import type {
  LaunchRecord,
  MessageRecord,
} from "../../src/fake-agent/launch-log.ts";
import type { Reply, Script } from "../../src/fake-agent/script.ts";
import { open } from "../../src/map/mark-fixtures.ts";
import { readPipeline } from "../../src/pipeline/log-store.ts";
import { readBoardView } from "../../src/serve/board-read.ts";
import { createProject, type Project } from "../../src/test-env/project.ts";

const CLI = join(import.meta.dir, "..", "..", "src", "cli.ts");
const MAKEFILE = "check:\n\t@test -f ok.txt\n";

const ticketText = (
  cites: string,
  criteria: string[],
) => `title: Paste a screenshot
cites: ${cites}
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

let project: Project;
let extraEnv: Record<string, string> = {};
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
const findingsOf = (...findings: unknown[]): Reply =>
  result(JSON.stringify({ findings }));
const AREA_ROLES = [
  "reviewer-design",
  "reviewer-maintainability",
  "reviewer-tests",
  "reviewer-security",
  "reviewer-performance",
];
// Default grade: every line of the one-card, two-criterion ticket passes.
const GOOD1 = gradeOf(
  line("criterion-1", 4),
  line("criterion-2", 4),
  line("card-images", 4),
  line("scope", 5),
);
type Judging = { grades?: Reply[]; reviews?: Record<string, Reply[]> };
const judgeRoles = (judging: Judging = {}) => ({
  grader: { replies: judging.grades ?? Array(6).fill(GOOD1) },
  ...Object.fromEntries(
    AREA_ROLES.map((role) => [
      role,
      { replies: judging.reviews?.[role] ?? Array(6).fill(findingsOf()) },
    ]),
  ),
});
const withJudges = (builds: Reply[], judging: Judging = {}): Script => ({
  roles: { builder: { replies: builds }, ...judgeRoles(judging) },
});
const messages = () =>
  project
    .launches()
    .filter(
      (r): r is MessageRecord => r.kind === "message" && r.role === "builder",
    );
const launches = () =>
  project.launches().filter((r): r is LaunchRecord => r.kind === "launch");
const launched = (role: string) => launches().filter((l) => l.role === role);

type Card = { id: string; title: string };
async function seed(
  opts: { cards?: Card[]; criteria?: string[]; makefile?: string } = {},
) {
  const cards = opts.cards ?? [
    { id: "images", title: "A message carries its images" },
  ];
  const criteria = opts.criteria ?? [
    "A pasted screenshot is sent",
    "An empty list is not sent",
  ];
  writeFileSync(join(project.dir, "Makefile"), opts.makefile ?? MAKEFILE);
  await project.run(["git", "add", "-A"]);
  await project.run(["git", "commit", "-q", "-m", "Add the Makefile"]);
  writeLines(
    project.logPath,
    cards.flatMap((c) => [
      ...open(c.id, { title: c.title, why: "Because." }),
      { type: "node.edited", id: c.id, who: "me", noBasis: "test" },
      { type: "criterion.added", id: c.id, form: "revisit" },
      { type: "node.decided", id: c.id },
    ]),
  );
  writeLines(boardPath(), [
    { type: "ticket.planned", id: "r/01", title: "Paste a screenshot" },
  ]);
  const file = join(project.dir, ".werk", "tickets", "r", "01.md");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, ticketText(cards.map((c) => c.id).join(", "), criteria));
}

const runBuild = (args: string[]) =>
  project.run(
    ["bun", CLI, "build", "r/01", "--poll-ms", "100", ...args],
    extraEnv,
  );
const startBuild = (args: string[]) =>
  project.start(
    ["bun", CLI, "build", "r/01", "--poll-ms", "100", ...args],
    extraEnv,
  );
const until = async <T>(read: () => T | undefined, ms = 15000): Promise<T> => {
  const end = Date.now() + ms;
  for (;;) {
    const v = read();
    if (v !== undefined) return v;
    if (Date.now() > end) throw new Error("timed out");
    await Bun.sleep(50);
  }
};
const passes = () =>
  [...readPipeline(pipelinePath()).builds.values()][0]?.passes ?? [];
const transcriptOf = (pass: number) => {
  const file = passes()[pass]?.transcript;
  return readFileSync(join(dirname(pipelinePath()), file ?? "none"), "utf8");
};
/** A wrapper before the fake agent that saves each launch's whole prompt (the fake records only the first line). */
function tapPrompts(): string {
  const dir = mkdtempSync(join(tmpdir(), "werk-tap-"));
  mkdirSync(join(dir, "bin"));
  mkdirSync(join(dir, "out"));
  const fake = join(import.meta.dir, "..", "..", "fake", "claude");
  const wrapper = join(dir, "bin", "claude");
  writeFileSync(
    wrapper,
    `#!/bin/sh\nif [ "$WERK_AGENT_ROLE" = builder ]; then exec "${fake}" "$@"; fi\ncat > "${dir}/out/$WERK_AGENT_ROLE-$$.txt"\nexec "${fake}" "$@" < "${dir}/out/$WERK_AGENT_ROLE-$$.txt"\n`,
  );
  chmodSync(wrapper, 0o755);
  extraEnv = { PATH: `${join(dir, "bin")}:${process.env.PATH}` };
  return join(dir, "out");
}
const savedPrompts = (dir: string, role: string) =>
  readdirSync(dir)
    .filter((f) => f.startsWith(`${role}-`))
    .map((f) => readFileSync(join(dir, f), "utf8"));

beforeEach(() => {
  project = createProject();
  extraEnv = {};
});
afterEach(() => project.dispose());

// ------------------------------------------------------------------ werk/35

test("35.1 a failed grade on one criterion stops before the merge and its gap reaches the next builder pass", async () => {
  project.install(
    withJudges([[edit("ok.txt", "done")], [{ pause: 30_000 }]], {
      grades: [
        gradeOf(
          line("criterion-1", 4),
          line("criterion-2", 2, "an empty list is still sent"),
          line("card-images", 4),
          line("scope", 5),
        ),
      ],
    }),
  );
  await seed();
  const child = startBuild([]);
  await until(() => (messages().length >= 2 ? true : undefined));
  const first = passes()[0];
  expect(first?.result).toBe("red");
  expect(first?.gate).toBe("grader");
  expect(messages()[1]?.text).toContain("an empty list is still sent");
  // The ticket never moved to merging and the board shows it still building.
  expect(readFileSync(boardPath(), "utf8")).not.toContain('"to":"merging"');
  expect(ticket()?.column).toBe("building");
  expect(
    readBoardView(project.logPath).columns.building.map((t) => t.id),
  ).toEqual(["r/01"]);
  expect(launched("reviewer-design")).toHaveLength(0);
  child.kill();
  await child.exited;
});

test("35.2 a later grade does not fail a line that passed before", async () => {
  const cards = [
    { id: "images", title: "A message carries its images" },
    { id: "menu", title: "The composer shows a menu" },
  ];
  project.install(
    withJudges([[edit("ok.txt", "done")], [edit("note.txt", "more")]], {
      grades: [
        gradeOf(
          line("criterion-1", 4),
          line("criterion-2", 4),
          line("card-images", 2, "images are dropped"),
          line("card-menu", 4),
          line("scope", 5),
        ),
        gradeOf(
          line("criterion-1", 4),
          line("criterion-2", 4),
          line("card-images", 4),
          line(
            "card-menu",
            2,
            "the menu lacks a small detail that was always there",
          ),
          line("scope", 5),
        ),
      ],
    }),
  );
  await seed({ cards });
  const res = await runBuild([]);
  expect(res.stdout).toContain("merging after 2 passes");
  expect(passes()[0]?.gate).toBe("grader");
  expect(passes()[1]?.result).toBe("green");
  // The pass went on to the review: the reviewers ran on pass 2 only.
  expect(launched("reviewer-security")).toHaveLength(1);
  expect(ticket()?.column).toBe("merging");
});

test("35.3 one HIGH security finding alone fails a passing grade, with the five reviewers running together", async () => {
  const high = {
    severity: "HIGH",
    file: "ok.txt",
    line: 3,
    impact: "the secret is written in plain text",
    fix: "read it from the environment",
  };
  project.install(
    withJudges([[edit("ok.txt", "done")], [edit("note.txt", "more")]], {
      reviews: Object.fromEntries(
        AREA_ROLES.map((role) => [
          role,
          [
            [
              { pause: 700 },
              ...(role === "reviewer-security"
                ? findingsOf(high)
                : findingsOf()),
            ],
            findingsOf(),
          ],
        ]),
      ),
    }),
  );
  await seed();
  const res = await runBuild([]);
  expect(res.stdout).toContain("merging after 2 passes");
  const pass = passes()[0];
  expect(pass?.gate).toBe("reviewer");
  expect(pass?.reason).toContain("security HIGH at ok.txt:3");
  const second = messages()[1]?.text ?? "";
  expect(second).toContain("the secret is written in plain text");
  expect(second).toContain("read it from the environment");
  // All five reviewers of pass 1 started before the first of them ended.
  const events = readFileSync(pipelinePath(), "utf8")
    .split("\n")
    .filter((l) => l !== "")
    .map((l) => JSON.parse(l))
    .filter((e) => e.step === "reviewer" && String(e.id).includes(":p1:"));
  const firstEnd = events.findIndex((e) => e.type === "step.ended");
  const startsBefore = events
    .slice(0, firstEnd)
    .filter((e) => e.type === "step.started");
  expect(startsBefore).toHaveLength(5);
});

test("35.4 MEDIUM and unknown findings are recorded and do not block", async () => {
  const f = (severity: string, file: string, ln: number) => ({
    severity,
    file,
    line: ln,
    impact: "i",
    fix: "f",
  });
  project.install(
    withJudges([[edit("ok.txt", "done")]], {
      reviews: {
        "reviewer-design": [findingsOf(f("MEDIUM", "a.ts", 1))],
        "reviewer-tests": [findingsOf(f("trivial", "c.ts", 3))],
      },
    }),
  );
  await seed();
  const res = await runBuild([]);
  expect(res.stdout).toContain("merging after 1 pass");
  expect(ticket()?.column).toBe("merging");
  const ended = readFileSync(pipelinePath(), "utf8")
    .split("\n")
    .filter((l) => l.includes('"step":"pass"') && l.includes('"step.ended"'));
  const file = JSON.parse(ended[0] as string).findings as string;
  const recorded = JSON.parse(
    readFileSync(join(dirname(pipelinePath()), file), "utf8"),
  );
  expect(recorded.map((x: { severity: string }) => x.severity).sort()).toEqual([
    "MEDIUM",
    "trivial",
  ]);
});

test("35.5 the grader starts with read-only tools only and its scores come back", async () => {
  project.install(withJudges([[edit("ok.txt", "done")]]));
  await seed();
  const res = await runBuild([]);
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
  // The scores reached the loop: the pass passed its grade and went on to the review.
  expect(res.stdout).toContain("merging after 1 pass");
  expect(launched("reviewer-design")).toHaveLength(1);
  // Observation: the pipeline log's own start record of the grader step holds its role only.
  const started = readFileSync(pipelinePath(), "utf8")
    .split("\n")
    .filter(
      (l) => l.includes('"step":"grader"') && l.includes('"step.started"'),
    );
  expect(started).toHaveLength(1);
  console.log("35.5 grader step.started in the pipeline log:", started[0]);
});

const small = (gap: string) =>
  gradeOf(
    line("criterion-1", 4),
    line("criterion-2", 4),
    line("card-images", 2, gap, { builds: true }),
    line("scope", 5),
  );

test("35.6 the last counted pass with only a small gap merges and files a follow-up that waits for the ticket", async () => {
  project.install(
    withJudges(
      [1, 2, 3, 4, 5].map((n) => [edit("ok.txt", `done ${n}`)]),
      { grades: Array(5).fill(small("an empty list is still sent")) },
    ),
  );
  await seed();
  const res = await runBuild(["--cap", "5"]);
  expect(res.stdout).toContain("merging after 5 passes");
  expect(res.stdout).toContain("follow-up r/02 filed");
  expect(
    passes()
      .slice(0, 4)
      .map((p) => [p.result, p.gate]),
  ).toEqual(Array(4).fill(["red", "grader"]));
  expect(ticket()?.column).toBe("merging");
  const followup = board().tickets.get("r/02");
  expect(followup?.blockedBy).toEqual(["r/01"]);
  const file = readFileSync(
    join(project.dir, ".werk", "tickets", "r", "02.md"),
    "utf8",
  );
  expect(file).toContain("cites: images");
  expect(file).toContain('#images: "an empty list is still sent"');
  // The follow-up does not build before the original ticket is done.
  const early = appendBoardEvent(boardPath(), {
    type: "ticket.moved",
    id: "r/02",
    to: "building",
    actor: "you",
  });
  expect(early.ok).toBe(false);
  // The ticket then goes to done. Only a merge moves it there.
  expect(ticket()?.column).toBe("done");
});

test("35.7 the last counted pass with a missed criterion parks the ticket, files no follow-up and keeps dependants waiting", async () => {
  const bad = gradeOf(
    line("criterion-1", 2, "ok.txt is wrong"),
    line("criterion-2", 4),
    line("card-images", 2, "a small gap", { builds: true }),
    line("scope", 5),
  );
  project.install(
    withJudges(
      [1, 2, 3, 4, 5].map((n) => [edit("ok.txt", `done ${n}`)]),
      { grades: Array(5).fill(bad) },
    ),
  );
  await seed();
  appendBoardEvent(boardPath(), {
    type: "ticket.planned",
    id: "r/02",
    title: "Needs the first",
    blocked_by: ["r/01"],
  });
  const res = await runBuild(["--cap", "5"]);
  expect(res.stdout).toContain("after 5 passes");
  expect(res.stdout).not.toContain("follow-up");
  expect(board().tickets.size).toBe(2);
  expect(ticket()?.followups).toEqual([]);
  // The dependant still waits for the ticket.
  const dep = appendBoardEvent(boardPath(), {
    type: "ticket.moved",
    id: "r/02",
    to: "building",
    actor: "you",
  });
  expect(dep.ok).toBe(false);
  expect(
    readBoardView(project.logPath).columns.ready.find((t) => t.id === "r/02")
      ?.openBlockers,
  ).toBe(1);
  // The ticket shows as blocked, with the stop reason.
  expect(ticket()?.column).toBe("blocked");
  expect(ticket()?.reason).toContain("retry cap");
});

// ------------------------------------------------------------------ werk/37

const init = { event: { type: "system", subtype: "init" } };
const verdict = (text: string): Reply => [
  { event: { type: "result", subtype: "success", result: text } },
];
const toolCall = {
  event: {
    type: "assistant",
    message: {
      content: [
        {
          type: "tool_use",
          id: "t1",
          name: "Bash",
          input: { command: "make" },
        },
      ],
    },
  },
};

test("37.1 a silent builder is cancelled for silence, the next brief says so, and the fresh pass counts against the cap", async () => {
  project.install(
    withJudges([[init, { pause: 20_000 }], [edit("a.txt", "x")]]),
  );
  await seed();
  const res = await runBuild([
    "--silence-ms",
    "50",
    "--progress-ms",
    "10000",
    "--cap",
    "2",
  ]);
  expect(passes()[0]).toMatchObject({ result: "red", gate: "overseer" });
  expect(transcriptOf(0)).toContain('"act":"silent"');
  expect(transcriptOf(0)).toContain("no event for 0.05 s");
  expect(launched("builder")).toHaveLength(2);
  expect(messages()[1]?.text).toContain("silent");
  // Pass 1 and pass 2 both counted: the cap of 2 is used up.
  expect(res.stdout).toContain("ready after 2 passes");
  expect(ticket()?.retries).toBe(2);
});

test("37.2 a slow start is not treated as silence", async () => {
  project.install(withJudges([[{ pause: 900 }, edit("ok.txt", "done")]]));
  await seed();
  const res = await runBuild(["--silence-ms", "50", "--progress-ms", "10000"]);
  expect(res.stdout).toContain("merging after 1 pass");
  expect(launched("builder")).toHaveLength(1);
  expect(transcriptOf(0)).not.toContain('"act":"silent"');
  expect(passes()[0]?.result).toBe("green");
});

test("37.3 a permission ask is decided by the classifier and no verdict means deny", async () => {
  project.install({
    roles: {
      ...judgeRoles(),
      builder: {
        replies: [
          [
            { ask: { id: "a1", tool: "Bash", input: { command: "ls" } } },
            { pause: 1500 },
            { ask: { id: "a2", tool: "Bash", input: { command: "pwd" } } },
            edit("ok.txt", "done"),
          ],
        ],
      },
      classifier: {
        replies: [
          verdict('{"verdict":"allow","comment":"listing files is fine"}'),
          verdict("hard to say"),
        ],
      },
    },
  });
  await seed();
  const res = await runBuild([
    "--silence-ms",
    "5000",
    "--progress-ms",
    "100000",
  ]);
  const log = transcriptOf(0);
  const events = log
    .split("\n")
    .filter((l) => l !== "")
    .map((l) => {
      const o = JSON.parse(l);
      return o.event ?? o;
    });
  const toolResult = (id: string) =>
    events.find(
      (e) => e.type === "user" && e.message?.content?.[0]?.tool_use_id === id,
    )?.message.content[0];
  expect(log).toContain("allowed Bash ls: listing files is fine");
  expect(toolResult("a1")).toMatchObject({
    content: "allowed",
    is_error: false,
  });
  expect(log).toContain("denied Bash pwd: the classifier gave no verdict");
  expect(toolResult("a2")).toMatchObject({ is_error: true });
  expect(toolResult("a2").content).toContain("The overseer denied this call");
  expect(launched("classifier")).toHaveLength(2);
  // The builder went on without the denied call.
  expect(res.stdout).toContain("merging after 1 pass");
});

test("37.4 a looping verdict cancels the pass and the reason reaches the next brief", async () => {
  const taps = tapPrompts();
  project.install({
    roles: {
      ...judgeRoles(),
      builder: {
        replies: [[toolCall, { pause: 20_000 }], [edit("ok.txt", "done")]],
      },
      classifier: {
        replies: [
          verdict('{"verdict":"looping","reason":"make fails the same way"}'),
        ],
      },
    },
  });
  await seed();
  const res = await runBuild(["--silence-ms", "5000", "--progress-ms", "300"]);
  expect(res.stdout).toContain("merging after 2 passes");
  expect(passes()[0]).toMatchObject({ result: "red", gate: "overseer" });
  const log = transcriptOf(0);
  expect(log).toContain('"act":"looping"');
  expect(log).toContain("make fails the same way");
  expect(messages()[1]?.text).toContain("make fails the same way");
  const [asked] = savedPrompts(taps, "classifier");
  expect(asked).toContain("Bash make");
  expect(asked).toContain("Make ok.txt exist");
});

test("37.4 the classifier is not asked again when no new tool call came since the last verdict", async () => {
  project.install({
    roles: {
      ...judgeRoles(),
      builder: {
        replies: [[toolCall, { pause: 2500 }, edit("ok.txt", "done")]],
      },
      classifier: {
        replies: [
          verdict('{"verdict":"not looping","reason":"one call so far"}'),
        ],
      },
    },
  });
  await seed();
  const res = await runBuild(["--silence-ms", "5000", "--progress-ms", "300"]);
  expect(res.stdout).toContain("merging after 1 pass");
  // Many progress ticks passed in 2.5 s, but only the first had a new call to judge.
  expect(launched("classifier")).toHaveLength(1);
  expect(transcriptOf(0)).toContain("not looping: one call so far");
});

function failingPs(): string {
  const dir = mkdtempSync(join(tmpdir(), "werk-ps-"));
  const ps = join(dir, "ps");
  writeFileSync(
    ps,
    '#!/bin/sh\necho "ps: cannot read the process table" >&2\nexit 1\n',
  );
  chmodSync(ps, 0o755);
  return dir;
}

test("37.5 a failed process probe cancels nothing and the pass ends when the tool call returns", async () => {
  extraEnv = { PATH: `${failingPs()}:${process.env.PATH}` };
  project.install(
    withJudges([[toolCall, { pause: 2000 }, edit("ok.txt", "done")]]),
  );
  await seed();
  const res = await runBuild([
    "--silence-ms",
    "5000",
    "--flat-ms",
    "200",
    "--progress-ms",
    "100000",
  ]);
  const log = transcriptOf(0);
  expect(log).toContain('"act":"probe-failed"');
  expect(log).toContain("ps ended with code 1");
  expect(log).not.toContain('"act":"frozen"');
  expect(res.stdout).toContain("merging after 1 pass");
  expect(passes()[0]?.result).toBe("green");
});

test("37.5 with a failed probe the pass ends at the wall-clock limit when the call never returns", async () => {
  extraEnv = { PATH: `${failingPs()}:${process.env.PATH}` };
  project.install(withJudges([[toolCall, { pause: 30_000 }]]));
  await seed();
  const res = await runBuild([
    "--silence-ms",
    "5000",
    "--flat-ms",
    "200",
    "--progress-ms",
    "100000",
    "--agent-ms",
    "1500",
    "--cap",
    "1",
  ]);
  const log = transcriptOf(0);
  expect(log).toContain('"act":"probe-failed"');
  expect(log).not.toContain('"act":"frozen"');
  expect(passes()[0]?.reason).toContain("time limit");
  expect(res.stdout).toContain("ready after 1 pass");
});
