import { afterEach, beforeEach, expect, test } from "bun:test";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readBoard } from "../../src/board/log-store.ts";
import type { Script, Step } from "../../src/fake-agent/script.ts";
import { decided, link } from "../../src/map/mark-fixtures.ts";
import { createProject, type Project } from "../../src/test-env/project.ts";
import { ticket } from "../../src/tickets/fixtures.ts";

const CLI = join(import.meta.dir, "..", "..", "src", "cli.ts");
let project: Project;
beforeEach(() => {
  project = createProject();
});
afterEach(() => project.dispose());
const werk = (...args: string[]) => project.run(["bun", CLI, ...args]);
const logAppend = (...events: unknown[]) =>
  appendFileSync(project.logPath, `${events.flat().map((e) => JSON.stringify(e)).join("\n")}\n`);
const seed = (events: unknown[]) =>
  writeFileSync(project.logPath, `${events.map((e) => JSON.stringify(e)).join("\n")}\n`);
const boardPath = () => join(project.dir, ".werk", "board.jsonl");
const board = () => readBoard(boardPath());
const boardAppend = (...events: unknown[]) =>
  appendFileSync(boardPath(), `${events.map((e) => JSON.stringify(e)).join("\n")}\n`);

const RESULT: Step = {
  event: { type: "result", subtype: "success", is_error: false, duration_ms: 5, total_cost_usd: 0.1, usage: { input_tokens: 1, output_tokens: 1 } },
};
const edit = (path: string, content: string): Step => ({ edit: path, content });
const spec = (text: string) => `## Problem\n\n${text}\n\n## User stories\n\n1. As a person, I want it.\n2. As a person, I want more.\n`;
const specSteps = (text: string): Step[] => [
  edit("specs/app/spec.md", spec(text)),
  edit("specs/app/spec-answers.json", "[]"),
  RESULT,
];
const ticketSteps = (files: [string, string][]): Step[] => [
  ...files.map(([n, t]) => edit(`tickets/app/${n}`, t)),
  edit("specs/app/ticket-answers.json", "[]"),
  RESULT,
];
const t = (cites: string, title: string, stories = "1") => ticket({ cites, title, stories });

function install(specs: string[], tickets: [string, string][][]) {
  const s: Script = {
    roles: {
      "spec-writer": { replies: specs.map(specSteps) },
      "ticket-writer": { replies: tickets.map(ticketSteps) },
    },
  };
  project.install(s);
}
const mapBase = () => [...decided("app"), ...decided("c1"), link("c1", "app", "refines")];
const files3: [string, string][] = [
  ["01-a.md", t("app", "Ticket one")],
  ["02-b.md", t("c1", "Ticket two")],
  ["03-c.md", t("c1", "Ticket three", "2")],
];

async function firstPlan() {
  seed(mapBase());
  install(["first spec", "second spec covering c2"], [files3, []]);
  const r = await werk("plan", "app");
  expect(r.stderr).toBe("");
  expect(r.code).toBe(0);
}

test("29.1 second plan extends spec and continues numbers", async () => {
  await firstPlan();
  expect([...board().tickets.keys()].sort()).toEqual(["app/01", "app/02", "app/03"]);
  boardAppend({ type: "ticket.moved", id: "app/01", to: "building" });
  boardAppend({ type: "ticket.moved", id: "app/02", to: "building" }, { type: "ticket.moved", id: "app/02", to: "merging", actor: "loop" }, { type: "ticket.merge", id: "app/02" });
  logAppend(decided("c2"), link("c2", "app", "refines"));
  install(["second spec covering c2"], [[
    ["03-c.md", t("c1", "Ticket three rewritten", "2")],
    ["04-d.md", t("c2", "Ticket four")],
  ]]);
  // The install resets nothing: the fake picks by earlier launches, so give a fresh script for launches 3 and 4.
  const r = await werk("plan", "app");
  expect(r.code, r.stderr).toBe(0);
  const b = board();
  expect([...b.tickets.keys()].sort()).toEqual(["app/01", "app/02", "app/03", "app/04"]);
  expect(readFileSync(join(project.dir, ".werk/specs/app/spec.md"), "utf8")).toContain("c2");
  expect(readFileSync(join(project.dir, ".werk/tickets/app/03-c.md"), "utf8")).toContain("rewritten");
  expect(b.tickets.get("app/01")?.column).toBe("building");
  expect(b.tickets.get("app/02")?.column).toBe("done");
});

test("29.2 unneeded open ticket archived with reason and restorable", async () => {
  await firstPlan();
  logAppend({ type: "node.removed", id: "c1", actor: "you" });
  install(["x", "third"], [[["01-a.md", t("app", "Ticket one")]]]);
  const r = await werk("plan", "app");
  expect(r.code, r.stderr).toBe(0);
  const tk = board().tickets.get("app/02");
  expect(tk?.archived).toBe(true);
  expect(readFileSync(boardPath(), "utf8")).toContain("no longer needs");
  const rs = await werk("ticket", "restore", "02", "--actor", "you");
  expect(rs.code, rs.stderr).toBe(0);
  expect(board().tickets.get("app/02")?.archived).toBe(false);
});

test("29.3 retitle cited card blocks ready ticket; replan clears", async () => {
  await firstPlan();
  const p = await werk("propose", "c1", "--title", "New title");
  expect(p.code, p.stderr).toBe(0);
  await werk("accept", "c1", "--actor", "you");
  const tk = board().tickets.get("app/02");
  expect(tk?.column).toBe("blocked");
  expect(tk?.reason ?? "").toContain("c1");
  expect((tk?.reason ?? "").toLowerCase()).toContain("title");
  install(["x", "y"], [files3]);
  const r = await werk("plan", "app");
  expect(r.code, r.stderr).toBe(0);
  expect(board().tickets.get("app/02")?.column).toBe("ready");
});

test("29.4 note blocks nothing, body change blocks ready not building", async () => {
  await firstPlan();
  boardAppend({ type: "ticket.moved", id: "app/03", to: "building" });
  const n = await werk("say", "c1", "a note");
  expect(n.code, n.stderr).toBe(0);
  expect(board().tickets.get("app/02")?.column).toBe("ready");
  expect(board().tickets.get("app/02")?.reason ?? "").toBe("");
  const p = await werk("propose", "c1", "--ops", JSON.stringify([{ tag: "new", new: "more body" }]));
  expect(p.code, p.stderr).toBe(0);
  await werk("accept", "c1", "--actor", "you");
  const b = board();
  expect(b.tickets.get("app/02")?.column).toBe("blocked");
  expect(b.tickets.get("app/02")?.reason ?? "").toContain("c1");
  expect(b.tickets.get("app/03")?.column).toBe("building");
  expect(b.tickets.get("app/03")?.reason ?? "").toBe("");
});

test("29.5 uncited new card fails the cards-cited check, tickets untouched", async () => {
  await firstPlan();
  const a = await werk("add", "c9", "--title", "New card", "--parent", "app");
  expect(a.code, a.stderr).toBe(0);
  const out = a.stdout + a.stderr;
  expect(out).toContain("c9");
  expect(out.toLowerCase()).toContain("cited");
  for (const id of ["app/01", "app/02", "app/03"]) {
    expect(board().tickets.get(id)?.column).toBe("ready");
  }
});
