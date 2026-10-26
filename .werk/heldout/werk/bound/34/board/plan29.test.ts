import { afterEach, beforeEach, expect, test } from "bun:test";
import { readBoard } from "../../src/board/log-store.ts";
import type { Step } from "../../src/fake-agent/script.ts";
import { decided } from "../../src/map/mark-fixtures.ts";
import { ticket } from "../../src/tickets/fixtures.ts";
import { harness } from "./util.ts";
import { join } from "node:path";
import { appendFileSync, readFileSync } from "node:fs";

const h = harness();
beforeEach(() => h.create());
afterEach(() => h.dispose());

const RESULT: Step = {
  event: {
    type: "result", subtype: "success", is_error: false, duration_ms: 5,
    total_cost_usd: 0.25, usage: { input_tokens: 10, output_tokens: 20 },
  },
};
const edit = (path: string, content: string): Step => ({ edit: path, content });
const SPEC = (extra = "") =>
  `## Problem\n\nP.${extra}\n\n## User stories\n\n1. As a person, I want it.\n`;
const spec = (extra = ""): Step[] => [
  edit("specs/app/spec.md", SPEC(extra)),
  edit("specs/app/spec-answers.json", "[]"),
  RESULT,
];
const tickets = (...files: [string, string][]): Step[] => [
  ...files.map(([n, t]) => edit(`tickets/app/${n}`, t)),
  edit("specs/app/ticket-answers.json", "[]"),
  RESULT,
];
const t = (cites: string, what?: string) =>
  ticket({ cites, stories: "1", ...(what ? { what } : {}) });
const board = () => readBoard(join(h.project.dir, ".werk", "board.jsonl"));
const append = (e: unknown) =>
  appendFileSync(join(h.project.dir, ".werk", "board.jsonl"), `${JSON.stringify(e)}\n`);
const specText = () => readFileSync(join(h.project.dir, ".werk/specs/app/spec.md"), "utf8");

/** Plans "app" once with tickets 1..n citing the given cards. */
async function planOnce(
  cards: string[],
  second?: { spec: Step[]; tickets: Step[] },
) {
  h.seedMap(...decided("app"), ...decided("c1", { parent: "app" }));
  h.project.install({
    roles: {
      "spec-writer": { replies: [spec(), ...(second ? [second.spec] : [])] },
      "ticket-writer": {
        replies: [
          tickets(...cards.map((c, i): [string, string] => [`0${i + 1}-x.md`, t(c)])),
          ...(second ? [second.tickets] : []),
        ],
      },
    },
  });
  const r = await h.werk("plan", "app");
  expect(r.stderr).toBe("");
  expect(r.code).toBe(0);
}

test("29.1 a second plan extends the spec and continues the ticket numbers", async () => {
  await planOnce(["app", "c1", "app"], {
    spec: spec("\n\nNEWCARD covered."),
    tickets: tickets(
      ["03-x.md", t("app", "Rewritten text of three.")],
      ["04-new.md", t("new-card")],
    ),
  });
  expect(board().tickets.size).toBe(3);
  append({ type: "ticket.moved", id: "app/01", to: "building" });
  append({ type: "ticket.moved", id: "app/02", to: "building" });
  append({ type: "ticket.moved", id: "app/02", to: "merging", actor: "loop" });
  append({ type: "ticket.merge", id: "app/02" });
  const log = readFileSync(h.project.logPath, "utf8");
  h.seedMap(...log.split("\n").filter(Boolean).map((l) => JSON.parse(l)), ...decided("new-card", { parent: "app" }));
  const again = await h.werk("plan", "app");
  expect(again.code).toBe(0);
  expect(board().plans.size).toBe(1);
  expect(specText()).toContain("NEWCARD");
  expect(board().tickets.get("app/04")).toBeDefined();
  expect(board().tickets.get("app/03")?.column).toBe("ready");
  expect(readFileSync(join(h.project.dir, ".werk/tickets/app/03-x.md"), "utf8")).toContain("Rewritten text of three.");
  expect(board().tickets.get("app/01")?.column).toBe("building");
  expect(board().tickets.get("app/02")?.column).toBe("done");
}, 60000);

test("29.2 an open ticket the new spec no longer needs is archived and can be restored", async () => {
  await planOnce(["app", "c1"], {
    spec: spec(),
    tickets: tickets(["01-x.md", t("app")]),
  });
  await h.werk("remove", "c1", "--actor", "you");
  const again = await h.werk("plan", "app");
  expect(again.code).toBe(0);
  expect(board().tickets.get("app/02")?.archived).toBe(true);
  expect(readFileSync(join(h.project.dir, ".werk/board.jsonl"), "utf8")).toMatch(/no longer needs/);
  const restore = await h.werk("ticket", "restore", "02", "--actor", "you");
  expect(restore.code).toBe(0);
  expect(board().tickets.get("app/02")?.archived).toBe(false);
}, 60000);

test("29.3 retitling a cited card blocks the ready ticket, and a re-plan clears the block", async () => {
  await planOnce(["app", "c1"], {
    spec: spec(),
    tickets: tickets(["02-x.md", t("c1")]),
  });
  expect((await h.werk("propose", "c1", "--title", "New title")).code).toBe(0);
  expect((await h.werk("accept", "c1", "--actor", "you")).code).toBe(0);
  const blocked = board().tickets.get("app/02");
  expect(blocked?.column).toBe("blocked");
  expect(blocked?.reason).toContain("c1");
  expect(blocked?.reason).toContain("title");
  expect((await h.werk("plan", "app")).code).toBe(0);
  expect(board().tickets.get("app/02")?.column).toBe("ready");
}, 60000);

test("29.4 a note on a cited card blocks nothing, and a building ticket is never blocked", async () => {
  await planOnce(["c1", "c1", "app"]);
  append({ type: "ticket.moved", id: "app/02", to: "building" });
  expect((await h.werk("say", "c1", "a note")).code).toBe(0);
  expect(board().tickets.get("app/01")?.column).toBe("ready");
  expect(board().tickets.get("app/01")?.reason).toBe("");
  expect(board().tickets.get("app/02")?.reason).toBe("");
  expect((await h.werk("propose", "c1", "--ops", '[{"tag":"new","new":"More body."}]')).code).toBe(0);
  expect((await h.werk("accept", "c1", "--actor", "you")).code).toBe(0);
  const ready = board().tickets.get("app/01");
  expect(ready?.column).toBe("blocked");
  expect(ready?.reason).toContain("c1");
  expect(ready?.reason).toContain("body");
  expect(board().tickets.get("app/02")?.column).toBe("building");
  expect(board().tickets.get("app/02")?.reason).toBe("");
}, 60000);

test("29.5 a card added under a planned subtree reports a failed check without blocking tickets", async () => {
  await planOnce(["app", "c1"]);
  const add = await h.werk("add", "fresh", "--title", "Fresh", "--parent", "app");
  const combined = add.stdout + add.stderr;
  expect(combined).toContain("cards-cited");
  expect(combined).toContain("fresh");
  for (const id of ["app/01", "app/02"]) {
    expect(board().tickets.get(id)?.column).toBe("ready");
    expect(board().tickets.get(id)?.reason).toBe("");
  }
}, 60000);
