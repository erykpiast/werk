import { expect, test } from "bun:test";
import type { FoldedMap } from "../map/fold.ts";
import { build, decided, link, open, reopen } from "../map/mark-fixtures.ts";
import { renderCardPage } from "./card-page.ts";

const page = (map: FoldedMap, id: string) =>
  renderCardPage(map, map.nodes.get(id) as never);

const ghost = (id: string, extra: Record<string, unknown> = {}) => ({
  type: "node.proposed",
  id,
  kind: "card",
  title: `Ghost ${id}`,
  status: "open",
  ...extra,
});

test("the root page lists its sub-cards as tiles, real cards before ghosts", () => {
  const map = build(
    open("root", { title: "Root" }),
    ghost("g", { parent: "root" }),
    open("r", { parent: "root", title: "Real" }),
  );
  const html = page(map, "root");
  expect(html.indexOf('data-card-id="r"')).toBeGreaterThan(0);
  expect(html.indexOf('data-card-id="r"')).toBeLessThan(
    html.indexOf('data-card-id="g"'),
  );
  expect(html).toContain('<a class="tile card-box status-open" href="/map/r"');
  expect(html).toContain("is-proposed");
  expect(html).toContain("1 proposed");
});

test("the hero holds the tag row, a heading that shrinks with depth, and the labelled rollup", () => {
  const map = build(
    open("root"),
    open("a", { parent: "root" }),
    open("b", { parent: "a" }),
    open("c", { parent: "b", why: "see #root" }),
    { type: "node.edited", id: "root", who: "you" },
  );
  const root = page(map, "root");
  expect(root).toContain('data-copy="root"');
  expect(root).toContain("tag-kind");
  expect(root).toContain("you decide");
  expect(root).toContain("title-depth-0");
  expect(root).toContain("this card and everything below it, 4 cards");
  expect(page(map, "a")).toContain("title-depth-1");
  expect(page(map, "b")).toContain("title-depth-2");
  expect(page(map, "c")).toContain("title-depth-2");
  expect(page(map, "c")).toContain(
    '<a class="card-ref" href="/map/root">#root</a>',
  );
  expect(page(map, "c")).not.toContain("rollup-bar");
});

test("a stale card shows its trace under the heading, and its box tints", () => {
  const map = build(
    decided("b"),
    decided("a"),
    link("a", "b"),
    reopen("b", { reason: "invalidated", why: "the number was wrong" }),
  );
  const html = page(map, "a");
  expect(html).toContain("<h2>Why this card is stale</h2>");
  expect(html).toContain("STALE from #b, invalidated");
  expect(html).toContain("the number was wrong");
  expect(html).toContain("is-stale");
  expect(html).toContain("tag-stale");
  expect(page(map, "b")).not.toContain("Why this card is stale");
});

test("a postponed card shows the tag and stripes, and its edge keeps the status class", () => {
  const map = build(
    decided("a"),
    open("root"),
    reopen("a", { reason: "postponed", why: "later" }),
  );
  const html = page(map, "a");
  expect(html).toContain("tag-postponed");
  expect(html).toContain("Postponed, not wrong: the work waits.");
  expect(html).toContain("card-box status-open is-postponed");
  expect(html).toContain("Why this card is postponed");
});

test("options show their why-not, and evidence shows the words of its excerpt", () => {
  const map = build(
    open("root"),
    {
      type: "node.proposed",
      id: "opt",
      kind: "option",
      title: "Per seat",
      status: "open",
      why: "rejected because it hides cost",
    },
    link("opt", "root", "alternative_to"),
    {
      type: "node.proposed",
      id: "q",
      kind: "excerpt",
      title: "Said on day 3",
      status: "open",
      why: "the quote says",
      body: "We should charge per **seat**.",
    },
    link("root", "q", "supported_by"),
  );
  const html = page(map, "root");
  expect(html).toContain("<h2>Options</h2>");
  expect(html).toContain("rejected because it hides cost");
  expect(html).toContain("status-option");
  expect(html).toContain("<h2>Evidence and excerpts</h2>");
  expect(html).toContain("We should charge per <strong>seat</strong>.");
  expect(page(map, "q")).toContain("<h2>Cited by</h2>");
});

test("link lists give the id, the title and the reason of each link", () => {
  const map = build(
    open("b", { title: "Base" }),
    open("a", { title: "Top" }),
    link("a", "b"),
  );
  const down = page(map, "a");
  expect(down).toContain("<h2>Depends on</h2>");
  expect(down).toContain('<span class="card-id">#b</span> Base');
  expect(down).toContain("a takes b");
  const up = page(map, "b");
  expect(up).toContain("<h2>Depend on this card</h2>");
  expect(up).toContain("Dependent");
});
