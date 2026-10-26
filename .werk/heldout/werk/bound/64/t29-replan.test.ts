import { afterEach, beforeEach, expect, test } from "bun:test";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readBoard } from "../src/board/log-store.ts";
import type { Step } from "../src/fake-agent/script.ts";
import { decided } from "../src/map/mark-fixtures.ts";
import { ticket } from "../src/tickets/fixtures.ts";
import { boardPath, createProject, type Project, seed, startServer, until, werk } from "./h.ts";

let p: Project;
beforeEach(() => {
  p = createProject();
});
afterEach(() => p.dispose());

const RESULT: Step = {
  event: { type: "result", subtype: "success", is_error: false, duration_ms: 5, total_cost_usd: 0.25, usage: { input_tokens: 1, output_tokens: 1 } },
};
const edit = (path: string, content: string): Step => ({ edit: path, content });
const spec = (...stories: string[]) =>
  `## Problem\n\nP.\n\n## User stories\n\n${stories.map((s, i) => `${i + 1}. ${s}`).join("\n")}\n`;
const specReply = (text: string): Step[] => [edit("specs/app/spec.md", text), edit("specs/app/spec-answers.json", "[]"), RESULT];
const ticketsReply = (files: [string, string][], ...extra: Step[]): Step[] => [
  ...files.map(([n, t]) => edit(`tickets/app/${n}`, t)),
  ...extra,
  edit("specs/app/ticket-answers.json", "[]"),
  RESULT,
];
const board = () => readBoard(boardPath(p));
const addBoard = (...events: unknown[]) =>
  appendFileSync(boardPath(p), events.map((e) => `${JSON.stringify(e)}\n`).join(""));
const T = (n: number, cites: string, stories = "1", extra: Record<string, string> = {}) =>
  ticket({ title: `Ticket ${n}`, cites, stories, ...extra });

function install(first: { spec: string; tickets: [string, string][] }, second: { spec: string; tickets: [string, string][]; extra?: Step[] }) {
  p.install({
    roles: {
      "spec-writer": { replies: [specReply(first.spec), specReply(second.spec)] },
      "ticket-writer": { replies: [ticketsReply(first.tickets), ticketsReply(second.tickets, ...(second.extra ?? []))] },
    },
  });
}

test("29.1 a second plan extends the spec and continues the ticket numbers", async () => {
  seed(p, decided("app"));
  install(
    { spec: spec("As a person, I want a."), tickets: [["01-a.md", T(1, "app")], ["02-b.md", T(2, "app")], ["03-c.md", T(3, "app")]] },
    {
      spec: spec("As a person, I want a.", "As a person, I want the new card.") + "\nNew card is covered.\n",
      tickets: [["03-c.md", T(3, "app", "1", { title: "Ticket 3 rewritten" })], ["04-d.md", T(4, "newc", "2")]],
    },
  );
  const first = await werk(p, "plan", "app");
  expect(first.code).toBe(0);
  addBoard(
    { type: "ticket.moved", id: "app/01", to: "building", actor: "you" },
    { type: "ticket.moved", id: "app/02", to: "building", actor: "you" },
    { type: "ticket.moved", id: "app/02", to: "merging", actor: "loop" },
    { type: "ticket.merge", id: "app/02" },
  );
  seed(p, decided("newc", { parent: "app", title: "The new card" }));
  const second = await werk(p, "plan", "app");
  expect(second.stderr).toBe("");
  expect(second.code).toBe(0);
  const b = board();
  expect(b.plans.get("app")?.tickets).toEqual(["app/01", "app/02", "app/03", "app/04"]);
  expect(readFileSync(join(p.dir, ".werk/specs/app/spec.md"), "utf8")).toContain("new card");
  expect(b.tickets.get("app/03")?.title).toBe("Ticket 3 rewritten");
  expect(b.tickets.get("app/04")?.column).toBe("ready");
  expect(b.tickets.get("app/01")).toMatchObject({ column: "building", title: "Ticket 1" });
  expect(b.tickets.get("app/02")).toMatchObject({ column: "done", title: "Ticket 2" });
  expect(b.plans.size).toBe(1);
});

test("29.2 an open ticket the new spec no longer needs is archived and can be restored", async () => {
  seed(p, decided("app"), decided("x", { parent: "app", title: "Card x" }));
  install(
    { spec: spec("a"), tickets: [["01-a.md", T(1, "app")], ["02-b.md", T(2, "app, x")]] },
    {
      spec: spec("a"),
      tickets: [],
      extra: [edit("specs/app/ticket-drops.json", JSON.stringify([{ ticket: 2, why: "the current spec no longer needs it" }]))],
    },
  );
  expect((await werk(p, "plan", "app")).code).toBe(0);
  expect((await werk(p, "remove", "x", "--actor", "you")).code).toBe(0);
  const again = await werk(p, "plan", "app");
  expect(again.stderr).toBe("");
  expect(again.code).toBe(0);
  const t = board().tickets.get("app/02");
  expect(t?.archived).toBe(true);
  expect(t?.archive?.reason).toBe("the current spec no longer needs it");
  const r = await werk(p, "ticket", "restore", "02", "--actor", "you");
  expect(r.code).toBe(0);
  expect(board().tickets.get("app/02")).toMatchObject({ archived: false, id: "app/02" });
});

test("29.3 retitling a cited card blocks the ready ticket, and a re-plan clears the block", async () => {
  seed(p, decided("app"), decided("x", { parent: "app", title: "Old title" }));
  install(
    { spec: spec("a"), tickets: [["01-a.md", T(1, "app, x", "1", { what: 'Build #x "Old title".' })]] },
    { spec: spec("a"), tickets: [["01-a.md", T(1, "app, x", "1", { what: 'Build #x "New title".' })]] },
  );
  expect((await werk(p, "plan", "app")).code).toBe(0);
  await startServer(p);
  expect((await werk(p, "propose", "x", "--title", "New title")).code).toBe(0);
  expect((await werk(p, "accept", "x", "--actor", "you")).code).toBe(0);
  const blocked = await until(() => board().tickets.get("app/01")?.column === "blocked");
  expect(blocked).toBe(true);
  const reason = board().tickets.get("app/01")?.reason ?? "";
  expect(reason).toContain("x");
  expect(reason).toContain("title changed");
  expect((await werk(p, "plan", "app")).code).toBe(0);
  const t = board().tickets.get("app/01");
  expect(t?.column).toBe("ready");
  expect(readFileSync(join(p.dir, ".werk/tickets/app/01-a.md"), "utf8")).toContain("New title");
});

test("29.4 a note blocks nothing, a building ticket is never blocked", async () => {
  seed(p, decided("app"), decided("x", { parent: "app", title: "Card x", body: "Original body." }));
  install(
    { spec: spec("a"), tickets: [["01-a.md", T(1, "app, x")], ["02-b.md", T(2, "app, x")]] },
    { spec: spec("a"), tickets: [] },
  );
  expect((await werk(p, "plan", "app")).code).toBe(0);
  addBoard({ type: "ticket.moved", id: "app/02", to: "building", actor: "you" });
  await startServer(p);
  expect((await werk(p, "say", "x", "a note")).code).toBe(0);
  await Bun.sleep(1500);
  expect(board().tickets.get("app/01")).toMatchObject({ column: "ready", reason: "" });
  expect(board().tickets.get("app/02")).toMatchObject({ column: "building", reason: "" });
  expect((await werk(p, "propose", "x", "--ops", JSON.stringify([{ tag: "elaborated", old: "Original body.", new: "Changed body." }]))).code).toBe(0);
  expect((await werk(p, "accept", "x", "--actor", "you")).code).toBe(0);
  expect(await until(() => board().tickets.get("app/01")?.column === "blocked")).toBe(true);
  expect(board().tickets.get("app/01")?.reason).toMatch(/x.*body changed/);
  expect(board().tickets.get("app/02")).toMatchObject({ column: "building", reason: "" });
});

test("29.5 a card added under a planned subtree reports a failed check without blocking tickets", async () => {
  seed(p, decided("app"));
  install(
    { spec: spec("a"), tickets: [["01-a.md", T(1, "app")]] },
    { spec: spec("a"), tickets: [] },
  );
  expect((await werk(p, "plan", "app")).code).toBe(0);
  await startServer(p);
  seed(p, decided("fresh", { parent: "app", title: "A fresh card" }));
  expect(await until(() => board().plans.get("app")?.uncited.includes("fresh") === true)).toBe(true);
  expect(board().tickets.get("app/01")).toMatchObject({ column: "ready", reason: "" });
  expect(existsSync(boardPath(p))).toBe(true);
});
