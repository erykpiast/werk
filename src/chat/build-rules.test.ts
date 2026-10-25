import { expect, test } from "bun:test";
import { fold, parseLog } from "../map/fold.ts";
import { BUILD_RULES_ID, buildRuleTitles } from "./build-rules.ts";

function mapOf(events: object[]) {
  return fold(parseLog(events.map((e) => JSON.stringify(e)).join("\n")));
}

function card(id: string, title: string, parent?: string) {
  return [
    {
      type: "node.proposed",
      id,
      kind: "card",
      title,
      status: "open",
      why: "Reason.",
      ...(parent ? { parent } : {}),
    },
    { type: "node.accepted", id, actor: "you" },
  ];
}

test("a map without the build-rules card has no titles", () => {
  expect(buildRuleTitles(mapOf(card("root", "Root")))).toEqual([]);
});

test("the titles cover every depth under the build-rules card, and nothing else", () => {
  const map = mapOf([
    ...card("root", "Root"),
    ...card(BUILD_RULES_ID, "How we build"),
    ...card("test", "Tests run", BUILD_RULES_ID),
    ...card("test-cover", "Coverage gate", "test"),
    ...card("elsewhere", "Not a rule", "root"),
  ]);
  expect(buildRuleTitles(map)).toEqual([
    "#test — Tests run",
    "#test-cover — Coverage gate",
  ]);
});

test("an option under a rule is not a rule", () => {
  const map = mapOf([
    ...card(BUILD_RULES_ID, "How we build"),
    ...card("lint", "Biome lints", BUILD_RULES_ID),
    {
      type: "node.proposed",
      id: "lint:opt0",
      kind: "option",
      title: "ESLint",
      why_not: "Slower.",
    },
    {
      type: "link.added",
      from: "lint:opt0",
      to: "lint",
      link: "refines",
      why: "",
    },
  ]);
  expect(buildRuleTitles(map)).toEqual(["#lint — Biome lints"]);
});
