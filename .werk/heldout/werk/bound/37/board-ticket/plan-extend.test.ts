import { afterEach, beforeEach, expect, test } from "bun:test";
import { appendFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readBoard } from "../../src/board/log-store.ts";
import { runCiteWatch } from "../../src/board/cite-watch.ts";
import type { Script, Step } from "../../src/fake-agent/script.ts";
import { decided } from "../../src/map/mark-fixtures.ts";
import { createProject, type Project } from "../../src/test-env/project.ts";
import { ticket } from "../../src/tickets/fixtures.ts";
import { CLI } from "./support.ts";

let project: Project;
beforeEach(() => {
  project = createProject();
});
afterEach(() => project.dispose());

const werk = (...args: string[]) => project.run(["bun", CLI, ...args]);
const store = () => join(project.dir, ".werk");
const board = () => readBoard(join(store(), "board.jsonl"));
const appendMap = (...events: unknown[]) =>
  appendFileSync(project.logPath, events.flat().map((e) => `${JSON.stringify(e)}\n`).join(""));
const appendBoard = (...events: unknown[]) =>
  appendFileSync(join(store(), "board.jsonl"), events.map((e) => `${JSON.stringify(e)}\n`).join(""));
const child = (id: string) => [
  ...decided(id),
  { type: "edge.added", from: id, to: "app", link: "refines" },
];

const RESULT: Step = {
  event: { type: "result", subtype: "success", is_error: false, duration_ms: 5, total_cost_usd: 0.1, usage: { input_tokens: 1, output_tokens: 1 } },
};
const edit = (path: string, content: string): Step => ({ edit: path, content });
const spec = (n: number) =>
  `## Problem\n\nP.\n\n## User stories\n\n${Array.from({ length: n }, (_, i) => `${i + 1}. As a person, I want thing ${i + 1}.`).join("\n")}\n`;
const specSteps = (n: number): Step[] => [
  edit("specs/app/spec.md", spec(n)),
  edit("specs/app/spec-answers.json", "[]"),
  RESULT,
];
const tickets = (files: [string, string][], ...more: Step[]): Step[] => [
  ...files.map(([n, t]) => edit(`tickets/app/${n}`, t)),
  edit("specs/app/ticket-answers.json", "[]"),
  ...more,
  RESULT,
];
const t = (title: string, cites: string, stories = "1", what?: string) =>
  ticket({ title, cites, stories, ...(what ? { what } : {}) });

function install(specReplies: Step[][], ticketReplies: Step[][]) {
  const script: Script = {
    roles: {
      "spec-writer": { replies: specReplies },
      "ticket-writer": { replies: ticketReplies },
    },
  };
  project.install(script);
}
const FIRST: [string, string][] = [
  ["01-a.md", t("Ticket one", "app, one")],
  ["02-b.md", t("Ticket two", "two")],
  ["03-c.md", t("Ticket three", "app")],
];

test("29.1 a second plan extends the spec and continues the ticket numbers", async () => {
  appendMap(decided("app"), child("one"), child("two"));
  const rewrite = t("Ticket three, rewritten", "app");
  install(
    [specSteps(1), specSteps(2)],
    [
      tickets(FIRST),
      tickets(
        [
          ["03-c.md", rewrite],
          ["04-d.md", t("Ticket four", "three", "2")],
        ],
      ),
    ],
  );
  const p1 = await werk("plan", "app");
  expect(p1.stderr).toBe("");
  expect(p1.code).toBe(0);
  expect([...board().tickets.values()].map((x) => x.column)).toEqual(["ready", "ready", "ready"]);
  appendBoard(
    { type: "ticket.moved", id: "app/01", to: "building", actor: "you" },
    { type: "ticket.moved", id: "app/02", to: "building", actor: "you" },
    { type: "ticket.moved", id: "app/02", to: "merging", actor: "loop" },
    { type: "ticket.merge", id: "app/02" },
  );
  const oneBefore = readFileSync(join(store(), "tickets/app/01-a.md"), "utf8");
  const twoBefore = readFileSync(join(store(), "tickets/app/02-b.md"), "utf8");
  appendMap(child("three"));
  const p2 = await werk("plan", "app");
  expect(p2.stderr).toBe("");
  expect(p2.code).toBe(0);
  const b = board();
  expect(readdirSync(join(store(), "specs"))).toEqual(["app"]);
  expect(readFileSync(join(store(), "specs/app/spec.md"), "utf8")).toBe(spec(2));
  expect(b.tickets.get("app/03")?.title).toBe("Ticket three, rewritten");
  expect(b.tickets.get("app/04")?.title).toBe("Ticket four");
  expect(b.plans.get("app")?.tickets).toEqual(["app/01", "app/02", "app/03", "app/04"]);
  expect(b.tickets.get("app/01")?.column).toBe("building");
  expect(b.tickets.get("app/02")?.column).toBe("done");
  expect(b.tickets.get("app/01")?.title).toBe("Ticket one");
  expect(readFileSync(join(store(), "tickets/app/01-a.md"), "utf8")).toBe(oneBefore);
  expect(readFileSync(join(store(), "tickets/app/02-b.md"), "utf8")).toBe(twoBefore);
});

test("29.2 an open ticket the new spec no longer needs is archived and can be restored", async () => {
  appendMap(decided("app"), child("one"), child("two"));
  const reason = "the current spec no longer needs it";
  install(
    [specSteps(1), specSteps(1)],
    [
      tickets(FIRST.slice(0, 2)),
      tickets([], edit("specs/app/ticket-drops.json", JSON.stringify([{ ticket: 2, why: reason }]))),
    ],
  );
  expect((await werk("plan", "app")).code).toBe(0);
  expect(board().tickets.get("app/02")?.column).toBe("ready");
  const rm = await werk("remove", "two", "--actor", "you");
  expect(rm.code).toBe(0);
  const p2 = await werk("plan", "app");
  expect(p2.stderr).toBe("");
  const archived = board().tickets.get("app/02");
  expect(archived?.archived).toBe(true);
  expect(archived?.archive?.reason).toBe(reason);
  const restore = await werk("ticket", "restore", "02", "--actor", "you");
  expect(restore.code).toBe(0);
  const back = board().tickets.get("app/02");
  expect(back?.archived).toBe(false);
  expect(back?.id).toBe("app/02");
});

const retitle = async (id: string, title: string) => {
  expect((await werk("propose", id, "--title", title)).code).toBe(0);
  expect((await werk("accept", id, "--actor", "you")).code).toBe(0);
};

test("29.3 retitling a cited card blocks the ready ticket, and a re-plan clears the block", async () => {
  appendMap(decided("app"), child("one"));
  install(
    [specSteps(1), specSteps(1)],
    [
      tickets([["01-a.md", t("Ticket one", "app, one")]]),
      tickets([["01-a.md", t("Ticket one", "app, one", "1", "Build it for the card called Shiny New Title.")]]),
    ],
  );
  expect((await werk("plan", "app")).code).toBe(0);
  expect(board().tickets.get("app/01")?.column).toBe("ready");
  await retitle("one", "Shiny New Title");
  runCiteWatch(project.logPath);
  let tk = board().tickets.get("app/01");
  expect(tk?.column).toBe("blocked");
  expect(tk?.reason).toContain("#one");
  expect(tk?.reason).toContain("title changed");
  const p2 = await werk("plan", "app");
  expect(p2.stderr).toBe("");
  tk = board().tickets.get("app/01");
  expect(tk?.column).toBe("ready");
  expect(tk?.reason).toBe("");
  expect(readFileSync(join(store(), "tickets/app/01-a.md"), "utf8")).toContain("Shiny New Title");
});

test("29.4 a note blocks nothing, a body change blocks only the ready ticket", async () => {
  appendMap(decided("app"), child("one"));
  install(
    [specSteps(1)],
    [tickets([["01-a.md", t("Ticket one", "app, one")], ["02-b.md", t("Ticket two", "app, one")]])],
  );
  expect((await werk("plan", "app")).code).toBe(0);
  appendBoard({ type: "ticket.moved", id: "app/02", to: "building", actor: "you" });
  expect((await werk("say", "one", "a thought")).code).toBe(0);
  runCiteWatch(project.logPath);
  let b = board();
  expect(b.tickets.get("app/01")?.column).toBe("ready");
  expect(b.tickets.get("app/02")?.column).toBe("building");
  expect(b.tickets.get("app/01")?.reason).toBe("");
  expect(b.tickets.get("app/02")?.reason).toBe("");
  const ops = JSON.stringify([{ tag: "new", new: "A fresh body line." }]);
  expect((await werk("propose", "one", "--ops", ops)).code).toBe(0);
  expect((await werk("accept", "one", "--actor", "you")).code).toBe(0);
  runCiteWatch(project.logPath);
  b = board();
  expect(b.tickets.get("app/01")?.column).toBe("blocked");
  expect(b.tickets.get("app/01")?.reason).toContain("#one");
  expect(b.tickets.get("app/01")?.reason).toContain("body changed");
  expect(b.tickets.get("app/02")?.column).toBe("building");
  expect(b.tickets.get("app/02")?.reason).toBe("");
});

test("29.5 a card added under a planned subtree reports a failed check without blocking tickets", async () => {
  appendMap(decided("app"), child("one"));
  install([specSteps(1)], [tickets([["01-a.md", t("Ticket one", "app, one")]])]);
  expect((await werk("plan", "app")).code).toBe(0);
  appendMap(child("late"));
  runCiteWatch(project.logPath);
  const b = board();
  expect(b.plans.get("app")?.uncited).toEqual(["late"]);
  expect(b.tickets.get("app/01")?.column).toBe("ready");
  expect(b.tickets.get("app/01")?.reason).toBe("");
  void existsSync;
  void writeFileSync;
});
