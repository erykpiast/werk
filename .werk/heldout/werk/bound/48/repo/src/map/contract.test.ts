import { describe, expect, test } from "bun:test";
import { contractRefusal, gaps } from "./contract.ts";
import { copyMap, fold, step } from "./fold.ts";
import type { Draft, Event, FoldedMap, NodeFields } from "./types.ts";

const ev = (draft: Draft, seq = 99) => ({ seq, at: "t", ...draft }) as Event;
const mapOf = (...drafts: Draft[]): FoldedMap => {
  const map = fold(drafts.map((d, i) => JSON.stringify(ev(d, i + 1))).join("\n"));
  expect(map.problems).toEqual([]);
  return map;
};
const card = (id: string, extra: Partial<NodeFields> & { parent?: string } = {}): Draft => ({
  type: "node.added",
  actor: "agent",
  payload: { id, kind: "card", title: `Card ${id}`, ...extra },
});
const option = (id: string, of: string): Draft[] => [
  { type: "node.added", actor: "agent", payload: { id, kind: "option", title: `Option ${id}`, why_not: "slower" } },
  { type: "edge.added", actor: "agent", payload: { from: id, to: of, type: "alternative_to" } },
];
const revisit = (id: string): Draft => ({
  type: "kill.added",
  actor: "agent",
  payload: { id, criterion: { form: "revisit" } },
});
const decide = (id: string): Draft => ({ type: "node.decided", actor: "agent", payload: { id } });
const facts = (map: FoldedMap, id: string) => gaps(map, id).map((gap) => gap.fact);

/** Applies `drafts` to a copy of `before` and returns the contract's refusal, as a write would. */
function refusal(before: FoldedMap, ...drafts: Draft[]): string | undefined {
  const after = copyMap(before);
  const events = drafts.map((draft) => ev(draft));
  for (const event of events) expect(step(after, event)).toBeUndefined();
  return contractRefusal(before, after, events);
}

// root: decided, who me, basis waived, revisit.
const rootDrafts: Draft[] = [card("root", { status: "decided", who: "me" }), revisit("root")];

describe("the four facts", () => {
  test("a bare card misses who, basis, option and kill criterion, in that order", () => {
    const map = mapOf(card("x"));
    expect(facts(map, "x")).toEqual(["who", "basis", "option", "kill criterion"]);
    const [who, basis, opt, kill] = gaps(map, "x");
    expect(who?.fixes).toEqual(["werk edit x --who you|me|prototype"]);
    expect(basis?.fixes).toEqual([
      'werk link x <card> --type depends_on --why "<what x takes from <card>>"',
      'or: werk edit x --no-basis "<why no decided card is a basis of x>"',
    ]);
    expect(opt?.problem).toBe("no option was weighed against #x, and its who is not set");
    expect(opt?.fixes[0]).toBe('werk add x:opt0 --kind option --title "<the option>" --why_not "<why it lost>"');
    expect(kill?.fixes.at(-1)).toBe("or: werk kill x --revisit");
  });

  test("a card with who me or prototype needs no option; who you needs one", () => {
    expect(facts(mapOf(card("x", { who: "me" })), "x")).not.toContain("option");
    expect(facts(mapOf(card("x", { who: "prototype" })), "x")).not.toContain("option");
    expect(facts(mapOf(card("x", { who: "you" })), "x")).toContain("option");
  });

  test("an option, or an option waiver, holds the option fact", () => {
    expect(facts(mapOf(card("x", { who: "you" }), ...option("x:opt0", "x")), "x")).not.toContain("option");
    const waived = mapOf(card("x", { who: "you" }), {
      type: "node.edited",
      actor: "agent",
      payload: { id: "x", unchallenged: "no real choice" },
    });
    expect(facts(waived, "x")).not.toContain("option");
  });

  test("the option fix names the first free option id", () => {
    const map = mapOf(card("x"), card("y"), ...option("x:opt0", "y"));
    expect(gaps(map, "x")[2]?.fixes[1]).toBe("then: werk link x:opt1 x --type alternative_to");
  });

  test("a decided parent, a decided depends_on target or a basis waiver holds the basis", () => {
    expect(facts(mapOf(...rootDrafts, card("x", { parent: "root" })), "x")).not.toContain("basis");
    const dep = mapOf(...rootDrafts, card("x"), {
      type: "edge.added",
      actor: "agent",
      payload: { from: "x", to: "root", type: "depends_on", why: "uses it" },
    });
    expect(facts(dep, "x")).not.toContain("basis");
    const waived = mapOf(card("x"), { type: "node.edited", actor: "agent", payload: { id: "x", no_basis: "a root" } });
    expect(facts(waived, "x")).not.toContain("basis");
  });

  test("a card on an open basis waits, and the gap names each open basis", () => {
    const map = mapOf(card("root"), card("b", { status: "proto" }), card("x", { parent: "root" }), {
      type: "edge.added",
      actor: "agent",
      payload: { from: "x", to: "b", type: "depends_on", why: "uses it" },
    });
    const basis = gaps(map, "x")[1];
    expect(basis).toEqual({
      fact: "basis",
      problem: "#x waits on its basis: #root is open, #b is proto",
      fixes: ["werk status root decided", "werk status b decided"],
    });
  });

  test("a kill criterion holds the last fact, and a card with all four has no gap", () => {
    const map = mapOf(...rootDrafts, card("x", { parent: "root", who: "me" }), revisit("x"));
    expect(gaps(map, "x")).toEqual([]);
  });
});

describe("a decide", () => {
  test("is refused with every missing fact in one message", () => {
    const text = refusal(mapOf(card("x")), decide("x"));
    expect(text).toStartWith("#x cannot be decided: 4 facts are missing\n  who: no one is named to decide #x\n");
    expect(text).toContain("\n  basis: ");
    expect(text).toContain("\n  option: ");
    expect(text).toContain("\n  kill criterion: no kill criterion is on record for #x\n    werk kill x --metric");
  });

  test("names one missing fact in the singular", () => {
    const map = mapOf(...rootDrafts, card("x", { parent: "root", who: "me" }));
    expect(refusal(map, decide("x"))).toStartWith("#x cannot be decided: 1 fact is missing\n  kill criterion:");
  });

  test("passes when every fact holds", () => {
    const map = mapOf(...rootDrafts, card("x", { parent: "root", who: "me" }), revisit("x"));
    expect(refusal(map, decide("x"))).toBeUndefined();
  });

  test("on a ghost reads its held links and options", () => {
    const map = mapOf(
      ...rootDrafts,
      {
        type: "node.proposed",
        actor: "agent",
        payload: { id: "g", kind: "card", title: "G", who: "you", parent: "root" },
      },
      { type: "node.proposed", actor: "agent", payload: { id: "g:opt0", kind: "option", title: "O", why_not: "no" } },
      { type: "edge.added", actor: "agent", payload: { from: "g:opt0", to: "g", type: "alternative_to" } },
      revisit("g"),
    );
    expect(map.links).toEqual([]);
    expect(refusal(map, decide("g"))).toBeUndefined();
  });
});

describe("a change to a decided card", () => {
  // q: decided, who you, one option, a kill criterion. r: decided with no kill criterion.
  const decided = () =>
    mapOf(
      ...rootDrafts,
      card("q", { parent: "root", who: "you", status: "decided" }),
      ...option("q:opt0", "q"),
      revisit("q"),
      card("r", { parent: "root", who: "me", status: "decided" }),
      card("s"),
    );

  test("removing the last option is refused; removing one of two is allowed", () => {
    const map = decided();
    const text = refusal(map, {
      type: "edge.removed",
      actor: "agent",
      payload: { from: "q:opt0", to: "q", type: "alternative_to" },
    });
    expect(text).toStartWith("#q is decided, and this change removes a fact it has\n  option: ");
    const two = mapOf(
      ...rootDrafts,
      card("q", { parent: "root", who: "you", status: "decided" }),
      ...option("q:opt0", "q"),
      ...option("q:opt1", "q"),
      revisit("q"),
    );
    expect(
      refusal(two, {
        type: "edge.removed",
        actor: "agent",
        payload: { from: "q:opt0", to: "q", type: "alternative_to" },
      }),
    ).toBeUndefined();
  });

  test("discarding its only ghost option is refused", () => {
    const map = mapOf(
      ...rootDrafts,
      card("q", { parent: "root", who: "you", status: "decided" }),
      { type: "node.proposed", actor: "agent", payload: { id: "q:opt0", kind: "option", title: "O", why_not: "no" } },
      { type: "edge.added", actor: "agent", payload: { from: "q:opt0", to: "q", type: "alternative_to" } },
      revisit("q"),
    );
    expect(refusal(map, { type: "change.discarded", actor: "agent", payload: { id: "q:opt0" } })).toContain(
      "removes a fact it has\n  option:",
    );
  });

  test("changing who to you on a card with no option removes the option fact", () => {
    const map = mapOf(...rootDrafts, card("p", { parent: "root", who: "me", status: "decided" }), revisit("p"));
    expect(refusal(map, { type: "node.edited", actor: "agent", payload: { id: "p", who: "you" } })).toContain(
      "#p is decided, and this change removes a fact it has\n  option:",
    );
  });

  test("a missing fact can always be added to an old decided card", () => {
    expect(refusal(decided(), revisit("r"))).toBeUndefined();
    expect(refusal(decided(), revisit("q"))).toBeUndefined();
  });

  test("a change to its words or its depends_on links needs every fact after the change", () => {
    expect(refusal(decided(), { type: "node.bodyEdited", actor: "agent", payload: { id: "r", body: "new" } })).toBe(
      [
        "#r is decided, and after this change 1 fact is missing",
        "  kill criterion: no kill criterion is on record for #r",
        '    werk kill r --metric "<metric>" --source "<source>" --threshold "<threshold>" --window "<window>"',
        '    or: werk kill r --manual "<the test you run>"',
        '    or: werk kill r --no-metric "<why no metric applies>"',
        "    or: werk kill r --revisit",
      ].join("\n"),
    );
    expect(refusal(decided(), { type: "node.retitled", actor: "agent", payload: { id: "q", title: "Q2" } })).toBe(
      undefined,
    );
    const linked = refusal(decided(), {
      type: "edge.added",
      actor: "agent",
      payload: { from: "q", to: "s", type: "depends_on", why: "uses it" },
    });
    expect(linked).toContain(
      "#q is decided, and after this change 1 fact is missing\n  basis: #q waits on its basis: #s",
    );
  });

  test("a link to a source, or the removal of a card it stands on, is not refused", () => {
    const map = mapOf(
      ...rootDrafts,
      { type: "node.added", actor: "agent", payload: { id: "src", kind: "source", title: "Survey" } },
      { type: "node.proposed", actor: "agent", payload: { id: "b", kind: "card", title: "B", status: "decided" } },
      card("q", { parent: "root", who: "me", status: "decided" }),
      { type: "edge.added", actor: "agent", payload: { from: "q", to: "b", type: "depends_on", why: "uses it" } },
      revisit("q"),
    );
    expect(
      refusal(map, { type: "edge.added", actor: "agent", payload: { from: "q", to: "src", type: "supported_by" } }),
    ).toBeUndefined();
    expect(refusal(map, { type: "change.discarded", actor: "agent", payload: { id: "b" } })).toBeUndefined();
    expect(refusal(map, { type: "change.accepted", actor: "you", payload: { id: "b" } })).toBeUndefined();
  });

  test("an amend runs the facts on the new version, so it waits on a missing fact and refuses to lose one", () => {
    const propose = (id: string): Draft => ({ type: "change.proposed", actor: "agent", payload: { id, title: "New" } });
    const amend = (id: string): Draft => ({ type: "change.accepted", actor: "you", payload: { id } });
    const map = mapOf(
      ...rootDrafts,
      card("q", { parent: "root", who: "you", status: "decided" }),
      ...option("q:opt0", "q"),
      revisit("q"),
      card("r", { parent: "root", who: "me", status: "decided" }),
      card("t", { who: "me", status: "decided" }),
      { type: "edge.added", actor: "agent", payload: { from: "t", to: "root", type: "depends_on", why: "uses it" } },
      revisit("t"),
      propose("q"),
      propose("r"),
      propose("t"),
    );
    expect(refusal(map, amend("q"))).toBeUndefined();
    expect(refusal(map, amend("r"))).toStartWith(
      "#r is decided, and after this change 1 fact is missing\n  kill criterion: no kill criterion is on record for #r",
    );
    const unlink: Draft = {
      type: "edge.removed",
      actor: "agent",
      payload: { from: "t", to: "root", type: "depends_on" },
    };
    expect(refusal(map, unlink, amend("t"))).toStartWith(
      "#t is decided, and after this change 1 fact is missing\n  basis: no decided card is a basis of #t",
    );
  });

  test("a change to an open card is never refused", () => {
    expect(refusal(decided(), { type: "node.bodyEdited", actor: "agent", payload: { id: "s", body: "new" } })).toBe(
      undefined,
    );
  });
});
