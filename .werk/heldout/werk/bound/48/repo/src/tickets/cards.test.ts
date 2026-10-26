import { expect, test } from "bun:test";
import { fold } from "../map/fold.ts";
import type { Draft } from "../map/types.ts";
import { decidedCardsUnder } from "./cards.ts";

const logOf = (...drafts: Draft[]) =>
  drafts.map((draft, i) => JSON.stringify({ seq: i + 1, at: "2026-10-25T00:00:00.000Z", ...draft })).join("\n");
const card = (id: string, parent?: string, type: "node.added" | "node.proposed" = "node.added"): Draft => ({
  type,
  actor: "agent",
  payload: { id, kind: "card", title: `Card ${id}`, ...(parent === undefined ? {} : { parent }) },
});
const decide = (id: string): Draft => ({ type: "node.decided", actor: "agent", payload: { id } });

test("the root and its decided real descendants at any depth count; open cards, ghosts and other subtrees do not", () => {
  const map = fold(
    logOf(
      card("top"),
      card("root", "top"),
      card("a", "root"),
      card("a1", "a"),
      card("b", "root"),
      card("ghost", "root", "node.proposed"),
      card("other", "top"),
      decide("top"),
      decide("root"),
      decide("a1"),
      decide("b"),
      decide("ghost"),
      decide("other"),
    ),
  );
  expect(map.problems).toEqual([]);
  expect(map.nodes.get("ghost")?.status).toBe("decided");
  expect(decidedCardsUnder(map, "root").sort()).toEqual(["a1", "b", "root"]);
  expect(decidedCardsUnder(map, "missing")).toEqual([]);
});
