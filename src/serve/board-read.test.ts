import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readBoardView, readTicketLog } from "./board-read.ts";

let dir: string;
let log: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "werk-board-read-"));
  log = join(dir, "log.jsonl");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const jsonl = (...events: unknown[]) =>
  `${events.map((e) => JSON.stringify(e)).join("\n")}\n`;

const board = (session: string, pid = 4242) =>
  jsonl(
    { type: "ticket.planned", id: "r/01", title: "One" },
    { type: "ticket.moved", id: "r/01", to: "building" },
    { type: "build.started", id: "r/01", session: "s1", pid, log: session },
  );

test("with no logs the board has five empty columns", () => {
  const view = readBoardView(log);
  expect(Object.keys(view.columns)).toEqual([
    "blocked",
    "ready",
    "building",
    "merging",
    "done",
  ]);
  expect(view.columns.building).toEqual([]);
});

test("a ticket carries its file, its obligations and the state of the cards it proposed", () => {
  writeFileSync(
    log,
    jsonl(
      {
        type: "node.proposed",
        id: "root",
        kind: "card",
        title: "R",
        status: "open",
      },
      { type: "obligation.opened", id: "o1", ticket: "r/01", cites: [] },
      {
        type: "node.proposed",
        id: "c",
        kind: "card",
        title: "Proposed card",
        status: "open",
        parent: "root",
        obligation: "o1",
      },
    ),
  );
  writeFileSync(join(dir, "board.jsonl"), board("s1.jsonl"));
  mkdirSync(join(dir, "tickets", "r"), { recursive: true });
  writeFileSync(
    join(dir, "tickets", "r", "01.md"),
    "title: One\ncites: root\n\n## What to build\n\nBody text\n",
  );
  const ticket = readBoardView(log, () => true).columns.building[0];
  expect(ticket?.running).toBe(true);
  expect(ticket?.text).toContain("Body text");
  expect(ticket?.cites).toEqual(["root"]);
  expect(ticket?.decisions).toEqual({
    cards: [{ id: "c", title: "Proposed card", state: "proposal" }],
    followed: [],
  });
});

test("the process decides whether a session runs", () => {
  writeFileSync(join(dir, "board.jsonl"), board("s1.jsonl", 2 ** 22 + 99));
  expect(readBoardView(log).columns.building[0]?.running).toBe(false);
  writeFileSync(join(dir, "board.jsonl"), board("s1.jsonl", process.pid));
  expect(readBoardView(log).columns.building[0]?.running).toBe(true);
});

test("the log of a building ticket is read from a relative or an absolute path", () => {
  const line = JSON.stringify({
    at: "2026-10-25T10:00:00Z",
    event: { type: "system", subtype: "init" },
  });
  writeFileSync(join(dir, "s1.jsonl"), `${line}\n`);
  writeFileSync(join(dir, "board.jsonl"), board("s1.jsonl"));
  expect(readTicketLog(log, "r/01")).toEqual({
    ok: true,
    lines: [{ time: "2026-10-25 10:00:00", text: "system init" }],
  });
  writeFileSync(join(dir, "board.jsonl"), board(join(dir, "s1.jsonl")));
  expect(readTicketLog(log, "r/01")).toMatchObject({ ok: true });
  writeFileSync(join(dir, "board.jsonl"), board("missing.jsonl"));
  expect(readTicketLog(log, "r/01")).toEqual({ ok: true, lines: [] });
});

test("a ticket that is not building has no log, and a bad request is refused", () => {
  writeFileSync(
    join(dir, "board.jsonl"),
    jsonl({ type: "ticket.planned", id: "r/01", title: "One" }),
  );
  expect(readTicketLog(log, "r/01")).toEqual({ ok: true, lines: [] });
  expect(readTicketLog(log, null)).toMatchObject({ ok: false, status: 400 });
  expect(readTicketLog(log, "")).toMatchObject({ ok: false, status: 400 });
  expect(readTicketLog(log, "r/99")).toMatchObject({ ok: false, status: 404 });
});
