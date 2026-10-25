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
      type: "excerpt.quoted",
      id: "q",
      title: "We should charge per seat.",
      card: "root",
      conversation: "talk",
      session: "s1",
      message: 3,
      start: 0,
      end: 5,
      speaker: "agent",
      said_at: "10:02",
    },
  );
  const html = page(map, "root");
  expect(html).toContain("<h2>Options</h2>");
  expect(html).toContain("rejected because it hides cost");
  expect(html).toContain("status-option");
  expect(html).toContain("<h2>Evidence and excerpts</h2>");
  expect(html).toContain("We should charge per seat.");
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

const accepted = (id: string) => ({
  type: "node.accepted",
  id,
  actor: "you",
});

test("a ghost's page has the proposed badge and a ✓, and no ✕", () => {
  const map = build(open("root"), ghost("g", { parent: "root" }));
  const html = page(map, "g");
  expect(html).toContain('<span class="tag tag-proposed">proposed</span>');
  expect(html).toContain('data-action="accept" data-card="g"');
  expect(html).not.toContain('data-action="remove"');
});

test("a pending edit shows one card with its words marked, and no before and after sections", () => {
  const map = build(
    open("root", { title: "Root", why: "old why", body: "- a\n- b" }),
    {
      type: "change.proposed",
      id: "root",
      why: "new why",
      ops: [{ tag: "elaborated", old: "- a\n- b", new: "- a\n- b\n- c" }],
    },
  );
  const html = page(map, "root");
  expect(html).toContain('<del class="diff-del">old</del>');
  expect(html).toContain('<ins class="diff-add">new</ins>');
  expect(html).toContain('<li><ins class="diff-add">c</ins></li>');
  expect(html).toContain("has-edit");
  expect(html).not.toContain("is-proposed");
  expect(html).not.toMatch(/before|after/i);
  expect(html).toContain('data-action="accept"');
});

test("a pending removal is drawn in red with a red ✓", () => {
  const map = build(open("root"), open("c", { parent: "root" }), {
    type: "removal.proposed",
    id: "c",
  });
  const html = page(map, "c");
  expect(html).toContain("is-removal");
  expect(html).toContain("tag-proposed tag-removal");
  expect(html).toContain("card-accept is-removal");
});

test("the ✕ carries the counts of both answers and the parent's name", () => {
  const map = build(
    open("root", { title: "The root" }),
    open("p", { parent: "root" }),
    open("a", { parent: "p" }),
    open("b", { parent: "p" }),
    accepted("root"),
  );
  const html = page(map, "p");
  expect(html).toContain(
    'data-action="remove" data-card="p" data-cards="3" data-children="2"',
  );
  expect(html).toContain('data-parent="root" data-parent-title="The root"');
  expect(page(map, "root")).not.toContain("data-parent=");
  expect(page(map, "a")).toContain('data-cards="1" data-children="0"');
});

test("a tile of a card with a proposal carries the badge", () => {
  const map = build(open("root"), ghost("g", { parent: "root" }));
  expect(page(map, "root")).toContain(
    '<span class="tag tag-proposed">proposed</span>',
  );
});

test("the ✕ counts grandchildren in the cards that go", () => {
  const map = build(
    open("root"),
    open("p", { parent: "root" }),
    open("a", { parent: "p" }),
    open("g", { parent: "a" }),
  );
  expect(page(map, "p")).toContain('data-card="p" data-cards="3"');
});

test("a tile of a card with a pending removal has a red badge", () => {
  const map = build(open("root"), open("c", { parent: "root" }), {
    type: "removal.proposed",
    id: "c",
  });
  expect(page(map, "root")).toContain(
    '<span class="tag tag-proposed tag-removal">proposed</span>',
  );
});

test("a quote on a decided card stages a ghost excerpt with a pending link, and the card keeps its words", () => {
  const quoted = {
    type: "excerpt.quoted",
    id: "d:ex0",
    title: "We should charge per seat.",
    card: "d",
    conversation: "talk",
    session: "s1",
    message: 3,
    start: 0,
    end: 5,
    speaker: "agent",
    said_at: "10:02",
  };
  const before = build(decided("d", { title: "Seats", why: "units" }));
  const map = build(decided("d", { title: "Seats", why: "units" }), quoted);
  expect(map.problems).toEqual([]);
  expect(map.nodes.get("d:ex0")?.proposed).toBe(true);
  expect(map.ghostEdges).toMatchObject([{ from: "d", to: "d:ex0" }]);
  expect(map.edges).toEqual(before.edges);
  expect(map.nodes.get("d")).toEqual(before.nodes.get("d"));
  const html = page(map, "d");
  expect(html).toContain("is-proposed");
  expect(html).toContain("tag-pending-link");
  expect(page(before, "d")).not.toContain("tag-pending-link");
});
