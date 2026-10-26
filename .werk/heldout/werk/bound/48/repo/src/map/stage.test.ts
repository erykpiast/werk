import { expect, test } from "bun:test";
import { fold } from "./fold.ts";
import { acceptSet, discardSet } from "./stage.ts";
import type { Draft, FoldedMap, NodeKind } from "./types.ts";

const node = (id: string, kind: NodeKind, ghost: boolean, parent?: string): Draft => ({
  type: ghost ? "node.proposed" : "node.added",
  actor: "agent",
  payload: { id, kind, title: id, ...(parent === undefined ? {} : { parent }) },
});
const link = (from: string, to: string, type: "supported_by" | "alternative_to"): Draft => ({
  type: "edge.added",
  actor: "agent",
  payload: { from, to, type },
});
const mapOf = (...drafts: Draft[]): FoldedMap => {
  const map = fold(drafts.map((d, i) => JSON.stringify({ seq: i + 1, at: "t", ...d })).join("\n"));
  expect(map.problems).toEqual([]);
  return map;
};

// root (real) ─ mid (ghost) ─ leaf (ghost), leaf:opt0 (ghost option), mid:opt0 (real option)
//                             leaf cites src (ghost source) and real (real source)
const chain = () =>
  mapOf(
    node("root", "card", false),
    node("mid", "card", true, "root"),
    node("leaf", "card", true, "mid"),
    node("leaf:opt0", "option", true),
    link("leaf:opt0", "leaf", "alternative_to"),
    node("src", "source", true),
    link("leaf", "src", "supported_by"),
    node("real", "source", false),
    link("leaf", "real", "supported_by"),
    node("other", "card", true, "root"),
  );

test("an accept takes the ghost parents up to the first real one, then the ghost options and evidence", () => {
  expect(acceptSet(chain(), "leaf")).toEqual(["mid", "leaf", "leaf:opt0", "src"]);
});

test("an accept of a card under a real parent takes only itself and its own ghosts", () => {
  expect(acceptSet(chain(), "other")).toEqual(["other"]);
  expect(acceptSet(chain(), "mid")).toEqual(["mid"]);
});

test("a source shared by two cards in the accepted chain is listed once", () => {
  const map = mapOf(
    node("root", "card", false),
    node("p", "card", true, "root"),
    node("c", "card", true, "p"),
    node("s", "source", true),
    link("p", "s", "supported_by"),
    link("c", "s", "supported_by"),
  );
  expect(acceptSet(map, "c")).toEqual(["p", "c", "s"]);
});

test("a discard takes the ghost descendants, deepest first, with their options and excerpts", () => {
  expect(discardSet(chain(), "mid")).toEqual(["leaf:opt0", "leaf", "mid", "src"]);
});

// C and D are ghost cards. S is a ghost source both cite; T a ghost source only C cites;
// C:ex0 a ghost excerpt quoted for C.
const evidence = () =>
  mapOf(
    node("root", "card", false),
    node("C", "card", true, "root"),
    node("D", "card", true, "root"),
    node("S", "source", true),
    node("T", "source", true),
    {
      type: "excerpt.quoted",
      actor: "agent",
      payload: {
        id: "C:ex0",
        title: "Q",
        card: "C",
        conversation: "c",
        session: "s",
        message: 0,
        start: 0,
        end: 1,
        speaker: "person",
        said_at: "t",
      },
    } as Draft,
    link("C", "S", "supported_by"),
    link("C", "T", "supported_by"),
    link("D", "S", "supported_by"),
  );

test("a discard keeps a ghost source another card cites, and drops one only it cited", () => {
  expect(discardSet(evidence(), "C")).toEqual(["C:ex0", "C", "T"]);
});

test("a discard of a parent drops a source that only the parent and its child cite", () => {
  const map = mapOf(
    node("root", "card", false),
    node("p", "card", true, "root"),
    node("c", "card", true, "p"),
    node("s", "source", true),
    link("p", "s", "supported_by"),
    link("c", "s", "supported_by"),
  );
  expect(discardSet(map, "p")).toEqual(["c", "p", "s"]);
});
