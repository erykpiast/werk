import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  appendFileSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { readBoard } from "../board/log-store.ts";
import type { Script, Step } from "../fake-agent/script.ts";
import { decided, link, open } from "../map/mark-fixtures.ts";
import { createProject, type Project } from "../test-env/project.ts";
import { ticket } from "../tickets/fixtures.ts";

const CLI = join(import.meta.dir, "..", "cli.ts");
let project: Project;
beforeEach(() => {
  project = createProject();
});
afterEach(() => project.dispose());

const werk = (...args: string[]) => project.run(["bun", CLI, ...args]);
const seed = (events: unknown[]) =>
  writeFileSync(
    project.logPath,
    `${events.map((e) => JSON.stringify(e)).join("\n")}\n`,
  );
const readLines = (name: string) =>
  readFileSync(join(project.dir, ".werk", name), "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line));
const board = () => readBoard(join(project.dir, ".werk", "board.jsonl"));

const RESULT: Step = {
  event: {
    type: "result",
    subtype: "success",
    is_error: false,
    duration_ms: 5,
    total_cost_usd: 0.25,
    usage: { input_tokens: 10, output_tokens: 20 },
  },
};
const edit = (path: string, content: string): Step => ({ edit: path, content });
const SPEC =
  "## Problem\n\nP.\n\n## User stories\n\n1. As a person, I want it.\n";
const ANSWER = [
  {
    slug: "seam",
    title: "Tests use one seam",
    why: "Which seam?",
    body: "The CLI.",
  },
];

function script(specWriter: Step[], ticketWriter: Step[]): Script {
  return {
    roles: {
      "spec-writer": { replies: [specWriter] },
      "ticket-writer": { replies: [ticketWriter] },
    },
  };
}

const goodSpec = (): Step[] => [
  edit("specs/app/spec.md", SPEC),
  edit("specs/app/spec-answers.json", JSON.stringify(ANSWER)),
  RESULT,
];
const tickets = (...files: [string, string][]): Step[] => [
  ...files.map(([name, text]) => edit(`tickets/app/${name}`, text)),
  edit("specs/app/ticket-answers.json", "[]"),
  RESULT,
];
const good = ticket({ cites: "app", stories: "1" });

test("a plan writes the spec and tickets to the store, plans each valid ticket and proposes the answers", async () => {
  seed(decided("app"));
  project.install(script(goodSpec(), tickets(["01-a.md", good])));
  const result = await werk("plan", "app");
  expect(result.stderr).toBe("");
  expect(result.code).toBe(0);
  expect(existsSync(join(project.dir, ".werk/specs/app/spec.md"))).toBe(true);
  expect(existsSync(join(project.dir, ".werk/tickets/app/01-a.md"))).toBe(true);
  expect(board().tickets.get("app/01")?.column).toBe("ready");
  const answer = (await werk("show", "app-seam")).stdout;
  expect(answer).toContain("proposed");
  expect(answer).toContain("refines");
});

test("the writers launch on Opus with their own roles, and the plan lands in both logs", async () => {
  seed(decided("app"));
  project.install(script(goodSpec(), tickets(["01-a.md", good])));
  await werk("plan", "app");
  const launches = project
    .launches()
    .flatMap((r) => (r.kind === "launch" ? [r] : []));
  expect(launches.map((l) => l.role)).toEqual(["spec-writer", "ticket-writer"]);
  for (const launch of launches) {
    expect(launch.args[launch.args.indexOf("--model") + 1]).toBe(
      "claude-opus-5-5",
    );
    expect(launch.cwd).toContain(".werk");
  }
  const types = readLines("board.jsonl").map((e) => e.type);
  expect(types.filter((t) => t === "plan.started")).toHaveLength(1);
  expect(types.filter((t) => t === "plan.step")).toHaveLength(2);
  expect(types.at(-1)).toBe("plan.ended");
  const ended = readLines("board.jsonl").find((e) => e.type === "plan.ended");
  expect(ended.result).toBe("ok");
  const steps = readLines("pipeline.jsonl");
  for (const step of ["spec", "tickets"]) {
    const started = steps.find(
      (e) => e.step === step && e.type === "step.started",
    );
    const ended = steps.find((e) => e.step === step && e.type === "step.ended");
    expect(started).toBeDefined();
    expect(ended.cost.usd).toBe(0.25);
    expect(existsSync(join(project.dir, ".werk", ended.file))).toBe(true);
  }
  const planStart = steps.find(
    (e) => e.step === "plan" && e.type === "step.started",
  );
  expect(planStart.scope).toEqual([
    { id: "app", tier: 1, at: expect.any(Number) },
  ]);
});

test("a plan over a first tier that holds an open card stops before any agent starts", async () => {
  seed([...decided("app"), ...open("draft"), link("app", "draft")]);
  project.install(script(goodSpec(), tickets(["01-a.md", good])));
  const result = await werk("plan", "app");
  expect(result.code).toBe(1);
  expect(result.stderr).toContain("#draft");
  expect(project.launches()).toEqual([]);
  const ended = readLines("board.jsonl").find((e) => e.type === "plan.ended");
  expect(ended.result).toBe("stopped");
});

test("a ticket with a file path is not planned and the plan exits 1", async () => {
  seed(decided("app"));
  const bad = ticket({ cites: "app", stories: "1", what: "Edit src/loop.ts." });
  project.install(script(goodSpec(), tickets(["01-a.md", bad])));
  const result = await werk("plan", "app");
  expect(result.code).toBe(1);
  expect(result.stdout).toContain("no-file-paths");
  expect(board().tickets.size).toBe(0);
});

test("a failed set check puts the ticket it names in blocked, and the plan exits 1", async () => {
  seed(decided("app"));
  const second = ticket({ cites: "app", stories: "1", blockedBy: "9" });
  project.install(
    script(goodSpec(), tickets(["01-a.md", good], ["02-b.md", second])),
  );
  const result = await werk("plan", "app");
  expect(result.code).toBe(1);
  expect(board().tickets.get("app/01")?.column).toBe("ready");
  const blocked = board().tickets.get("app/02");
  expect(blocked?.column).toBe("blocked");
  expect(blocked?.reason).toContain("blocker 9 is not in the set");
});

test("an answers file that is missing stops the plan before the next writer", async () => {
  seed(decided("app"));
  project.install(
    script(
      [edit("specs/app/spec.md", SPEC), RESULT],
      tickets(["01-a.md", good]),
    ),
  );
  const result = await werk("plan", "app");
  expect(result.code).toBe(1);
  expect(result.stderr).toContain("wrote no answers file");
  expect(project.launches().filter((r) => r.kind === "launch")).toHaveLength(1);
});

test("an answer whose card id is taken fails the plan", async () => {
  seed([...decided("app"), ...open("app-seam")]);
  project.install(script(goodSpec(), tickets(["01-a.md", good])));
  const result = await werk("plan", "app");
  expect(result.code).toBe(1);
  expect(result.stderr).toContain("cannot be proposed");
});

test("a spec with no numbered story is invalid", async () => {
  seed(decided("app"));
  project.install(
    script([edit("specs/app/spec.md", "## User stories\n"), RESULT], []),
  );
  const result = await werk("plan", "app");
  expect(result.code).toBe(1);
  expect(result.stderr).toContain("the spec is invalid");
});

test("a writer that exits with an error fails the plan and ends its step red", async () => {
  seed(decided("app"));
  project.install({ roles: { "spec-writer": { replies: [[{ crash: 3 }]] } } });
  const result = await werk("plan", "app");
  expect(result.code).toBe(1);
  expect(result.stderr).toContain("spec-writer failed");
  const ended = readLines("pipeline.jsonl").find(
    (e) => e.step === "spec" && e.type === "step.ended",
  );
  expect(ended.result).toBe("red");
});

test("a writer that runs past the wall-clock limit is stopped", async () => {
  seed(decided("app"));
  project.install({
    roles: { "spec-writer": { replies: [[{ pause: 5000 }, RESULT]] } },
  });
  const result = await werk("plan", "app", "--timeout", "0.5");
  expect(result.code).toBe(1);
  expect(result.stderr).toContain("wall-clock limit");
});

test("a plan with no card, or a bad flag, is refused", async () => {
  expect((await werk("plan", "nothing")).code).toBe(1);
  expect((await werk("plan")).code).toBe(2);
  expect((await werk("plan", "a", "--timeout", "0")).code).toBe(2);
});

test("a plan after the old tickets are archived keeps their files and continues after the highest number", async () => {
  seed(decided("app"));
  project.install({
    roles: {
      "spec-writer": {
        replies: [
          goodSpec(),
          [
            edit("specs/app/spec.md", SPEC),
            edit("specs/app/spec-answers.json", "[]"),
            RESULT,
          ],
        ],
      },
      "ticket-writer": {
        replies: [tickets(["01-a.md", good]), tickets(["02-b.md", good])],
      },
    },
  });
  expect((await werk("plan", "app")).code).toBe(0);
  appendFileSync(
    join(project.dir, ".werk", "board.jsonl"),
    `${JSON.stringify({ type: "ticket.archived", id: "app/01" })}\n`,
  );
  const again = await werk("plan", "app");
  expect(again.stderr).toBe("");
  expect(again.code).toBe(0);
  expect(existsSync(join(project.dir, ".werk/tickets/app/01-a.md"))).toBe(true);
  expect(board().tickets.get("app/01")?.archived).toBe(true);
  expect(board().tickets.get("app/02")?.column).toBe("ready");
});

const SPEC_TWO =
  "## Problem\n\nP.\n\n## User stories\n\n1. As a person, I want it.\n2. As a person, I want more.\n";
const first = (n: number) =>
  ticket({ title: `Ticket ${n}`, cites: "app", stories: "1" });

/** A first plan with tickets 01, 02 and 03, then 01 built to done. The second plan is the script of the test. */
async function plannedTwice(second: {
  spec?: Step[];
  tickets: Step[];
}): Promise<{ code: number; stderr: string }> {
  seed(decided("app"));
  const answers = edit("specs/app/ticket-answers.json", "[]");
  project.install({
    roles: {
      "spec-writer": {
        replies: [
          goodSpec(),
          second.spec ?? [
            edit("specs/app/spec.md", SPEC_TWO),
            edit("specs/app/spec-answers.json", "[]"),
            RESULT,
          ],
        ],
      },
      "ticket-writer": {
        replies: [
          tickets(
            ["01-a.md", first(1)],
            ["02-b.md", first(2)],
            ["03-c.md", first(3)],
          ),
          [...second.tickets, answers, RESULT],
        ],
      },
    },
  });
  expect((await werk("plan", "app")).code).toBe(0);
  const boardLog = join(project.dir, ".werk", "board.jsonl");
  for (const event of [
    { type: "ticket.moved", id: "app/01", to: "building", actor: "you" },
    { type: "ticket.moved", id: "app/01", to: "merging", actor: "loop" },
    { type: "ticket.merge", id: "app/01" },
  ])
    appendFileSync(boardLog, `${JSON.stringify(event)}\n`);
  const again = await werk("plan", "app");
  return { code: again.code, stderr: again.stderr };
}

test("a second plan changes ticket 02 in place, adds ticket 04, archives a ticket the spec drops, and leaves a done ticket alone", async () => {
  const rewritten = ticket({
    title: "Ticket 2, changed",
    cites: "app",
    stories: "1",
  });
  const added = ticket({ title: "Ticket 4", cites: "app", stories: "2" });
  const result = await plannedTwice({
    tickets: [
      edit("tickets/app/02-b.md", rewritten),
      edit("tickets/app/04-d.md", added),
      edit(
        "specs/app/ticket-drops.json",
        JSON.stringify([{ ticket: 3, why: "the spec no longer needs it" }]),
      ),
    ],
  });
  expect(result.stderr).toBe("");
  expect(result.code).toBe(0);
  const b = board();
  expect(b.tickets.get("app/02")).toMatchObject({
    title: "Ticket 2, changed",
    column: "ready",
  });
  expect(b.tickets.get("app/04")).toMatchObject({
    title: "Ticket 4",
    column: "ready",
  });
  expect(b.tickets.get("app/03")).toMatchObject({
    archived: true,
    archive: { by: "plan", reason: "the spec no longer needs it" },
  });
  expect(b.tickets.get("app/01")).toMatchObject({
    title: "Ticket 1",
    column: "done",
  });
  expect(b.plans.get("app")?.tickets).toEqual([
    "app/01",
    "app/02",
    "app/03",
    "app/04",
  ]);
  expect(
    readFileSync(join(project.dir, ".werk/tickets/app/01-a.md"), "utf8"),
  ).toBe(first(1));
  expect(
    readFileSync(join(project.dir, ".werk/specs/app/spec.md"), "utf8"),
  ).toBe(SPEC_TWO);
});

test("a second plan puts no second ticket set on the board", async () => {
  await plannedTwice({ tickets: [] });
  expect([...board().tickets.keys()].sort()).toEqual([
    "app/01",
    "app/02",
    "app/03",
  ]);
});

test("a second plan records the cited versions again and clears the mark of a ticket it keeps", async () => {
  seed(decided("app"));
  project.install({
    roles: {
      "spec-writer": {
        replies: [
          goodSpec(),
          [
            edit("specs/app/spec.md", SPEC),
            edit("specs/app/spec-answers.json", "[]"),
            RESULT,
          ],
        ],
      },
      "ticket-writer": {
        replies: [
          tickets(["01-a.md", good]),
          [edit("specs/app/ticket-answers.json", "[]"), RESULT],
        ],
      },
    },
  });
  await werk("plan", "app");
  const boardLog = join(project.dir, ".werk", "board.jsonl");
  const mark = {
    type: "ticket.marked",
    id: "app/01",
    card: "app",
    kind: "reopened",
    version: 99,
  };
  appendFileSync(boardLog, `${JSON.stringify(mark)}\n`);
  expect(board().tickets.get("app/01")?.column).toBe("blocked");
  const again = await werk("plan", "app");
  expect(again.stderr).toBe("");
  expect(board().tickets.get("app/01")).toMatchObject({
    column: "ready",
    marks: [],
  });
});

test("a second plan restores the file of a ticket that is not open, and reports it", async () => {
  const result = await plannedTwice({
    tickets: [
      edit(
        "tickets/app/01-a.md",
        ticket({ title: "Tampered", cites: "app", stories: "1" }),
      ),
    ],
  });
  expect(result.code).toBe(1);
  expect(result.stderr).toContain("ticket 1 is not open");
  expect(
    readFileSync(join(project.dir, ".werk/tickets/app/01-a.md"), "utf8"),
  ).toBe(first(1));
  expect(board().tickets.get("app/01")?.title).toBe("Ticket 1");
});

test("a rewrite that fails its own checks is undone, and the ticket keeps its old words", async () => {
  const result = await plannedTwice({
    tickets: [
      edit(
        "tickets/app/02-b.md",
        ticket({
          title: "Bad",
          cites: "app",
          stories: "1",
          what: "Edit src/loop.ts.",
        }),
      ),
    ],
  });
  expect(result.code).toBe(1);
  expect(result.stderr).not.toBe("");
  expect(board().tickets.get("app/02")?.title).toBe("Ticket 2");
  expect(
    readFileSync(join(project.dir, ".werk/tickets/app/02-b.md"), "utf8"),
  ).toBe(first(2));
});

test("a drop of a ticket that is not open is ignored and archives nothing", async () => {
  const notOpen = await plannedTwice({
    tickets: [
      edit(
        "tickets/app/04-d.md",
        ticket({ title: "Ticket 4", cites: "app", stories: "2" }),
      ),
      edit(
        "specs/app/ticket-drops.json",
        JSON.stringify([{ ticket: 1, why: "x" }]),
      ),
    ],
  });
  expect(notOpen.stderr).toBe("");
  expect(notOpen.code).toBe(0);
  expect(notOpen.stderr).not.toContain("not open");
  expect(board().tickets.get("app/01")?.archived).toBe(false);
});

test("a bad drops file fails the plan", async () => {
  const result = await plannedTwice({
    tickets: [edit("specs/app/ticket-drops.json", "{")],
  });
  expect(result.code).toBe(1);
  expect(result.stderr).toContain("drops file is bad");
});
