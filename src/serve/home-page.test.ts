import { expect, test } from "bun:test";
import { fold, type LogEntry } from "../map/fold.ts";
import { renderHome } from "./home-page.ts";

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

const tops = [
  card("root", "Requirements", "What it does"),
  accept("root"),
  card("how", "Build rules", "How it is built"),
  accept("how"),
];

test("an empty map has no home", () => {
  expect(renderHome(mapOf())).toBeNull();
});

test("the home has a What column for #root and a How column for #how, each with title, why and children", () => {
  const html = renderHome(
    mapOf(
      ...tops,
      card("r1", "Requirement one", "", { parent: "root" }),
      accept("r1"),
      card("h1", "Rule one", "", { parent: "how" }),
      accept("h1"),
    ),
  ) as string;
  const what = html.slice(html.indexOf("home-what"), html.indexOf("home-how"));
  const how = html.slice(html.indexOf("home-how"));
  expect(what).toContain("Requirements</h1>");
  expect(what).toContain("What it does");
  expect(what).toContain('data-card-id="r1"');
  expect(what).not.toContain('data-card-id="h1"');
  expect(how).toContain("Build rules</h1>");
  expect(how).toContain("How it is built");
  expect(how).toContain('data-card-id="h1"');
});

test("with no #how card, the right column is the empty build-rules card", () => {
  const html = renderHome(
    mapOf(card("root", "Requirements"), accept("root")),
  ) as string;
  expect(html.slice(html.indexOf("home-how"))).toContain("empty-how");
  expect(html).not.toContain("tile-grid");
});

test("a #how card with no children shows the empty build-rules card and nothing else", () => {
  const html = renderHome(mapOf(...tops)) as string;
  const how = html.slice(html.indexOf("home-how"));
  expect(how).toContain("empty-how");
  expect(how).not.toContain("How it is built");
});
