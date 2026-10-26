import { expect, test } from "bun:test";
import { fold } from "./fold.ts";
import { describeKill, formatNode, formatPending, formatProblems, stagedLines, titleOf } from "./show.ts";
import type { Draft, MapNode } from "./types.ts";

const mapOf = (...drafts: Draft[]) =>
  fold(drafts.map((d, i) => JSON.stringify({ seq: i + 1, at: "t", ...d })).join("\n"));

const map = mapOf(
  { type: "node.added", actor: "agent", payload: { id: "root", kind: "card", title: "Root" } },
  { type: "node.added", actor: "agent", payload: { id: "b", kind: "card", title: "B", parent: "root" } },
  {
    type: "node.proposed",
    actor: "agent",
    payload: { id: "a", kind: "card", title: "A", why: "Because", body: "Body text", who: "me", parent: "root" },
  },
  { type: "edge.added", actor: "agent", payload: { from: "a", to: "b", type: "depends_on", why: "uses B" } },
  {
    type: "node.proposed",
    actor: "agent",
    payload: { id: "a:opt0", kind: "option", title: "Other", why_not: "slower" },
  },
  { type: "edge.added", actor: "agent", payload: { from: "a:opt0", to: "a", type: "alternative_to" } },
  {
    type: "node.added",
    actor: "agent",
    payload: { id: "s", kind: "source", title: "Survey", url: "https://x.invalid", finding: "Most pay per seat" },
  },
);

test("a ghost prints its status, who, parent, words and held links", () => {
  expect(formatNode(map, "a")).toBe(
    [
      "card a  [open]  proposed",
      "A",
      "why: Because",
      "who: me",
      "parent: root  Root",
      "",
      "Body text",
      "",
      "  -> refines         root  Root  (held)",
      "  -> depends_on      b  B  (held)",
      "       why: uses B",
      "  <- alternative_to  a:opt0  Other  (ghost, held)",
      "",
    ].join("\n"),
  );
});

test("a parent lists its ghost child as a ghost", () => {
  expect(formatNode(map, "root")).toBe(
    ["card root  [open]", "Root", "", "  <- refines         b  B", "  <- refines         a  A  (ghost, held)", ""].join(
      "\n",
    ),
  );
});

test("an option and a source print their own fields", () => {
  expect(formatNode(map, "a:opt0")).toContain("why not: slower\n");
  expect(formatNode(map, "s")).toBe(
    ["source s  [open]", "Survey", "url: https://x.invalid", "finding: Most pay per seat", ""].join("\n"),
  );
  expect(formatNode(map, "nope")).toBeUndefined();
});

test("each set-aside line prints with its line number and rule", () => {
  expect(formatProblems([{ line: 4, rule: "unknown node #x" }])).toBe("werk: log line 4 set aside: unknown node #x\n");
  expect(formatProblems([])).toBe("");
});

test("an accept or a discard names the node, then each node that went with it", () => {
  expect(stagedLines(map, "a", ["a", "a:opt0"], "accepted")).toBe("a: accepted\n  and a:opt0  Other\n");
  expect(stagedLines(map, "a", ["a"], "discarded")).toBe("a: discarded\n");
});

test("a node out of the map keeps its title for the lines that name it", () => {
  const out = mapOf(
    { type: "node.added", actor: "agent", payload: { id: "root", kind: "card", title: "Root" } },
    { type: "node.added", actor: "agent", payload: { id: "b", kind: "card", title: "B", parent: "root" } },
    { type: "node.removed", actor: "you", payload: { id: "b" } },
  );
  expect(formatNode(out, "b")).toBeUndefined();
  expect(titleOf(out, "b")).toBe("B");
  expect(titleOf(out, "nope")).toBe("");
  expect(stagedLines(out, "root", ["root", "b"], "removed")).toBe("root: removed\n  and b  B\n");
});

test("a card prints its waivers with their reasons and every kill criterion in order", () => {
  const decided = mapOf(
    { type: "node.added", actor: "agent", payload: { id: "t", kind: "card", title: "T", who: "you" } },
    {
      type: "node.edited",
      actor: "agent",
      payload: { id: "t", no_basis: "root of a tree", unchallenged: "no real choice" },
    },
    { type: "kill.added", actor: "agent", payload: { id: "t", criterion: { form: "no-metric", reason: "cheap" } } },
    { type: "kill.added", actor: "agent", payload: { id: "t", criterion: { form: "revisit" } } },
  );
  expect(formatNode(decided, "t")).toBe(
    [
      "card t  [open]",
      "T",
      "who: you",
      "basis waived: root of a tree",
      "option waived: no real choice",
      "kill criteria:",
      "  1. no metric: cheap",
      "  2. revisit at any time",
      "",
    ].join("\n"),
  );
});

test("each form of a kill criterion reads in plain words", () => {
  expect(
    describeKill({ form: "metric", metric: "install time", source: "PostHog", threshold: "> 4 min", window: "7 days" }),
  ).toBe("metric: install time, from PostHog, threshold > 4 min, window 7 days");
  expect(describeKill({ form: "manual", test: "I use it weekly" })).toBe("manual test: I use it weekly");
  expect(describeKill({ form: "no-metric", reason: "cheap to undo" })).toBe("no metric: cheap to undo");
  expect(describeKill({ form: "revisit" })).toBe("revisit at any time");
});

test("a pending change prints as one diff of the title, the why and the body, after the current words", () => {
  const pending = mapOf(
    {
      type: "node.added",
      actor: "agent",
      payload: { id: "p", kind: "card", title: "P", why: "W", body: "One.\n\nTwo.\n\nThree." },
    },
    {
      type: "change.proposed",
      actor: "agent",
      payload: {
        id: "p",
        title: "P2",
        why: "W2",
        ops: [
          { tag: "elaborated", old: "One.", new: "One." },
          { tag: "elaborated", old: "Two.", new: "Two, again." },
          { tag: "removed", old: "Three." },
          { tag: "new", new: "Four.\nFive." },
          { tag: "elaborated", old: "Six.", new: "Seven." },
        ],
      },
    },
  );
  expect(formatNode(pending, "p")).toBe(
    [
      "card p  [open]  pending change",
      "P",
      "why: W",
      "",
      "One.\n\nTwo.\n\nThree.",
      "",
      "pending change:",
      "  title: [-P-]{+P2+}",
      "  why: [-W-]{+W2+}",
      "  body:",
      "    One.",
      "",
      "    [-Two.-]{+Two, again.+}",
      "",
      "    [-Three.-]",
      "",
      "    {+Four.",
      "    Five.+}",
      "",
      "    [-Six.-]  (not a block of the body)",
      "",
      "    {+Seven.+}",
      "",
    ].join("\n"),
  );
  const whyOnly = mapOf(
    { type: "node.added", actor: "agent", payload: { id: "q", kind: "card", title: "Q" } },
    { type: "change.proposed", actor: "agent", payload: { id: "q", why: "Now a why." } },
  );
  expect(formatPending(whyOnly.nodes.get("q") as MapNode)).toEqual(["pending change:", "  why: {+Now a why.+}"]);
  expect(formatPending(map.nodes.get("b") as MapNode)).toEqual([]);
});

test("a node with notes prints its thread after its links", () => {
  const withNote = mapOf(
    { type: "node.added", actor: "agent", payload: { id: "root", kind: "card", title: "Root" } },
    { type: "note.added", actor: "you", payload: { id: "root", text: "Why root?" } },
  );
  expect(formatNode(withNote, "root")).toBe("card root  [open]\nRoot\n\nThread\n  [2] you: Why root?\n");
});
