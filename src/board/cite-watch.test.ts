import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { decided, link, reopen } from "../map/mark-fixtures.ts";
import { createProject, type Project } from "../test-env/project.ts";
import { ticket } from "../tickets/fixtures.ts";
import { runCiteWatch } from "./cite-watch.ts";
import { appendBoardEvent, boardLogBeside, readBoard } from "./log-store.ts";

let project: Project;
beforeEach(() => {
  project = createProject();
});
afterEach(() => project.dispose());

const log = (...events: unknown[]) =>
  appendFileSync(
    project.logPath,
    events
      .flat()
      .map((e) => `${JSON.stringify(e)}\n`)
      .join(""),
  );
const lines = () =>
  readFileSync(project.logPath, "utf8").split("\n").length - 1;
const boardLog = () => boardLogBeside(project.logPath);
const board = () => readBoard(boardLog());
const put = (event: Record<string, unknown>) => {
  const result = appendBoardEvent(boardLog(), event);
  expect(result.ok).toBe(true);
};
const file = (name: string, cites: string) => {
  const dir = join(project.dir, ".werk", "tickets", "app");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), ticket({ cites, stories: "1" }));
};

/** The map: app and two cards under it, all decided. Three tickets, each citing cards. */
function plan() {
  log(decided("app"), decided("one"), decided("two"));
  log({ type: "edge.added", from: "one", to: "app", link: "refines" });
  log({ type: "edge.added", from: "two", to: "app", link: "refines" });
  const at = lines();
  file("01-a.md", "app, one");
  file("02-b.md", "two");
  file("03-c.md", "app, one, two");
  const cited = (cards: string[]) =>
    Object.fromEntries(cards.map((c) => [c, at]));
  put({
    type: "ticket.planned",
    id: "app/01",
    title: "a",
    cited: cited(["app", "one"]),
  });
  put({
    type: "ticket.planned",
    id: "app/02",
    title: "b",
    cited: cited(["two"]),
  });
  put({
    type: "ticket.planned",
    id: "app/03",
    title: "c",
    cited: cited(["app", "one", "two"]),
  });
}

test("reopening a cited card blocks the ready tickets that cite it, with the card and the change in the reason", () => {
  plan();
  log(reopen("one"));
  expect(runCiteWatch(project.logPath)).toBeGreaterThan(0);
  const b = board();
  expect(b.tickets.get("app/01")?.column).toBe("blocked");
  expect(b.tickets.get("app/01")?.reason).toContain("#one");
  expect(b.tickets.get("app/01")?.reason).toContain("reopened");
  expect(b.tickets.get("app/03")?.column).toBe("blocked");
  expect(b.tickets.get("app/02")?.column).toBe("ready");
});

test("a note on a cited card blocks nothing", () => {
  plan();
  log({ type: "note.added", id: "one", text: "think about this", who: "you" });
  runCiteWatch(project.logPath);
  expect(board().tickets.get("app/01")?.column).toBe("ready");
  expect(board().tickets.get("app/03")?.column).toBe("ready");
});

test("a building ticket stays in building when its cited card changes", () => {
  plan();
  put({ type: "ticket.moved", id: "app/02", to: "building", actor: "you" });
  log(reopen("two"));
  runCiteWatch(project.logPath);
  const b = board();
  expect(b.tickets.get("app/02")?.column).toBe("building");
  expect(b.tickets.get("app/02")?.marks).toEqual([]);
  expect(b.tickets.get("app/03")?.column).toBe("blocked");
});

test("a second run over the same log appends nothing", () => {
  plan();
  log(reopen("one"));
  runCiteWatch(project.logPath);
  const before = readFileSync(boardLog(), "utf8");
  expect(runCiteWatch(project.logPath)).toBe(0);
  expect(readFileSync(boardLog(), "utf8")).toBe(before);
});

test("a card that a cited card's change makes stale blocks the tickets that cite the stale card", () => {
  log(decided("app"), decided("base"), decided("user"), link("user", "base"));
  const at = lines();
  file("01-a.md", "app, user");
  put({
    type: "ticket.planned",
    id: "app/01",
    title: "a",
    cited: { user: at },
  });
  log(reopen("base"));
  runCiteWatch(project.logPath);
  expect(board().tickets.get("app/01")?.reason).toContain("marked stale");
});

test("a decided card added under a planned subtree is reported as uncited and blocks no ticket", () => {
  plan();
  runCiteWatch(project.logPath);
  expect(board().plans.get("app")?.uncited).toEqual([]);
  log(decided("late"));
  log({ type: "edge.added", from: "late", to: "app", link: "refines" });
  runCiteWatch(project.logPath);
  const b = board();
  expect(b.plans.get("app")?.uncited).toEqual(["late"]);
  expect(b.tickets.get("app/02")?.column).toBe("ready");
  // The same report is not written twice.
  expect(runCiteWatch(project.logPath)).toBe(0);
});

test("a board with no ticket, or a plan with no open ticket, needs no work", () => {
  expect(runCiteWatch(project.logPath)).toBe(0);
  plan();
  for (const n of ["01", "02", "03"])
    put({ type: "ticket.archived", id: `app/${n}` });
  log(decided("late"));
  log({ type: "edge.added", from: "late", to: "app", link: "refines" });
  expect(runCiteWatch(project.logPath)).toBe(0);
});
