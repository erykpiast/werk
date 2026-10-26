import { expect, test } from "bun:test";
import { copyMap, emptyMap, fold, step } from "./fold.ts";
import type { Draft, Link } from "./types.ts";

const line = (seq: number, draft: Draft) => JSON.stringify({ seq, at: "2026-10-25T00:00:00.000Z", ...draft });
const logOf = (...drafts: Draft[]) => drafts.map((d, i) => line(i + 1, d)).join("\n");
const card = (id: string, parent?: string, type: "node.added" | "node.proposed" = "node.added"): Draft => ({
  type,
  actor: "agent",
  payload: { id, kind: "card", title: `Card ${id}`, ...(parent === undefined ? {} : { parent }) },
});

test("an empty log folds to an empty map", () => {
  expect(fold("")).toEqual(emptyMap());
});

test("a card added under a parent sits under it, from the same event", () => {
  const map = fold(logOf(card("root"), card("a", "root")));
  expect(map.nodes.get("a")).toEqual({ id: "a", kind: "card", title: "Card a", status: "open", proposed: false });
  expect(map.links).toEqual([{ from: "a", to: "root", type: "refines" }]);
  expect(map.ghostEdges).toEqual([]);
  expect(map.lastSeq).toBe(2);
});

test("a proposed node is a ghost until it is accepted", () => {
  const map = fold(
    logOf(card("root"), card("g", "root", "node.proposed"), {
      type: "change.accepted",
      actor: "you",
      payload: { id: "g" },
    }),
  );
  expect(map.nodes.get("g")?.proposed).toBe(false);
  expect(fold(logOf(card("root"), card("g", "root", "node.proposed"))).nodes.get("g")?.proposed).toBe(true);
});

test("the map holds only the latest words and links", () => {
  const map = fold(
    logOf(
      card("a"),
      card("b"),
      { type: "node.retitled", actor: "agent", payload: { id: "a", title: "New title" } },
      { type: "node.bodyEdited", actor: "agent", payload: { id: "a", why: "New why", body: "New body" } },
      { type: "node.bodyEdited", actor: "agent", payload: { id: "a" } },
      { type: "edge.added", actor: "agent", payload: { from: "a", to: "b", type: "depends_on", why: "first" } },
      { type: "edge.added", actor: "agent", payload: { from: "a", to: "b", type: "depends_on", why: "second" } },
      { type: "edge.added", actor: "agent", payload: { from: "a", to: "b", type: "refines" } },
      { type: "edge.removed", actor: "agent", payload: { from: "a", to: "b", type: "refines" } },
    ),
  );
  expect(map.problems).toEqual([]);
  expect(map.nodes.get("a")).toMatchObject({ title: "New title", why: "New why", body: "New body" });
  expect(map.links).toEqual([{ from: "a", to: "b", type: "depends_on", why: "second" }]);
});

test("a discarded ghost leaves with its links, and its id is free again", () => {
  const map = fold(
    logOf(
      card("root"),
      card("g", "root", "node.proposed"),
      { type: "node.proposed", actor: "agent", payload: { id: "s", kind: "source", title: "S" } },
      { type: "edge.added", actor: "agent", payload: { from: "g", to: "s", type: "supported_by" } },
      { type: "change.discarded", actor: "agent", payload: { id: "g" } },
      card("g", "root", "node.proposed"),
    ),
  );
  expect(map.problems).toEqual([]);
  expect(map.links).toEqual([]);
  expect(map.ghostEdges).toEqual([{ from: "g", to: "root", type: "refines" }]);
});

test("a ghost's links are held outside the live links, and go live once both ends are real", () => {
  const accept = (id: string): Draft => ({ type: "change.accepted", actor: "you", payload: { id } });
  const drafts: Draft[] = [
    card("root"),
    card("g", "root", "node.proposed"),
    { type: "node.proposed", actor: "agent", payload: { id: "s", kind: "source", title: "S" } },
    { type: "edge.added", actor: "agent", payload: { from: "g", to: "s", type: "supported_by" } },
  ];
  const held = fold(logOf(...drafts));
  expect(held.links).toEqual([]);
  expect(held.ghostEdges).toEqual([
    { from: "g", to: "root", type: "refines" },
    { from: "g", to: "s", type: "supported_by" },
  ]);
  const half = fold(logOf(...drafts, accept("g")));
  expect(half.links).toEqual([{ from: "g", to: "root", type: "refines" }]);
  expect(half.ghostEdges).toEqual([{ from: "g", to: "s", type: "supported_by" }]);
  const live = fold(logOf(...drafts, accept("g"), accept("s")));
  expect(live.ghostEdges).toEqual([]);
  expect(live.links).toHaveLength(2);
  const unlinked = fold(
    logOf(...drafts, { type: "edge.removed", actor: "agent", payload: { from: "g", to: "s", type: "supported_by" } }),
  );
  expect(unlinked.ghostEdges).toEqual([{ from: "g", to: "root", type: "refines" }]);
});

test("a bad line is set aside with its line number, and the lines after it still fold", () => {
  const text = [
    line(1, card("root")),
    line(2, card("a", "root")),
    "",
    line(3, { type: "edge.added", actor: "agent", payload: { from: "a", to: "nope", type: "refines" } }),
    "{not json",
    JSON.stringify({ seq: 4 }),
    "null",
    line(5, card("b", "root")),
  ].join("\n");
  const map = fold(text);
  expect(map.problems).toEqual([
    { line: 4, rule: "unknown node #nope" },
    { line: 5, rule: "a log line is one JSON event" },
    { line: 6, rule: "an event is an object with a type" },
    { line: 7, rule: "an event is an object with a type" },
  ]);
  expect([...map.nodes.keys()]).toEqual(["root", "a", "b"]);
  expect(map.lastSeq).toBe(5);
});

test("a step applies an event that passes and returns the rule of one that fails", () => {
  const map = emptyMap();
  expect(step(map, { seq: 1, at: "t", ...card("a") } as never)).toBeUndefined();
  expect(step(map, { seq: 2, at: "t", ...card("a") } as never)).toBe("#a already exists");
  expect(map.lastSeq).toBe(2);
});

test("a copy changes apart from the original", () => {
  const map = fold(logOf(card("root"), card("a", "root"), card("g", "root", "node.proposed")));
  const copy = copyMap(map);
  step(copy, { seq: 3, at: "t", type: "change.accepted", actor: "you", payload: { id: "g" } } as never);
  expect(map.ghostEdges).toEqual([{ from: "g", to: "root", type: "refines" }]);
  expect(copy.ghostEdges).toEqual([]);
  step(copy, { seq: 3, at: "t", type: "change.discarded", actor: "agent", payload: { id: "a" } } as never);
  step(copy, { seq: 4, at: "t", type: "node.retitled", actor: "agent", payload: { id: "root", title: "Z" } } as never);
  expect(map.nodes.get("root")?.title).toBe("Card root");
  expect(map.lastSeq).toBe(3);
  expect(copy.lastSeq).toBe(4);
});

const remove = (id: string, reparent?: boolean): Draft => ({
  type: "node.removed",
  actor: "you",
  payload: reparent === undefined ? { id } : { id, reparent },
});
const restore = (id: string): Draft => ({ type: "node.restored", actor: "you", payload: { id } });
const dependsOn = (from: string, to: string): Draft => ({
  type: "edge.added",
  actor: "agent",
  payload: { from, to, type: "depends_on", why: `${from} needs ${to}` },
});
const ids = (map: ReturnType<typeof fold>) => [...map.nodes.keys()].sort();

test("a removal moves its nodes out of the map, their links wait, and a restore brings them back", () => {
  const drafts = [card("root"), card("a", "root"), card("a1", "a"), card("a2", "a"), card("b", "root")];
  const removed = fold(logOf(...drafts, dependsOn("b", "a1"), remove("a")));
  expect(removed.problems).toEqual([]);
  expect(ids(removed)).toEqual(["b", "root"]);
  expect([...removed.removed.keys()]).toEqual(["a", "a1", "a2"]);
  expect(removed.removals.get("a")).toEqual({ taken: ["a", "a1", "a2"] });
  expect(removed.links).toEqual([{ from: "b", to: "root", type: "refines" }]);
  expect(removed.waiting).toHaveLength(4);
  const back = fold(logOf(...drafts, dependsOn("b", "a1"), remove("a"), restore("a")));
  expect(back.problems).toEqual([]);
  expect(ids(back)).toEqual(["a", "a1", "a2", "b", "root"]);
  expect(back.removed.size).toBe(0);
  expect(back.removals.size).toBe(0);
  expect(back.waiting).toEqual([]);
  expect(back.links).toHaveLength(5);
});

test("a reparent moves the children up, and its restore puts them back under the card", () => {
  const drafts = [card("root"), card("a", "root"), card("a1", "a"), card("a2", "a"), card("a11", "a1")];
  const removed = fold(logOf(...drafts, remove("a", true)));
  expect(removed.problems).toEqual([]);
  expect(ids(removed)).toEqual(["a1", "a11", "a2", "root"]);
  expect(removed.links).toContainEqual({ from: "a1", to: "root", type: "refines" });
  expect(removed.links).toContainEqual({ from: "a2", to: "root", type: "refines" });
  expect(removed.waiting).toEqual([{ from: "a", to: "root", type: "refines" }]);
  const back = fold(logOf(...drafts, remove("a", true), restore("a")));
  expect(back.problems).toEqual([]);
  expect(back.links).toContainEqual({ from: "a1", to: "a", type: "refines" });
  expect(back.links).toContainEqual({ from: "a2", to: "a", type: "refines" });
  expect(back.links.filter((link) => link.to === "root")).toEqual([{ from: "a", to: "root", type: "refines" }]);
});

test("a moved child removed on its own goes back under the card while it stays out", () => {
  const drafts = [card("root"), card("a", "root"), card("a1", "a")];
  const map = fold(logOf(...drafts, remove("a", true), remove("a1"), restore("a")));
  expect(map.problems).toEqual([]);
  expect(map.waiting).toEqual([{ from: "a1", to: "a", type: "refines" }]);
  expect(ids(fold(logOf(...drafts, remove("a", true), remove("a1"), restore("a"), restore("a1"))))).toEqual([
    "a",
    "a1",
    "root",
  ]);
});

test("a link waits while either end is out, whatever the order of the removals and restores", () => {
  const drafts = [card("root"), card("login", "root"), card("session", "root"), dependsOn("login", "session")];
  const link: Link = { from: "login", to: "session", type: "depends_on", why: "login needs session" };
  const steps = [remove("login"), remove("session"), restore("login")];
  const waiting = fold(logOf(...drafts, ...steps));
  expect(waiting.problems).toEqual([]);
  expect(waiting.links).not.toContainEqual(link);
  expect(waiting.waiting).toContainEqual(link);
  const back = fold(logOf(...drafts, ...steps, restore("session")));
  expect(back.links).toContainEqual(link);
  expect(back.waiting).toEqual([]);
  const other = fold(logOf(...drafts, remove("login"), remove("session"), restore("session"), restore("login")));
  expect(other.links).toContainEqual(link);
});

test("a branch removed earlier stays out when a card above it is removed and restored", () => {
  const drafts = [card("root"), card("a", "root"), card("a1", "a")];
  const map = fold(logOf(...drafts, remove("a1"), remove("a"), restore("a")));
  expect(map.problems).toEqual([]);
  expect(ids(map)).toEqual(["a", "root"]);
  expect(map.removals.get("a1")).toEqual({ taken: ["a1"] });
});

test("a ghost link to a removed card waits after the accept, and a discard drops a waiting link", () => {
  const drafts = [card("root"), card("a", "root"), card("g", "root", "node.proposed"), dependsOn("g", "a")];
  const accepted = fold(logOf(...drafts, remove("a"), { type: "change.accepted", actor: "you", payload: { id: "g" } }));
  expect(accepted.waiting).toContainEqual({ from: "g", to: "a", type: "depends_on", why: "g needs a" });
  const discarded = fold(
    logOf(...drafts, remove("a"), { type: "change.discarded", actor: "agent", payload: { id: "g" } }),
  );
  expect(discarded.waiting).toEqual([{ from: "a", to: "root", type: "refines" }]);
});

test("a copy keeps its removals apart from the original", () => {
  const map = fold(logOf(card("root"), card("a", "root"), card("b", "root"), remove("a", true)));
  const copy = copyMap(map);
  step(copy, { seq: 9, at: "t", ...restore("a") } as never);
  expect(map.removals.get("a")).toEqual({ taken: ["a"] });
  expect(map.removed.has("a")).toBe(true);
  expect(copy.removed.size).toBe(0);
  const moved = fold(logOf(card("root"), card("a", "root"), card("a1", "a"), remove("a", true)));
  const movedCopy = copyMap(moved);
  movedCopy.removals.get("a")?.moved?.children.push("x");
  expect(moved.removals.get("a")?.moved).toEqual({ children: ["a1"], to: "root" });
});

test("a decide, an edit and each kill criterion change the card they name", () => {
  const map = fold(
    logOf(
      card("a"),
      { type: "node.edited", actor: "agent", payload: { id: "a", who: "you", unchallenged: "no real choice" } },
      { type: "node.edited", actor: "agent", payload: { id: "a", no_basis: "a root" } },
      { type: "kill.added", actor: "agent", payload: { id: "a", criterion: { form: "revisit" } } },
      { type: "kill.added", actor: "agent", payload: { id: "a", criterion: { form: "manual", test: "use it" } } },
      { type: "node.decided", actor: "agent", payload: { id: "a" } },
    ),
  );
  expect(map.problems).toEqual([]);
  expect(map.nodes.get("a")).toEqual({
    id: "a",
    kind: "card",
    title: "Card a",
    status: "decided",
    proposed: false,
    who: "you",
    unchallenged: "no real choice",
    no_basis: "a root",
    kill: [{ form: "revisit" }, { form: "manual", test: "use it" }],
  });
});

test("a kill criterion added to a copy leaves the original's criteria alone", () => {
  const map = fold(
    logOf(card("a"), { type: "kill.added", actor: "agent", payload: { id: "a", criterion: { form: "revisit" } } }),
  );
  const copy = copyMap(map);
  step(copy, {
    seq: 3,
    at: "t",
    type: "kill.added",
    actor: "agent",
    payload: { id: "a", criterion: { form: "revisit" } },
  } as never);
  expect(map.nodes.get("a")?.kill).toHaveLength(1);
  expect(copy.nodes.get("a")?.kill).toHaveLength(2);
});

test("a proposal waits on a real node until an accept or an amend takes it, or a discard drops it", () => {
  const body = {
    type: "node.added",
    actor: "agent",
    payload: { id: "p", kind: "card", title: "P", why: "W", body: "One.\n\nTwo." },
  } as Draft;
  const proposal: Draft = {
    type: "change.proposed",
    actor: "agent",
    payload: {
      id: "p",
      title: "P2",
      ops: [
        { tag: "elaborated", old: "One.", new: "One, again." },
        { tag: "removed", old: "Two." },
      ],
    },
  };
  const decide: Draft = { type: "node.decided", actor: "agent", payload: { id: "p" } };
  const pending = fold(logOf(body, proposal));
  expect(pending.nodes.get("p")).toMatchObject({
    title: "P",
    body: "One.\n\nTwo.",
    pending: { title: "P2", ops: proposal.payload.ops },
  });

  const accepted = fold(logOf(body, proposal, { type: "change.accepted", actor: "you", payload: { id: "p" } }));
  expect(accepted.problems).toEqual([]);
  expect(accepted.nodes.get("p")).toEqual({
    id: "p",
    kind: "card",
    title: "P2",
    why: "W",
    body: "One, again.",
    status: "open",
    proposed: false,
  });

  const amended = fold(
    logOf(
      body,
      decide,
      {
        type: "change.proposed",
        actor: "agent",
        payload: {
          id: "p",
          why: "W2",
          ops: [
            { tag: "removed", old: "One." },
            { tag: "removed", old: "Two." },
          ],
        },
      },
      { type: "change.accepted", actor: "you", payload: { id: "p" } },
    ),
  );
  expect(amended.problems).toEqual([]);
  expect(amended.nodes.get("p")).toEqual({
    id: "p",
    kind: "card",
    title: "P",
    why: "W2",
    status: "decided",
    proposed: false,
  });

  const discarded = fold(logOf(body, proposal, { type: "change.discarded", actor: "agent", payload: { id: "p" } }));
  expect(discarded.nodes.get("p")).toEqual(fold(logOf(body)).nodes.get("p"));
});

test("a thread belongs to the id: a discard keeps it, and a new proposal adds one marker", () => {
  const note = (text: string): Draft => ({ type: "note.added", actor: "you", payload: { id: "g", text } });
  const discard: Draft = { type: "change.discarded", actor: "agent", payload: { id: "g" } };
  const map = fold(
    logOf(
      card("root"),
      card("g", "root", "node.proposed"),
      note("first"),
      discard,
      card("g", "root", "node.proposed"),
      note("second"),
    ),
  );
  expect(map.problems).toEqual([]);
  expect(map.threads.get("g")).toEqual([
    { kind: "note", seq: 3, at: "2026-10-25T00:00:00.000Z", actor: "you", text: "first" },
    { kind: "proposed again", seq: 5, at: "2026-10-25T00:00:00.000Z" },
    { kind: "note", seq: 6, at: "2026-10-25T00:00:00.000Z", actor: "you", text: "second" },
  ]);
});

test("a first proposal adds no marker, and a copy of the map has its own threads", () => {
  const map = fold(logOf(card("root"), card("g", "root", "node.proposed")));
  expect(map.threads.size).toBe(0);
  const withNote = fold(logOf(card("g"), { type: "note.added", actor: "agent", payload: { id: "g", text: "hi" } }));
  const copy = copyMap(withNote);
  copy.threads.get("g")?.push({ kind: "proposed again", seq: 9, at: "t" });
  expect(withNote.threads.get("g")).toHaveLength(1);
});

test("a quote folds into a ghost excerpt with its pointer and a held link from the citing card", () => {
  const quoted = {
    seq: 2,
    at: "t",
    actor: "agent",
    type: "excerpt.quoted",
    payload: {
      id: "x:ex0",
      title: "seats",
      card: "x",
      conversation: "pricing",
      session: "s-1",
      message: 12,
      start: 0,
      end: 5,
      speaker: "person",
      said_at: "t12",
    },
  };
  const root = { seq: 1, at: "t", actor: "you", type: "node.added", payload: { id: "x", kind: "card", title: "X" } };
  const map = fold([root, quoted].map((e) => JSON.stringify(e)).join("\n"));
  expect(map.problems).toEqual([]);
  expect(map.nodes.get("x:ex0")).toEqual({
    id: "x:ex0",
    kind: "excerpt",
    title: "seats",
    conversation: "pricing",
    session: "s-1",
    message: 12,
    start: 0,
    end: 5,
    speaker: "person",
    said_at: "t12",
    status: "open",
    proposed: true,
  });
  expect(map.links).toEqual([]);
  expect(map.ghostEdges).toEqual([{ from: "x", to: "x:ex0", type: "supported_by" }]);
  const again = fold(
    [
      root,
      quoted,
      { seq: 3, at: "t", actor: "agent", type: "change.discarded", payload: { id: "x:ex0" } },
      { ...quoted, seq: 4 },
    ]
      .map((e) => JSON.stringify(e))
      .join("\n"),
  );
  expect(again.threads.get("x:ex0")).toEqual([{ kind: "proposed again", seq: 4, at: "t" }]);
});
