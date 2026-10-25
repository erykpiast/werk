import { expect, test } from "bun:test";
import { build, open } from "../map/mark-fixtures.ts";
import { rollups } from "../map/rollup.ts";
import { renderCardTile } from "./card-tile.ts";

test("the tile is one link: no link inside it, no body, and a leaf has no bar", () => {
  const map = build(
    open("root"),
    open("a", { parent: "root", why: "see #root and `code`", body: "SECRET" }),
    open("k", { parent: "a" }),
  );
  const tile = renderCardTile(map, map.nodes.get("a") as never, rollups(map).a);
  expect(tile.match(/<a /g)).toHaveLength(1);
  expect(tile).toContain('<span class="card-ref">#root</span>');
  expect(tile).toContain("<code>code</code>");
  expect(tile).not.toContain("SECRET");
  expect(tile).toContain("1 below");
  expect(tile).toContain("rollup-bar");
  const leaf = renderCardTile(map, map.nodes.get("k") as never, rollups(map).k);
  expect(leaf).not.toContain("rollup-bar");
  expect(leaf).not.toContain("below");
});

test("a tile counts the evidence its card cites", () => {
  const map = build(
    open("root"),
    {
      type: "node.proposed",
      id: "q",
      kind: "excerpt",
      title: "Said",
      status: "open",
    },
    {
      type: "edge.added",
      from: "root",
      to: "q",
      link: "supported_by",
      why: "root cites q",
    },
  );
  const tile = renderCardTile(map, map.nodes.get("root") as never, undefined);
  expect(tile).toContain("1 evidence");
});
