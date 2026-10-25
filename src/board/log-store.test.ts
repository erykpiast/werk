import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendBoardEvent,
  boardLogPathFor,
  pidAlive,
  readBoard,
} from "./log-store.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "werk-board-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

test("the board log sits beside the map log", () => {
  expect(boardLogPathFor("/p", {})).toBe("/p/.werk/board.jsonl");
  expect(boardLogPathFor("/p", { WERK_LOG: "/x/y/log.jsonl" })).toBe(
    "/x/y/board.jsonl",
  );
});

test("an event is appended as one line, and a refused event appends nothing", () => {
  const path = join(dir, "sub", "board.jsonl");
  expect(readBoard(path).tickets.size).toBe(0);
  expect(
    appendBoardEvent(path, { type: "ticket.planned", id: "r/01" }).ok,
  ).toBe(true);
  const refused = appendBoardEvent(path, {
    type: "ticket.restored",
    ticket: "r/01",
  });
  expect(refused.ok).toBe(false);
  expect(readFileSync(path, "utf8").trim().split("\n")).toHaveLength(1);
  expect(readBoard(path).tickets.has("r/01")).toBe(true);
});

test("an append after a line with no newline starts a new line", () => {
  const path = join(dir, "board.jsonl");
  writeFileSync(path, JSON.stringify({ type: "ticket.planned", id: "r/01" }));
  appendBoardEvent(path, { type: "ticket.planned", id: "r/02" });
  expect(readBoard(path).tickets.size).toBe(2);
});

test("a live process is alive and a finished one is not", async () => {
  expect(pidAlive(process.pid)).toBe(true);
  const child = Bun.spawn(["true"]);
  await child.exited;
  expect(pidAlive(child.pid)).toBe(false);
});
