import { expect, test } from "bun:test";
import type { LogEntry } from "../map/fold.ts";
import {
  deadBuilds,
  deathText,
  parseSession,
  restartOf,
} from "./dead-builds.ts";
import { foldBoard } from "./fold.ts";

const entries = (...events: unknown[]): LogEntry[] =>
  events.map((event, i) => ({ line: i + 1, event }));

const building = (id = "r/01") => [
  { type: "ticket.planned", id, title: "T" },
  { type: "ticket.moved", id, to: "building", actor: "you" },
];
const started = (session: string, pid: number, id = "r/01") => ({
  type: "build.started",
  id,
  session,
  pid,
  log: "l",
});

const board = (...events: unknown[]) => foldBoard(entries(...events));

test("a session id splits into its build and its pass number", () => {
  expect(parseSession("build-r-01-123:p3")).toEqual({
    buildId: "build-r-01-123",
    pass: 3,
  });
  expect(parseSession("no-pass")).toBeNull();
  expect(parseSession("x:p0")).toBeNull();
});

test("a started build with no end and a dead process is dead", () => {
  const b = board(...building(), started("b-1:p3", 10));
  expect(deadBuilds(b, () => false)).toEqual([
    { ticket: "r/01", session: "b-1:p3", buildId: "b-1", pass: 3 },
  ]);
});

test("a build whose process is alive is left alone", () => {
  const b = board(...building(), started("b-1:p3", 10));
  expect(deadBuilds(b, (pid) => pid === 10)).toEqual([]);
});

test("an ended build, an archived ticket and a ticket outside building are not dead", () => {
  const ended = board(...building(), started("b-1:p1", 10), {
    type: "build.ended",
    id: "r/01",
    session: "b-1:p1",
    result: "ended",
  });
  expect(deadBuilds(ended, () => false)).toEqual([]);
  const archived = board(...building(), started("b-1:p1", 10), {
    type: "ticket.archived",
    id: "r/01",
    actor: "you",
  });
  expect(deadBuilds(archived, () => false)).toEqual([]);
  const ready = board({ type: "ticket.planned", id: "r/02", title: "T" });
  expect(deadBuilds(ready, () => false)).toEqual([]);
});

test("a session id that is not a pass is skipped", () => {
  const b = board(...building(), started("odd", 10));
  expect(deadBuilds(b, () => false)).toEqual([]);
});

test("the fresh pass counts against the cap", () => {
  const dead = { ticket: "r/01", session: "b:p3", buildId: "b", pass: 3 };
  expect(restartOf(dead, 5)).toEqual({ action: "restart", pass: 4 });
  expect(restartOf({ ...dead, pass: 4 }, 5)).toEqual({
    action: "restart",
    pass: 5,
  });
  const last = restartOf({ ...dead, pass: 5 }, 5);
  expect(last.action).toBe("stop");
});

test("the death text names the pass", () => {
  expect(
    deathText({ ticket: "r/01", session: "b:p3", buildId: "b", pass: 3 }),
  ).toContain("Pass 3 died");
});

test("a dead build carries the cap its start recorded", () => {
  const b = board(...building(), {
    ...started("b:p2", 10),
    cap: 2,
  });
  expect(deadBuilds(b, () => false)).toEqual([
    { ticket: "r/01", session: "b:p2", buildId: "b", pass: 2, cap: 2 },
  ]);
});
