import { expect, test } from "bun:test";
import { fold, type LogEntry } from "../map/fold.ts";
import { openCardId, renderOpenCard } from "./open-card.ts";

const entries = (...events: unknown[]): LogEntry[] =>
  events.map((event, i) => ({ line: i + 1, event }));
const card = (id: string, title: string, why = "", extra = {}) => ({
  type: "node.proposed",
  id,
  kind: "card",
  title,
  status: "open",
  why,
  ...extra,
});
const accept = (id: string) => ({ type: "node.accepted", id, actor: "you" });
const mapOf = (...events: unknown[]) => fold(entries(...events));
test("an empty map opens no card", () => {
  expect(openCardId(mapOf())).toBeNull();
  expect(renderOpenCard(mapOf())).toBeNull();
});

test("the card root opens, with its escaped title and why", () => {
  const map = mapOf(card("root", "A <b> & C", 'say "hi"'), accept("root"));
  const open = renderOpenCard(map);
  expect(open?.id).toBe("root");
  expect(open?.html).toContain("<h1>A &#60;b&#62; &#38; C</h1>");
  expect(open?.html).toContain("say &#34;hi&#34;");
  expect(open?.html).not.toContain("<ul");
});

test("without a root, the first card that refines no card opens, and its sub-cards list by title", () => {
  const map = mapOf(
    card("top", "Top"),
    accept("top"),
    card("kid", "Kid <1>", "", { parent: "top" }),
  );
  const open = renderOpenCard(map);
  expect(open?.id).toBe("top");
  expect(open?.html).toContain('<li data-card-id="kid">Kid &#60;1&#62;</li>');
});

test("the why and body render Markdown, and a reference links only to a card in the map", () => {
  const map = mapOf(
    card("root", "Run `make`", "see #kid and #gone", { body: "- **a**" }),
    accept("root"),
    card("kid", "Kid", "", { parent: "root" }),
  );
  const html = renderOpenCard(map)?.html ?? "";
  expect(html).toContain("<h1>Run <code>make</code></h1>");
  expect(html).toContain(
    '<a class="card-ref" href="/map/kid">#kid</a> and #gone',
  );
  expect(html).toContain("<ul><li><strong>a</strong></li></ul>");
});
