import { expect, test } from "bun:test";
import { card, lines, ok, withMap } from "./h62util.ts";

test("04.4 the words of a ghost are frozen", async () => {
  const p = withMap([card("root", "Root"), card("search", "Search", "root")]);
  await ok(p, ["add", "index", "--title", "Search index", "--why", "It makes lookups fast", "--parent", "search"]);
  const before = lines(p);
  const again = await p.werk(["add", "index", "--title", "Other title", "--why", "Other why", "--parent", "search"]);
  expect(again.code).not.toBe(0);
  expect(again.err).toContain("a ghost's words are frozen");
  expect(lines(p)).toEqual(before);
  const show = (await ok(p, ["show", "index"])).out;
  expect(show).toContain("Search index");
  expect(show).toContain("why: It makes lookups fast");
  expect(show).not.toContain("Other");
}, 30_000);
