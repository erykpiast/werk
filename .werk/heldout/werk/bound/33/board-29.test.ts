import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  appendFileSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { readBoard } from "../src/board/log-store.ts";
import type { Step } from "../src/fake-agent/script.ts";
import { decided } from "../src/map/mark-fixtures.ts";
import { createProject, type Project } from "../src/test-env/project.ts";
import { ticket } from "../src/tickets/fixtures.ts";

const CLI = join(import.meta.dir, "..", "src", "cli.ts");
let project: Project;
beforeEach(() => {
  project = createProject();
});
afterEach(() => project.dispose());
const werk = (...args: string[]) => project.run(["bun", CLI, ...args]);
const mapAppend = (...events: unknown[]) =>
  appendFileSync(
    project.logPath,
    `${events
      .flat()
      .map((e) => JSON.stringify(e))
      .join("\n")}\n`,
  );
const boardLog = () => join(project.dir, ".werk", "board.jsonl");
const board = () => readBoard(boardLog());
const boardAppend = (...events: unknown[]) =>
  appendFileSync(
    boardLog(),
    events.map((e) => `${JSON.stringify(e)}\n`).join(""),
  );

const RESULT: Step = {
  event: {
    type: "result",
    subtype: "success",
    is_error: false,
    duration_ms: 5,
    total_cost_usd: 0.1,
    usage: { input_tokens: 1, output_tokens: 1 },
  },
};
const edit = (path: string, content: string): Step => ({ edit: path, content });
const spec = (n: number) =>
  `## Problem\n\nP.\n\n## User stories\n\n${Array.from({ length: n }, (_, i) => `${i + 1}. As a person, I want ${i + 1}.`).join("\n")}\n`;
const specSteps = (n: number): Step[] => [
  edit("specs/app/spec.md", spec(n)),
  edit("specs/app/spec-answers.json", "[]"),
  RESULT,
];
const ticketSteps = (files: [string, string][], drops?: unknown): Step[] => [
  ...files.map(([n, t]) => edit(`tickets/app/${n}`, t)),
  ...(drops === undefined
    ? []
    : [edit("specs/app/ticket-drops.json", JSON.stringify(drops))]),
  edit("specs/app/ticket-answers.json", "[]"),
  RESULT,
];
const t = (title: string, cites: string, stories = "1") =>
  ticket({ title, cites, stories });
const child = (id: string) => [
  ...decided(id),
  { type: "edge.added", from: id, to: "app", link: "refines" },
];
const planTwice = (
  first: { spec: Step[]; tickets: Step[] },
  second: { spec: Step[]; tickets: Step[] },
) =>
  project.install({
    roles: {
      "spec-writer": { replies: [first.spec, second.spec] },
      "ticket-writer": { replies: [first.tickets, second.tickets] },
    },
  });

test("29.1 a second plan extends the spec and continues the ticket numbers", async () => {
  mapAppend(decided("app"));
  planTwice(
    {
      spec: specSteps(1),
      tickets: ticketSteps([
        ["01-a.md", t("Ticket 1", "app")],
        ["02-b.md", t("Ticket 2", "app")],
        ["03-c.md", t("Ticket 3", "app")],
      ]),
    },
    {
      spec: specSteps(2),
      tickets: ticketSteps([
        ["03-c.md", t("Ticket 3 rewritten", "app, late")],
        ["04-d.md", t("Ticket 4", "late", "2")],
      ]),
    },
  );
  expect((await werk("plan", "app")).code).toBe(0);
  boardAppend(
    { type: "ticket.moved", id: "app/01", to: "building", actor: "you" },
    { type: "ticket.moved", id: "app/02", to: "building", actor: "you" },
    { type: "ticket.moved", id: "app/02", to: "merging", actor: "loop" },
    { type: "ticket.merge", id: "app/02" },
  );
  mapAppend(child("late"));
  const again = await werk("plan", "app");
  expect(again.stderr).toBe("");
  expect(again.code).toBe(0);
  const b = board();
  expect(b.plans.size).toBe(1);
  expect(readFileSync(join(project.dir, ".werk/specs/app/spec.md"), "utf8")).toBe(
    spec(2),
  );
  expect(b.tickets.get("app/03")).toMatchObject({
    title: "Ticket 3 rewritten",
    column: "ready",
  });
  expect(b.tickets.get("app/04")).toMatchObject({ column: "ready" });
  expect([...b.tickets.keys()].sort()).toEqual([
    "app/01",
    "app/02",
    "app/03",
    "app/04",
  ]);
  expect(b.tickets.get("app/01")).toMatchObject({
    title: "Ticket 1",
    column: "building",
  });
  expect(b.tickets.get("app/02")).toMatchObject({
    title: "Ticket 2",
    column: "done",
  });
});

test("29.2 an open ticket the new spec drops is archived and can be restored", async () => {
  mapAppend(decided("app"), child("one"));
  planTwice(
    {
      spec: specSteps(2),
      tickets: ticketSteps([
        ["01-a.md", t("Ticket 1", "app")],
        ["02-b.md", t("Ticket 2", "one", "2")],
      ]),
    },
    {
      spec: specSteps(1),
      tickets: ticketSteps([], [
        { ticket: 2, why: "the current spec no longer needs it" },
      ]),
    },
  );
  expect((await werk("plan", "app")).code).toBe(0);
  expect(board().tickets.get("app/02")?.column).toBe("ready");
  const removed = await werk("remove", "one", "--actor", "you");
  expect(removed.code).toBe(0);
  const again = await werk("plan", "app");
  expect(again.stderr).toBe("");
  expect(again.code).toBe(0);
  const gone = board().tickets.get("app/02");
  expect(gone?.archived).toBe(true);
  expect(gone?.archive?.reason).toContain("no longer needs it");
  const r = await werk("ticket", "restore", "02", "--actor", "you");
  expect(r.code).toBe(0);
  expect(board().tickets.get("app/02")).toMatchObject({
    archived: false,
    column: "ready",
  });
});

async function untilBoard(
  ok: () => boolean,
  ms = 15000,
): Promise<void> {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error("timed out waiting for the board");
    await Bun.sleep(100);
  }
}

/** Starts the werk server so its cited-card watcher runs. */
async function serve() {
  const port = 20000 + Math.floor(Math.random() * 20000);
  project.start(["bun", CLI, "serve", "--port", String(port)]);
  await untilBoard(() => existsSync(join(project.dir, ".werk", "serve.lock")));
  await Bun.sleep(500);
}

test("29.3 retitling a cited card blocks the ready ticket, and a re-plan clears the block", async () => {
  mapAppend(decided("app"));
  planTwice(
    {
      spec: specSteps(1),
      tickets: ticketSteps([["01-a.md", t("Ticket 1", "app")]]),
    },
    {
      spec: specSteps(1),
      tickets: ticketSteps([["01-a.md", t("Ticket 1 new", "app")]]),
    },
  );
  expect((await werk("plan", "app")).code).toBe(0);
  await serve();
  expect((await werk("propose", "app", "--title", "Brand new title")).code).toBe(0);
  expect((await werk("accept", "app", "--actor", "you")).code).toBe(0);
  await untilBoard(() => board().tickets.get("app/01")?.column === "blocked");
  const reason = board().tickets.get("app/01")?.reason ?? "";
  expect(reason).toContain("app");
  expect(reason).toContain("title changed");
  const again = await werk("plan", "app");
  expect(again.stderr).toBe("");
  const b = board().tickets.get("app/01");
  expect(b?.column).toBe("ready");
  expect(b?.reason).toBe("");
  expect(
    readFileSync(join(project.dir, ".werk/tickets/app/01-a.md"), "utf8"),
  ).toContain("cites: app");
});

test("29.4 a note blocks nothing, a body change blocks the ready ticket but not the building one", async () => {
  mapAppend(decided("app"));
  planTwice(
    {
      spec: specSteps(1),
      tickets: ticketSteps([
        ["01-a.md", t("Ticket 1", "app")],
        ["02-b.md", t("Ticket 2", "app")],
      ]),
    },
    { spec: [], tickets: [] },
  );
  expect((await werk("plan", "app")).code).toBe(0);
  boardAppend({
    type: "ticket.moved",
    id: "app/02",
    to: "building",
    actor: "you",
  });
  await serve();
  mapAppend({ type: "note.added", id: "app", text: "a thought", who: "you" });
  await Bun.sleep(1500);
  for (const id of ["app/01", "app/02"]) {
    expect(board().tickets.get(id)?.reason).toBe("");
  }
  expect(board().tickets.get("app/01")?.column).toBe("ready");
  const p = await werk(
    "propose",
    "app",
    "--ops",
    JSON.stringify([{ tag: "new", new: "More body words." }]),
  );
  expect(p.code).toBe(0);
  expect((await werk("accept", "app", "--actor", "you")).code).toBe(0);
  await untilBoard(() => board().tickets.get("app/01")?.column === "blocked");
  const reason = board().tickets.get("app/01")?.reason ?? "";
  expect(reason).toContain("app");
  expect(reason).toContain("body changed");
  expect(board().tickets.get("app/02")?.column).toBe("building");
  expect(board().tickets.get("app/02")?.reason).toBe("");
});

test("29.5 a card added under a planned subtree reports a failed cards-cited check", async () => {
  mapAppend(decided("app"));
  planTwice(
    {
      spec: specSteps(1),
      tickets: ticketSteps([["01-a.md", t("Ticket 1", "app")]]),
    },
    { spec: [], tickets: [] },
  );
  expect((await werk("plan", "app")).code).toBe(0);
  await serve();
  mapAppend(child("late"));
  await untilBoard(() => (board().plans.get("app")?.uncited ?? []).length > 0);
  expect(board().plans.get("app")?.uncited).toEqual(["late"]);
  expect(board().tickets.get("app/01")).toMatchObject({
    column: "ready",
    reason: "",
  });
  const shown = readFileSync(boardLog(), "utf8");
  expect(shown).toContain("late");
});
