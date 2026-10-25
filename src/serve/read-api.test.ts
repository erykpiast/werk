import { expect, test } from "bun:test";
import { applyEvent, emptyMap, type FoldedMap } from "../map/fold.ts";
import { emptyRollup } from "../map/rollup.ts";
import { cardRead, headerRead, shapeRead } from "./read-api.ts";

/** A map built from the events that the add verb writes. */
function mapOf(): FoldedMap {
  const map = emptyMap();
  const add = (id: string, parent?: string) => {
    const violation = applyEvent(map, {
      type: "node.proposed",
      status: "open",
      id,
      kind: "card",
      title: `Title ${id}`,
      why: `Why ${id}`,
      body: `SECRET BODY ${id}`,
      ...(parent ? { parent } : {}),
    });
    expect(violation).toBeNull();
  };
  add("root");
  add("a", "root");
  add("b", "root");
  return map;
}

test("the fixture map holds the cards it names", () => {
  expect([...mapOf().nodes.keys()]).toEqual(["root", "a", "b"]);
});

test("a card read carries the body and the ids and titles of its neighbours", () => {
  const read = cardRead(mapOf(), "a");
  expect(read?.body).toBe("SECRET BODY a");
  expect(read?.neighbours).toEqual([
    { id: "root", title: "Title root", type: "refines", direction: "out" },
  ]);
  expect(cardRead(mapOf(), "root")?.neighbours.map((n) => n.id)).toEqual([
    "a",
    "b",
  ]);
});

test("a card read of an id that the map does not hold is null", () => {
  expect(cardRead(mapOf(), "nobody")).toBeNull();
});

test("the shape holds ids, kinds, statuses, edges and rollups, and no body", () => {
  const shape = shapeRead(mapOf());
  expect(shape.nodes.map((n) => n.id)).toEqual(["root", "a", "b"]);
  expect(shape.edges).toHaveLength(2);
  expect(shape.rollups.root).toEqual(emptyRollup());
  expect(JSON.stringify(shape)).not.toContain("SECRET BODY");
  expect(JSON.stringify(shape)).not.toContain("Why ");
});

test("a real card counts in the rollup of every ancestor, and a ghost counts in none", () => {
  const map = mapOf();
  const real = (id: string, status: "open" | "proto" | "decided") => {
    const node = map.nodes.get(id);
    if (node) Object.assign(node, { proposed: false, status });
  };
  real("a", "decided");
  real("b", "open");
  map.nodes.set("c", {
    ...(map.nodes.get("a") as NonNullable<ReturnType<typeof map.nodes.get>>),
    id: "c",
    proposed: true,
  });
  map.parents.set("c", "a");
  map.edges.push({ from: "a", to: "root", type: "refines", why: "" });
  const shape = shapeRead(map);
  expect(shape.rollups.root).toEqual({
    ...emptyRollup(),
    cards: 2,
    open: 1,
    decided: 1,
  });
  expect(shape.rollups.a).toEqual({
    ...emptyRollup(),
    cards: 1,
    decided: 1,
  });
  expect(shape.edges.some((edge) => !edge.held)).toBe(true);
});

test("the header index lists real nodes with parent, status and flags, and leaves a ghost out", () => {
  const map = mapOf();
  for (const node of map.nodes.values()) node.proposed = false;
  const ghost = applyEvent(map, {
    type: "node.proposed",
    id: "g",
    kind: "card",
    title: "Ghost",
    why: "",
    status: "open",
    parent: "root",
  });
  expect(ghost).toBeNull();
  const index = headerRead(map);
  expect(index.entries.map((e) => e.id)).toEqual(["root", "a", "b"]);
  expect(index.entries[1]).toEqual({
    id: "a",
    kind: "card",
    title: "Title a",
    why: "Why a",
    status: "open",
    stale: false,
    postponed: false,
    parent: "root",
  });
  expect(index.rollups.root?.cards).toBe(3);
});
