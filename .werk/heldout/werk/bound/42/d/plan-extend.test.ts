import { afterEach, beforeEach, expect, test } from "bun:test";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readBoard } from "../../src/board/log-store.ts";
import type { Script, Step } from "../../src/fake-agent/script.ts";
import { decided } from "../../src/map/mark-fixtures.ts";
import { ticket } from "../../src/tickets/fixtures.ts";
import { CLI, createProject, type Project } from "./h.ts";

let project: Project;
beforeEach(() => {
  project = createProject();
});
afterEach(() => project.dispose());

const werk = (...args: string[]) => project.run(["bun", CLI, ...args]);
const boardLog = () => join(project.dir, ".werk", "board.jsonl");
const board = () => readBoard(boardLog());
const mapLog = (events: unknown[]) =>
  appendFileSync(project.logPath, events.flat().map((e) => `${JSON.stringify(e)}\n`).join(""));
const boardAppend = (...events: unknown[]) =>
  appendFileSync(boardLog(), events.map((e) => `${JSON.stringify(e)}\n`).join(""));
const file = (name: string) => readFileSync(join(project.dir, ".werk", name), "utf8");

const RESULT: Step = {
  event: { type: "result", subtype: "success", is_error: false, duration_ms: 5, total_cost_usd: 0.1, usage: { input_tokens: 1, output_tokens: 1 } },
};
const edit = (path: string, content: string): Step => ({ edit: path, content });
const SPEC1 = "## Problem\n\nP.\n\n## User stories\n\n1. As a person, I want it.\n";
const SPEC2 = `${SPEC1}2. As a person, I want the new card.\n`;
const specSteps = (spec: string): Step[] => [
  edit("specs/app/spec.md", spec),
  edit("specs/app/spec-answers.json", "[]"),
  RESULT,
];
const tk = (n: number, extra: Record<string, string> = {}) =>
  ticket({ title: `Ticket ${n}`, cites: "app", stories: "1", ...extra });
const tickets = (...files: [string, string][]): Step[] => [
  ...files.map(([n, t]) => edit(`tickets/app/${n}`, t)),
  edit("specs/app/ticket-answers.json", "[]"),
  RESULT,
];

function install(second: { spec?: string; tickets: Step[] }, firstCount = 3) {
  const names = ["01-a.md", "02-b.md", "03-c.md", "04-d.md"];
  const firstFiles: [string, string][] = names.slice(0, firstCount).map((n, i) => [n, tk(i + 1)]);
  const script: Script = {
    roles: {
      "spec-writer": { replies: [specSteps(SPEC1), specSteps(second.spec ?? SPEC1)] },
      "ticket-writer": { replies: [tickets(...firstFiles), second.tickets] },
    },
  };
  project.install(script);
}

async function firstPlan() {
  mapLog([decided("app")]);
  const r = await werk("plan", "app");
  expect(r.stderr).toBe("");
  expect(r.code).toBe(0);
}

test("29.1 second plan extends the spec, continues numbers, leaves started tickets", async () => {
  install({
    spec: SPEC2,
    tickets: tickets(["03-c.md", tk(3, { title: "Ticket 3 rewritten" })], ["04-d.md", tk(4, { stories: "2", cites: "app, newcard" })]),
  });
  await firstPlan();
  boardAppend(
    { type: "ticket.moved", id: "app/01", to: "building", actor: "you" },
    { type: "ticket.moved", id: "app/02", to: "building", actor: "you" },
    { type: "ticket.moved", id: "app/02", to: "merging", actor: "loop" },
    { type: "ticket.merge", id: "app/02" },
  );
  mapLog([decided("newcard", { parent: "app" })]);
  const again = await werk("plan", "app");
  expect(again.stderr).toBe("");
  expect(again.code).toBe(0);
  const b = board();
  expect([...b.plans.keys()]).toEqual(["app"]);
  expect(file("specs/app/spec.md")).toBe(SPEC2);
  expect(b.tickets.get("app/03")).toMatchObject({ title: "Ticket 3 rewritten", column: "ready" });
  expect(b.tickets.get("app/04")?.column).toBe("ready");
  expect([...b.tickets.keys()].sort()).toEqual(["app/01", "app/02", "app/03", "app/04"]);
  expect(b.tickets.get("app/01")).toMatchObject({ column: "building", title: "Ticket 1" });
  expect(b.tickets.get("app/02")).toMatchObject({ column: "done", title: "Ticket 2" });
});

test("29.2 a ticket the new spec drops is archived with reason and restores", async () => {
  install({
    tickets: [
      edit("specs/app/ticket-drops.json", JSON.stringify([{ ticket: 3, why: "the current spec no longer needs it" }])),
      edit("specs/app/ticket-answers.json", "[]"),
      RESULT,
    ],
  });
  await firstPlan();
  const again = await werk("plan", "app");
  expect(again.stderr).toBe("");
  const t3 = board().tickets.get("app/03");
  expect(t3?.archived).toBe(true);
  expect(t3?.archive?.reason).toContain("no longer needs");
  const r = await werk("ticket", "restore", "3", "--actor", "you");
  console.log("29.2 restore", JSON.stringify(r));
  expect(r.code).toBe(0);
  expect(board().tickets.get("app/03")).toMatchObject({ archived: false, column: "ready" });
});

async function until<T>(read: () => T | undefined, ms = 15000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = read();
    if (v !== undefined) return v;
    if (Date.now() > end) throw new Error("timed out");
    await Bun.sleep(100);
  }
}
const serve = () => project.start(["bun", CLI, "serve", "--port", "0"]);

test("29.3 retitling a cited card blocks the ready ticket; a re-plan clears it", async () => {
  install({
    tickets: [edit("tickets/app/01-a.md", tk(1, { what: "Build it for the card New title for app." })), edit("specs/app/ticket-answers.json", "[]"), RESULT],
  });
  await firstPlan();
  serve();
  await Bun.sleep(1000);
  expect((await werk("propose", "app", "--title", "New title for app")).code).toBe(0);
  const acc = await werk("accept", "app", "--actor", "you");
  expect(acc.code).toBe(0);
  const t1 = await until(() => (board().tickets.get("app/01")?.column === "blocked" ? board().tickets.get("app/01") : undefined)).catch(() => board().tickets.get("app/01"));
  console.log("29.3", JSON.stringify(t1?.reason), t1?.column);
  expect(t1?.column).toBe("blocked");
  expect(t1?.reason).toContain("app");
  expect(t1?.reason).toContain("title changed");
  const again = await werk("plan", "app");
  expect(again.code).toBe(0);
  const after = board().tickets.get("app/01");
  expect(after?.column).toBe("ready");
  expect(after?.reason).toBe("");
  expect(file("tickets/app/01-a.md")).toContain("New title for app");
});

test("29.4 a note blocks nothing; a body change blocks the ready ticket only", async () => {
  install({ tickets: tickets() }, 2);
  await firstPlan();
  boardAppend({ type: "ticket.moved", id: "app/02", to: "building", actor: "you" });
  serve();
  await Bun.sleep(1000);
  expect((await werk("say", "app", "a thought")).code).toBe(0);
  await Bun.sleep(2500);
  expect(board().tickets.get("app/01")).toMatchObject({ column: "ready", reason: "" });
  expect(board().tickets.get("app/02")).toMatchObject({ column: "building", reason: "" });
  const p = await werk("propose", "app", "--ops", JSON.stringify([{ tag: "new", new: "A new sentence in the body." }]));
  console.log("29.4 propose", JSON.stringify(p));
  expect((await werk("accept", "app", "--actor", "you")).code).toBe(0);
  await until(() => (board().tickets.get("app/01")?.column === "blocked" ? true : undefined)).catch(() => {});
  const b = board();
  console.log("29.4", JSON.stringify(b.tickets.get("app/01")?.reason));
  expect(b.tickets.get("app/01")?.column).toBe("blocked");
  expect(b.tickets.get("app/01")?.reason).toContain("app");
  expect(b.tickets.get("app/01")?.reason).toContain("body changed");
  expect(b.tickets.get("app/02")).toMatchObject({ column: "building", reason: "" });
});

test("29.5 a new uncited card fails the cards-cited check and blocks no ticket", async () => {
  install({ tickets: tickets() });
  await firstPlan();
  serve();
  await Bun.sleep(1000);
  mapLog([decided("brandnew", { parent: "app" })]);
  const uncited = await until(() => (board().plans.get("app")?.uncited.length ? board().plans.get("app")?.uncited : undefined)).catch(() => []);
  console.log("29.5", JSON.stringify(uncited));
  expect(uncited).toContain("brandnew");
  for (const t of board().tickets.values()) expect(t).toMatchObject({ column: "ready", reason: "" });
});
