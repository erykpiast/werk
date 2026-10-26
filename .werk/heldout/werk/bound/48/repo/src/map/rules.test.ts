import { describe, expect, test } from "bun:test";
import { fold } from "./fold.ts";
import { check } from "./rules.ts";
import type { Draft, Event, FoldedMap } from "./types.ts";

const card = (id: string, parent?: string): Draft => ({
  type: "node.added",
  actor: "agent",
  payload: { id, kind: "card", title: `Card ${id}`, ...(parent === undefined ? {} : { parent }) },
});
const ghost = (id: string, parent?: string, kind: "card" | "option" | "source" | "excerpt" = "card"): Draft => ({
  type: "node.proposed",
  actor: "agent",
  payload: { id, kind, title: `Ghost ${id}`, ...(parent === undefined ? {} : { parent }) },
});
const link = (from: string, to: string, type: string, why?: string) =>
  ({ type: "edge.added", actor: "agent", payload: { from, to, type, ...(why === undefined ? {} : { why }) } }) as Draft;

function mapOf(...drafts: Draft[]): FoldedMap {
  const map = fold(drafts.map((d, i) => JSON.stringify({ seq: i + 1, at: "t", ...d })).join("\n"));
  expect(map.problems).toEqual([]);
  return map;
}
const ev = (draft: Draft) => ({ seq: 99, at: "t", ...draft }) as Event;
const rule = (map: FoldedMap, draft: Draft) => check(map, ev(draft));

// root
//  ├ a
//  │ └ a1
//  └ b         g (ghost under b)   o (option)   s (source)
const base = () =>
  mapOf(
    card("root"),
    card("a", "root"),
    card("a1", "a"),
    card("b", "root"),
    ghost("g", "b"),
    { type: "node.added", actor: "agent", payload: { id: "o", kind: "option", title: "Option", why_not: "slow" } },
    { type: "node.added", actor: "agent", payload: { id: "s", kind: "source", title: "Survey" } },
  );

describe("a new node", () => {
  test("may sit under a real or a ghost card", () => {
    expect(rule(base(), card("c", "a"))).toBeUndefined();
    expect(rule(base(), ghost("c", "g"))).toBeUndefined();
    expect(rule(base(), card("c"))).toBeUndefined();
  });

  test("needs an id, a known kind and a title, and valid fields", () => {
    const map = base();
    expect(rule(map, { type: "node.added", actor: "agent", payload: { id: "", kind: "card", title: "x" } })).toBe(
      "a node needs an id",
    );
    expect(
      rule(map, { type: "node.added", actor: "agent", payload: { id: "x", kind: "idea" as never, title: "x" } }),
    ).toBe("a node's kind is one of card, option, source, excerpt");
    expect(rule(map, { type: "node.added", actor: "agent", payload: { id: "x", kind: "card", title: "" } })).toBe(
      "a node needs a title",
    );
    const bad = (extra: object) =>
      rule(map, { type: "node.added", actor: "agent", payload: { id: "x", kind: "card", title: "x", ...extra } });
    expect(bad({ status: "done" })).toBe("a status is one of open, proto, decided");
    expect(bad({ who: "them" })).toBe("who is one of you, me, prototype");
    expect(bad({ why: 3 })).toBe("a node's why is text");
    expect(bad({ status: "proto", who: "me", why: "w" })).toBeUndefined();
  });

  test("cannot take an id that a node holds; a ghost's words are frozen", () => {
    expect(rule(base(), card("a"))).toBe("#a already exists");
    expect(rule(base(), ghost("g", "b"))).toBe(
      "a ghost's words are frozen: #g is proposed; discard it and propose it again",
    );
  });

  test("needs a parent that exists and is a card", () => {
    expect(rule(base(), card("c", "nope"))).toBe("unknown node #nope");
    expect(rule(base(), card("c", "o"))).toBe("refines links a card to a card");
    expect(rule(base(), ghost("o2", "a", "option"))).toBe("refines links a card to a card");
  });

  test("a real card cannot sit under a ghost", () => {
    expect(rule(base(), card("c", "g"))).toBe("a real card cannot sit under a ghost: #g is proposed and not accepted");
  });
});

describe("a refines link", () => {
  test("gives a card one parent", () => {
    expect(rule(base(), link("a1", "b", "refines"))).toBe("one parent per card: #a1 already refines #a");
    expect(rule(base(), link("a1", "a", "refines"))).toBeUndefined();
    expect(rule(base(), link("b", "a", "refines"))).toBe("one parent per card: #b already refines #root");
  });

  test("never closes a loop", () => {
    expect(rule(base(), link("root", "a1", "refines"))).toBe("no cycle: #a1 already sits below #root");
    expect(rule(base(), link("a", "a", "refines"))).toBe("a node cannot link to itself");
  });

  test("never puts a real card under a ghost, but a ghost may move under a ghost", () => {
    const map = mapOf(card("root"), ghost("g"), card("x"), ghost("h"));
    expect(rule(map, link("x", "g", "refines"))).toBe(
      "a real card cannot sit under a ghost: #g is proposed and not accepted",
    );
    expect(rule(map, link("h", "g", "refines"))).toBeUndefined();
  });
});

describe("a depends_on link", () => {
  test("needs a reason", () => {
    expect(rule(base(), link("a1", "b", "depends_on"))).toBe(
      "a depends_on link needs a reason: what the card takes from the other card",
    );
    expect(rule(base(), link("a1", "b", "depends_on", ""))).toContain("needs a reason");
    expect(rule(base(), link("a1", "b", "depends_on", "uses its grid"))).toBeUndefined();
  });

  test("never points to an ancestor or a descendant", () => {
    expect(rule(base(), link("a1", "root", "depends_on", "w"))).toBe(
      "a depends_on link cannot point to an ancestor: #root is above #a1",
    );
    expect(rule(base(), link("a", "a1", "depends_on", "w"))).toBe(
      "a depends_on link cannot point to a descendant: #a1 is below #a",
    );
  });

  test("links a card to a card", () => {
    expect(rule(base(), link("a", "s", "depends_on", "w"))).toBe("depends_on links a card to a card");
  });
});

describe("an option", () => {
  test("has only alternative_to links, to one card", () => {
    expect(rule(base(), link("o", "a", "alternative_to"))).toBeUndefined();
    expect(rule(base(), link("o", "a", "refines"))).toBe("an option has only alternative_to links");
    expect(rule(base(), link("a", "o", "depends_on", "w"))).toBe(
      "an option has only alternative_to links, from the option to its card",
    );
    const chosen = mapOf(
      ...[card("a"), card("b")],
      {
        type: "node.added",
        actor: "agent",
        payload: { id: "o", kind: "option", title: "O" },
      },
      link("o", "a", "alternative_to"),
    );
    expect(rule(chosen, link("o", "a", "alternative_to"))).toBeUndefined();
    expect(rule(chosen, link("o", "b", "alternative_to"))).toBe(
      "an option has one alternative_to link: #o is already an option of #a",
    );
  });

  test("alternative_to links an option to a card", () => {
    expect(rule(base(), link("a", "b", "alternative_to"))).toBe("alternative_to links an option to a card");
  });
});

describe("a link", () => {
  test("names a known type and two known nodes", () => {
    expect(rule(base(), link("a", "b", "relates"))).toBe(
      "a link's type is one of refines, depends_on, supported_by, alternative_to",
    );
    expect(rule(base(), link("x", "b", "refines"))).toBe("unknown node #x");
    expect(rule(base(), link("a", "x", "refines"))).toBe("unknown node #x");
  });

  test("supported_by links a card to a source or an excerpt", () => {
    expect(rule(base(), link("a", "s", "supported_by"))).toBeUndefined();
    expect(rule(base(), link("a", "b", "supported_by"))).toBe("supported_by links a card to a source or an excerpt");
  });

  test("a removal needs the link to exist", () => {
    const map = base();
    expect(
      rule(map, { type: "edge.removed", actor: "agent", payload: { from: "a1", to: "a", type: "refines" } }),
    ).toBeUndefined();
    expect(
      rule(map, { type: "edge.removed", actor: "agent", payload: { from: "a", to: "b", type: "depends_on" } }),
    ).toBe("no depends_on link from #a to #b");
  });
});

describe("an accept and a discard", () => {
  const accept = (id: string): Draft => ({ type: "change.accepted", actor: "you", payload: { id } });
  const discard = (id: string): Draft => ({ type: "change.discarded", actor: "agent", payload: { id } });

  test("apply only to a ghost", () => {
    expect(rule(base(), accept("g"))).toBeUndefined();
    expect(rule(base(), discard("g"))).toBeUndefined();
    expect(rule(base(), accept("a"))).toBe(
      "only a ghost or a pending change can be accepted: #a is real and has no pending change",
    );
    expect(rule(base(), discard("a"))).toBe(
      "only a ghost or a pending change can be discarded: #a is real and has no pending change",
    );
    expect(rule(base(), accept("x"))).toBe("unknown node #x");
  });

  test("an accept under a ghost parent is refused until the parent is real", () => {
    const map = mapOf(card("root"), ghost("p", "root"), ghost("c", "p"));
    expect(rule(map, accept("c"))).toBe("a real card cannot sit under a ghost: #p is proposed and not accepted");
    expect(rule(map, discard("c"))).toBeUndefined();
  });
});

describe("a proposal", () => {
  const propose = (payload: Record<string, unknown>): Draft =>
    ({ type: "change.proposed", actor: "agent", payload }) as Draft;
  const withBody = () =>
    mapOf(
      card("root"),
      {
        type: "node.added",
        actor: "agent",
        payload: { id: "p", kind: "card", title: "P", body: "One.\n\nTwo.\n\nThree.", parent: "root" },
      },
      ghost("g", "root"),
    );

  test("names a real node and changes its title, its why or its body", () => {
    expect(rule(withBody(), propose({ id: "p", title: "New P" }))).toBeUndefined();
    expect(rule(withBody(), propose({ id: "p", why: "Because." }))).toBeUndefined();
    expect(rule(withBody(), propose({ id: "p" }))).toBe("a proposal changes the title, the why or the body");
    expect(rule(withBody(), propose({ id: "p", title: "" }))).toBe("a node needs a title");
    expect(rule(withBody(), propose({ id: "p", why: 3 }))).toBe("a node's why is text");
    expect(rule(withBody(), propose({ id: "x", title: "X" }))).toBe("unknown node #x");
    expect(rule(withBody(), propose({ id: "g", title: "G" }))).toBe(
      "a ghost's words are frozen: #g is proposed; discard it and propose it again",
    );
  });

  test("needs ops of a known shape, and refuses an op list that leaves a block unnamed", () => {
    expect(rule(withBody(), propose({ id: "p", ops: "x" }))).toBe("the ops are a list");
    const all = [
      { tag: "elaborated", old: "One.", new: "One, reworded." },
      { tag: "removed", old: "Two." },
      { tag: "elaborated", old: "Three.", new: "Three." },
    ];
    expect(rule(withBody(), propose({ id: "p", ops: all }))).toBeUndefined();
    expect(rule(withBody(), propose({ id: "p", ops: [all[0], all[2]] }))).toBe(
      "every block of the body of #p must be the old of an elaborated or removed op; this block is at risk:\n    Two.",
    );
    expect(rule(withBody(), propose({ id: "p", ops: [{ tag: "new", new: "Four." }] }))).toBe(
      "every block of the body of #p must be the old of an elaborated or removed op; these blocks are at risk:\n" +
        "    One.\n\n    Two.\n\n    Three.",
    );
  });

  test("an accept checks the cover rule again, so a block written after the proposal is never lost", () => {
    const accept: Draft = { type: "change.accepted", actor: "you", payload: { id: "p" } };
    const discard: Draft = { type: "change.discarded", actor: "agent", payload: { id: "p" } };
    const ops = [
      { tag: "elaborated", old: "One.", new: "One." },
      { tag: "elaborated", old: "Two.", new: "Two." },
      { tag: "removed", old: "Three." },
    ];
    const edited = mapOf(
      card("root"),
      {
        type: "node.added",
        actor: "agent",
        payload: { id: "p", kind: "card", title: "P", body: "One.\n\nTwo.\n\nThree.", parent: "root" },
      },
      propose({ id: "p", ops }),
      { type: "node.bodyEdited", actor: "agent", payload: { id: "p", body: "One.\n\nTwo.\n\nThree.\n\nFour." } },
    );
    expect(rule(edited, accept)).toBe(
      "every block of the body of #p must be the old of an elaborated or removed op; this block is at risk:\n    Four.",
    );
    expect(rule(edited, discard)).toBeUndefined();
  });

  test("an accept or a discard takes the pending change of a real card, open or decided", () => {
    const accept = (id: string): Draft => ({ type: "change.accepted", actor: "you", payload: { id } });
    const discard = (id: string): Draft => ({ type: "change.discarded", actor: "agent", payload: { id } });
    const decided = { type: "node.decided", actor: "agent", payload: { id: "p" } } as Draft;
    const open = mapOf(card("root"), card("p", "root"), propose({ id: "p", title: "New" }));
    expect(rule(open, accept("p"))).toBeUndefined();
    expect(rule(open, discard("p"))).toBeUndefined();
    const closed = mapOf(card("root"), card("p", "root"), decided, propose({ id: "p", title: "New" }));
    expect(rule(closed, accept("p"))).toBeUndefined();
    expect(rule(closed, discard("p"))).toBeUndefined();
    expect(rule(open, accept("root"))).toBe(
      "only a ghost or a pending change can be accepted: #root is real and has no pending change",
    );
    expect(rule(open, discard("root"))).toBe(
      "only a ghost or a pending change can be discarded: #root is real and has no pending change",
    );
  });
});

describe("a change of words", () => {
  test("refuses on a ghost, and works on a real node", () => {
    const retitle = (id: string, title: string): Draft => ({
      type: "node.retitled",
      actor: "agent",
      payload: { id, title },
    });
    const edit = (id: string): Draft => ({ type: "node.bodyEdited", actor: "agent", payload: { id, body: "new" } });
    expect(rule(base(), retitle("g", "New"))).toBe(
      "a ghost's words are frozen: #g is proposed; discard it and propose it again",
    );
    expect(rule(base(), edit("g"))).toContain("frozen");
    expect(rule(base(), retitle("a", "New"))).toBeUndefined();
    expect(rule(base(), retitle("a", ""))).toBe("a node needs a title");
    expect(rule(base(), edit("a"))).toBeUndefined();
    expect(rule(base(), edit("x"))).toBe("unknown node #x");
  });
});

const remove = (id: string, reparent?: unknown): Draft =>
  ({ type: "node.removed", actor: "you", payload: reparent === undefined ? { id } : { id, reparent } }) as Draft;
const restore = (id: unknown): Draft => ({ type: "node.restored", actor: "you", payload: { id } }) as Draft;
describe("a removal", () => {
  // `base` with a removed: root ─ a ─ a1 out with a, b ─ g in the map.
  const removed = () =>
    mapOf(
      card("root"),
      card("a", "root"),
      card("a1", "a"),
      card("b", "root"),
      ghost("g", "b"),
      { type: "node.added", actor: "agent", payload: { id: "o", kind: "option", title: "Option", why_not: "slow" } },
      { type: "node.added", actor: "agent", payload: { id: "s", kind: "source", title: "Survey" } },
      {
        type: "excerpt.quoted",
        actor: "agent",
        payload: {
          id: "e",
          title: "Quote",
          card: "b",
          conversation: "c",
          session: "s",
          message: 0,
          start: 0,
          end: 5,
          speaker: "person",
          said_at: "t",
        },
      } as Draft,
      remove("a"),
    );

  test("names a card in the map, ghost or real", () => {
    expect(rule(base(), remove("a"))).toBeUndefined();
    expect(rule(base(), remove("g"))).toBeUndefined();
    expect(rule(base(), remove("nope"))).toBe("unknown node #nope");
    expect(rule(base(), remove("o"))).toBe("a removal names a card: #o is an option, and it goes with its card");
    expect(rule(base(), remove("s"))).toBe("a removal names a card: #s is a source, and it goes with its card");
    expect(rule(removed(), remove("e"))).toBe("a removal names a card: #e is an excerpt, and it goes with its card");
    expect(rule(removed(), remove("a"))).toBe("#a is removed; restore #a first");
    expect(rule(removed(), remove("a1"))).toBe("#a1 is removed with #a; restore #a first");
  });

  test("with a reparent, moves children only to a parent the card has", () => {
    expect(rule(base(), remove("a", true))).toBeUndefined();
    expect(rule(base(), remove("a1", true))).toBeUndefined();
    expect(rule(base(), remove("root", true))).toBe(
      "a reparent moves the children up to the card's parent, and #root has none",
    );
    expect(rule(base(), remove("a", "yes"))).toBe("reparent is true or false");
    expect(rule(mapOf(card("root")), remove("root", true))).toBeUndefined();
  });

  test("keeps the id taken, and a node out of the map takes no link or change", () => {
    const map = removed();
    expect(rule(map, card("a1", "root"))).toBe("#a1 is removed, and its id stays taken; restore #a to bring it back");
    expect(rule(map, card("c", "a"))).toBe("#a is removed; restore #a first");
    expect(rule(map, link("b", "a1", "depends_on", "uses it"))).toBe("#a1 is removed with #a; restore #a first");
    expect(rule(map, link("a", "b", "depends_on", "uses it"))).toBe("#a is removed; restore #a first");
    expect(rule(map, { type: "change.accepted", actor: "you", payload: { id: "a" } })).toBe(
      "#a is removed; restore #a first",
    );
    expect(rule(map, { type: "node.retitled", actor: "agent", payload: { id: "a1", title: "x" } })).toBe(
      "#a1 is removed with #a; restore #a first",
    );
    expect(rule(map, { type: "node.edited", actor: "agent", payload: { id: "a1", who: "me" } })).toBe(
      "#a1 is removed with #a; restore #a first",
    );
    expect(rule(map, { type: "note.added", actor: "you", payload: { id: "a1", text: "Hi" } })).toBe(
      "#a1 is removed with #a; restore #a first",
    );
  });
});

describe("a restore", () => {
  test("names the card that its removal named", () => {
    const map = mapOf(card("root"), card("a", "root"), card("a1", "a"), remove("a"));
    expect(rule(map, restore("a"))).toBeUndefined();
    expect(rule(map, restore("a1"))).toBe("#a1 is removed with #a; restore #a first");
    expect(rule(map, restore("root"))).toBe("#root is in the map, not removed");
    expect(rule(map, restore("nope"))).toBe("unknown node #nope");
    expect(rule(map, restore(3))).toBe("a restore names a card");
  });

  test("refuses while the card's parent is out of the map", () => {
    const map = mapOf(card("root"), card("a", "root"), card("a1", "a"), remove("a1"), remove("a"));
    expect(rule(map, restore("a1"))).toBe(
      "#a1 sits under #a, which is out of the map: #a is removed; restore #a first",
    );
    expect(rule(mapOf(card("root"), card("a", "root"), remove("a")), restore("a"))).toBeUndefined();
    expect(rule(mapOf(card("root"), remove("root")), restore("root"))).toBeUndefined();
  });
});

describe("a record on a card", () => {
  const edit = (payload: object): Draft => ({ type: "node.edited", actor: "agent", payload }) as Draft;
  const kill = (id: string, criterion: object): Draft =>
    ({ type: "kill.added", actor: "agent", payload: { id, criterion } }) as Draft;
  const decide = (id: string): Draft => ({ type: "node.decided", actor: "agent", payload: { id } });

  test("applies to a card only, real or ghost", () => {
    expect(rule(base(), edit({ id: "g", who: "me" }))).toBeUndefined();
    expect(rule(base(), edit({ id: "x", who: "me" }))).toBe("unknown node #x");
    expect(rule(base(), edit({ id: "o", who: "me" }))).toBe(
      "only a card carries who, waivers, kill criteria and a decide: #o is of kind option",
    );
    expect(rule(base(), kill("s", { form: "revisit" }))).toContain("#s is of kind source");
    expect(rule(base(), decide("o"))).toContain("#o is of kind option");
  });

  test("an edit sets who or a waiver with a written reason, and nothing else", () => {
    expect(rule(base(), edit({ id: "a", who: "you", no_basis: "a root", unchallenged: "no choice" }))).toBeUndefined();
    expect(rule(base(), edit({ id: "a" }))).toBe("an edit sets who or records a waiver");
    expect(rule(base(), edit({ id: "a", title: "New" }))).toBe(
      "an edit sets only who, no_basis, unchallenged, not title",
    );
    expect(rule(base(), edit({ id: "a", who: "them" }))).toBe("who is one of you, me, prototype");
    expect(rule(base(), edit({ id: "a", no_basis: "" }))).toBe(
      "a waiver needs a written reason: the basis waiver of #a has none",
    );
    expect(rule(base(), edit({ id: "a", unchallenged: "  " }))).toBe(
      "a waiver needs a written reason: the option waiver of #a has none",
    );
    expect(rule(base(), edit({ id: "a", unchallenged: 3 }))).toContain("the option waiver of #a has none");
  });

  test("a kill criterion has a known form and every word that form needs", () => {
    expect(rule(base(), kill("a", { form: "revisit" }))).toBeUndefined();
    expect(rule(base(), kill("a", { form: "manual", test: "I use it weekly" }))).toBeUndefined();
    expect(rule(base(), kill("a", { form: "no-metric", reason: "cheap to undo" }))).toBeUndefined();
    const metric = { form: "metric", metric: "install time", source: "PostHog", threshold: "> 4 min", window: "7d" };
    expect(rule(base(), kill("a", metric))).toBeUndefined();
    expect(rule(base(), kill("a", { ...metric, window: "" }))).toBe("a metric kill criterion needs its window");
    expect(rule(base(), kill("a", { form: "manual" }))).toBe("a manual kill criterion needs its test");
    expect(rule(base(), kill("a", { form: "hunch" }))).toBe(
      "a kill criterion's form is one of metric, manual, no-metric, revisit",
    );
    expect(rule(base(), kill("a", null as never))).toContain("form is one of");
  });

  test("a decide applies to a card that is not decided yet", () => {
    expect(rule(base(), decide("a"))).toBeUndefined();
    const map = mapOf(card("root"), decide("root"));
    expect(rule(map, decide("root"))).toBe("#root is already decided");
  });
});

test("an event needs a payload and a known type", () => {
  expect(check(base(), { seq: 1, at: "t", actor: "agent", type: "node.added" } as unknown as Event)).toBe(
    "an event needs a payload",
  );
  expect(
    check(base(), { seq: 1, at: "t", actor: "agent", type: "card.painted", payload: {} } as unknown as Event),
  ).toBe("unknown event type card.painted");
});

test("a note needs a node and text, and any node kind takes one", () => {
  const map = mapOf(card("root"), {
    type: "excerpt.quoted",
    actor: "agent",
    payload: {
      id: "e",
      title: "Q",
      card: "root",
      conversation: "c",
      session: "s",
      message: 0,
      start: 0,
      end: 1,
      speaker: "person",
      said_at: "t",
    },
  } as Draft);
  const note = (id: string, text: string): Draft => ({ type: "note.added", actor: "agent", payload: { id, text } });
  expect(rule(map, note("e", "On the quote"))).toBeUndefined();
  expect(rule(map, note("root", "On the root"))).toBeUndefined();
  expect(rule(map, note("nowhere", "Hi"))).toBe("unknown node #nowhere");
  expect(rule(map, note("root", ""))).toBe("a note needs text");
});

describe("an excerpt", () => {
  const quote = (extra: object = {}): Draft => ({
    type: "excerpt.quoted",
    actor: "agent",
    payload: {
      id: "a:ex0",
      title: "pick a grid",
      card: "a",
      conversation: "c",
      session: "s-1",
      message: 3,
      start: 3,
      end: 14,
      speaker: "person",
      said_at: "t3",
      ...extra,
    },
  });

  test("comes only from a quote, never from a plain add", () => {
    expect(rule(base(), ghost("e", "a", "excerpt"))).toBe("only a quote creates an excerpt");
    expect(
      rule(base(), { type: "node.added", actor: "agent", payload: { id: "e", kind: "excerpt", title: "E" } }),
    ).toBe("only a quote creates an excerpt");
  });

  test("comes from a quote with a new id, a citing card, and a span as long as its words", () => {
    const map = base();
    expect(rule(map, quote())).toBeUndefined();
    expect(rule(map, quote({ card: "g" }))).toBeUndefined();
    expect(rule(map, quote({ id: "a1" }))).toBe("#a1 already exists");
    expect(rule(map, quote({ card: "nowhere" }))).toBe("unknown node #nowhere");
    expect(rule(map, quote({ card: "s" }))).toBe("supported_by links a card to a source or an excerpt");
    expect(rule(map, quote({ title: "" }))).toBe("a node needs a title");
    expect(rule(map, quote({ session: "" }))).toBe("an excerpt's pointer needs its session");
    expect(rule(map, quote({ start: -1 }))).toBe("an excerpt's message, start and end are positions from zero");
    expect(rule(map, quote({ message: 1.5 }))).toBe("an excerpt's message, start and end are positions from zero");
    expect(rule(map, quote({ end: 15 }))).toBe("an excerpt's span is as long as its words");
  });

  test("never changes its words, before or after the accept, and still takes a note", () => {
    const words = "an excerpt's words never change: #a:ex0 holds the words its quote matched";
    const quoted = fold(
      [
        { seq: 1, at: "t", ...card("a") },
        { seq: 2, at: "t", ...quote() },
      ]
        .map((e) => JSON.stringify(e))
        .join("\n"),
    );
    expect(quoted.problems).toEqual([]);
    const accepted = fold(
      [
        { seq: 1, at: "t", ...card("a") },
        { seq: 2, at: "t", ...quote() },
        { seq: 3, at: "t", type: "change.accepted", actor: "you", payload: { id: "a:ex0" } },
      ]
        .map((e) => JSON.stringify(e))
        .join("\n"),
    );
    expect(accepted.nodes.get("a:ex0")?.proposed).toBe(false);
    for (const map of [quoted, accepted]) {
      expect(rule(map, { type: "node.retitled", actor: "agent", payload: { id: "a:ex0", title: "we bill" } })).toBe(
        words,
      );
      expect(rule(map, { type: "node.bodyEdited", actor: "agent", payload: { id: "a:ex0", body: "x" } })).toBe(words);
      expect(rule(map, { type: "change.proposed", actor: "agent", payload: { id: "a:ex0", title: "we bill" } })).toBe(
        words,
      );
      expect(rule(map, { type: "note.added", actor: "you", payload: { id: "a:ex0", text: "right quote?" } })).toBe(
        undefined,
      );
    }
  });
});
