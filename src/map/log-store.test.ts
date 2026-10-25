import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendEvents, logPathFor, readMap } from "./log-store.ts";

let dir: string;
let log: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "werk-log-"));
  log = join(dir, ".werk", "log.jsonl");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const node = (id: string) => ({
  type: "node.proposed",
  id,
  kind: "card",
  title: id,
  status: "open",
});
const lines = () => readFileSync(log, "utf8").split("\n").filter(Boolean);

test("the log is in the project's folder, and WERK_LOG names another", () => {
  expect(logPathFor("/p", {})).toBe("/p/.werk/log.jsonl");
  expect(logPathFor("/p", { WERK_LOG: "/x/log.jsonl" })).toBe("/x/log.jsonl");
});

test("a missing log folds to an empty map", () => {
  expect(readMap(log).map.nodes.size).toBe(0);
});

test("appends every event, creating the folder", () => {
  expect(appendEvents(log, [node("a"), node("b")])).toEqual({
    ok: true,
    appended: 2,
  });
  expect(lines()).toHaveLength(2);
});

test("one event that breaks a rule appends none of the events", () => {
  appendEvents(log, [node("a")]);
  const result = appendEvents(log, [node("b"), node("a")]);
  expect(result).toMatchObject({
    ok: false,
    index: 1,
    violation: { rule: "duplicate-id" },
  });
  expect(lines()).toHaveLength(1);
});

test("a later event of the same write sees the earlier one", () => {
  const result = appendEvents(log, [node("a"), { ...node("b"), parent: "a" }]);
  expect(result.ok).toBe(true);
});

test("a log with no final newline still gets one event per line", () => {
  appendEvents(log, [node("a")]);
  writeFileSync(log, readFileSync(log, "utf8").trimEnd());
  appendEvents(log, [node("b")]);
  expect(lines()).toHaveLength(2);
});

test("every read records how long the fold took", () => {
  appendEvents(log, [node("a")]);
  const { ms } = readMap(log);
  const times = readFileSync(join(dir, ".werk", "fold-ms.jsonl"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  // The read inside the append found no folder yet, so only this read is on record.
  expect(times).toHaveLength(1);
  expect(times[0]).toMatchObject({ events: 1, ms });
});
