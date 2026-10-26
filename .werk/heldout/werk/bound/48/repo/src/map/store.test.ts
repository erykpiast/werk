// The log on disk (#pr-log-refuse, #pr-log-snapshot). Named behaviours: where the log is found,
// that every read records its fold time, and that a write appends all of its events or none.
import { expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject } from "../test/project.ts";
import { foldTimesPath, logPath, Refused, readMap, write } from "./store.ts";

test("the log is WERK_LOG when set, else .werk/log.jsonl in the nearest folder that has one", () => {
  const { dir } = freshProject();
  mkdirSync(join(dir, "src", "deep"), { recursive: true });
  expect(logPath(join(dir, "src", "deep"), {})).toBe(join(dir, ".werk", "log.jsonl"));
  expect(logPath(dir, { WERK_LOG: "/elsewhere/log.jsonl" })).toBe("/elsewhere/log.jsonl");
  expect(logPath("/", {})).toBe("/.werk/log.jsonl");
});

test("every read records its fold time beside the log", () => {
  const { dir } = freshProject();
  const log = join(dir, ".werk", "log.jsonl");
  readMap("show", log);
  readMap("add", log);
  const times = readFileSync(foldTimesPath(log), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(times.map((time) => time.via)).toEqual(["show", "add"]);
  expect(times[0]).toMatchObject({ lines: 0 });
  expect(typeof times[0].ms).toBe("number");
});

test("a read does not fail when its fold time cannot be written", () => {
  const { dir } = freshProject();
  const log = join(dir, ".werk", "log.jsonl");
  mkdirSync(foldTimesPath(log));
  expect(readMap("show", log).nodes.size).toBe(0);
});

test("a write appends all of its events, after a last line with no line end", () => {
  const { dir } = freshProject();
  const log = join(dir, ".werk", "log.jsonl");
  const root = JSON.stringify({
    seq: 1,
    at: "t",
    actor: "agent",
    type: "node.added",
    payload: { id: "r", kind: "card", title: "R" },
  });
  writeFileSync(log, root);
  write(
    readMap("add", log),
    [
      { type: "node.proposed", actor: "agent", payload: { id: "a", kind: "card", title: "A", parent: "r" } },
      { type: "change.accepted", actor: "you", payload: { id: "a" } },
    ],
    log,
  );
  const lines = readFileSync(log, "utf8").split("\n");
  expect(lines).toHaveLength(4);
  expect(readMap("show", log).nodes.get("a")?.proposed).toBe(false);
});

test("a refused write appends nothing and names the rule", () => {
  const { dir } = freshProject();
  const log = join(dir, ".werk", "nested", "log.jsonl");
  const map = readMap("add", log);
  expect(() =>
    write(
      map,
      [
        { type: "node.proposed", actor: "agent", payload: { id: "a", kind: "card", title: "A" } },
        { type: "change.accepted", actor: "you", payload: { id: "b" } },
      ],
      log,
    ),
  ).toThrow(new Refused("refused: unknown node #b"));
  write(map, [{ type: "node.proposed", actor: "agent", payload: { id: "a", kind: "card", title: "A" } }], log);
  expect(readFileSync(log, "utf8").split("\n")).toHaveLength(2);
});
