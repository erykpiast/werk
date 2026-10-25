import { expect, test } from "bun:test";
import { renderCard } from "./card-text.ts";
import { fold } from "./fold.ts";

const ev = (event: unknown, line: number) => ({ line, event });
const base = { type: "node.proposed", kind: "card", status: "open" };

test("a ghost under a parent prints as proposed, and its parent lists it", () => {
  const map = fold([
    ev({ ...base, id: "p", title: "Parent" }, 1),
    ev(
      {
        ...base,
        id: "c",
        title: "#Child",
        why: "because",
        body: "details",
        parent: "p",
      },
      2,
    ),
  ]);
  const child = renderCard(map, "c") ?? "";
  expect(child).toContain("card c  [open]  proposed");
  expect(child).toContain("#Child");
  expect(child).toContain("why: because");
  expect(child).toContain("details");
  expect(child).toContain("-> refines");
  expect(child).not.toContain("subtree:");
  expect(renderCard(map, "p")).toContain(
    "<- refines        c  #Child  [proposed]",
  );
});

test("a link row prints its reason, an option prints its why not", () => {
  const map = fold([
    ev({ ...base, id: "a", title: "A" }, 1),
    ev(
      {
        ...base,
        id: "o",
        kind: "option",
        title: "O",
        why_not: "no",
        url: "u",
        finding: "f",
      },
      2,
    ),
    ev(
      {
        type: "edge.added",
        from: "o",
        to: "a",
        link: "alternative_to",
        why: "weighed",
      },
      3,
    ),
  ]);
  const text = renderCard(map, "o") ?? "";
  expect(text).toContain("why: weighed");
  expect(text).toContain("why not: no");
  expect(text).toContain("url: u");
  expect(text).toContain("finding: f");
});

test("an unknown card has no text", () => {
  expect(renderCard(fold([]), "x")).toBeNull();
});

test("a real card prints its rollup, and its real child prints one in brackets", () => {
  const map = fold([
    ev({ ...base, id: "p", title: "P" }, 1),
    ev({ ...base, id: "c", title: "C", parent: "p" }, 2),
  ]);
  for (const n of map.nodes.values()) n.proposed = false;
  map.edges.push(...map.ghostEdges.splice(0));
  const text = renderCard(map, "p") ?? "";
  expect(text).toContain("subtree: 2 cards, 2 open");
  expect(text).toContain("(1 card, 1 open)");
});
