import { expect, test } from "bun:test";
import { prepare, toLines } from "./commit.ts";
import { fold } from "./fold.ts";

const AT = "2026-10-25T00:00:00.000Z";
const root = JSON.stringify({
  seq: 7,
  at: AT,
  actor: "agent",
  type: "node.added",
  payload: { id: "root", kind: "card", title: "Root" },
});

test("each event gets the next seq and the time, in the order of the log line", () => {
  const prepared = prepare(
    fold(root),
    [
      { type: "node.proposed", actor: "agent", payload: { id: "a", kind: "card", title: "A", parent: "root" } },
      { type: "change.accepted", actor: "you", payload: { id: "a" } },
    ],
    AT,
  );
  expect(prepared).toEqual({
    ok: true,
    events: [
      {
        seq: 8,
        at: AT,
        actor: "agent",
        type: "node.proposed",
        payload: { id: "a", kind: "card", title: "A", parent: "root" },
      },
      { seq: 9, at: AT, actor: "you", type: "change.accepted", payload: { id: "a" } },
    ],
  });
});

test("a later event that breaks a rule refuses the whole write, and the map is unchanged", () => {
  const map = fold(root);
  const prepared = prepare(
    map,
    [
      { type: "node.proposed", actor: "agent", payload: { id: "a", kind: "card", title: "A", parent: "root" } },
      { type: "node.proposed", actor: "agent", payload: { id: "a", kind: "card", title: "A again" } },
    ],
    AT,
  );
  expect(prepared).toEqual({
    ok: false,
    rule: "a ghost's words are frozen: #a is proposed; discard it and propose it again",
  });
  expect([...map.nodes.keys()]).toEqual(["root"]);
});

test("the log lines are one JSON event per line", () => {
  const prepared = prepare(fold(""), [{ type: "change.accepted", actor: "you", payload: { id: "x" } }], AT);
  expect(prepared.ok).toBe(false);
  expect(toLines([])).toBe("");
  const ok = prepare(
    fold(""),
    [{ type: "node.added", actor: "agent", payload: { id: "x", kind: "card", title: "X" } }],
    AT,
  );
  if (!ok.ok) throw new Error(ok.rule);
  expect(toLines(ok.events)).toBe(`${JSON.stringify(ok.events[0])}\n`);
});

test("a write that a contract check refuses appends nothing and names every missing fact", () => {
  const prepared = prepare(
    fold(root),
    [
      { type: "node.edited", actor: "agent", payload: { id: "root", who: "me" } },
      { type: "node.decided", actor: "agent", payload: { id: "root" } },
    ],
    AT,
  );
  expect(prepared.ok).toBe(false);
  if (prepared.ok) return;
  expect(prepared.rule).toStartWith("#root cannot be decided: 2 facts are missing\n  basis: ");
  expect(prepared.rule).toContain("\n  kill criterion: ");
});
