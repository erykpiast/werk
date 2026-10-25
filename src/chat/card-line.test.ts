import { expect, test } from "bun:test";
import { fold, parseLog } from "../map/fold.ts";
import { buildRuleTitles } from "./build-rules.ts";
import { cardLine, cardOfTurn, describeCard } from "./card-line.ts";

const events = [
  {
    type: "node.proposed",
    id: "root",
    kind: "card",
    title: "We build software",
    status: "open",
    why: "One pipeline.",
  },
  { type: "node.accepted", id: "root", actor: "you" },
  {
    type: "node.proposed",
    id: "retry",
    kind: "card",
    title: "Checkout retries",
    status: "open",
    why: "Two tries.",
    parent: "root",
  },
  { type: "node.accepted", id: "retry", actor: "you" },
  {
    type: "node.proposed",
    id: "how",
    kind: "card",
    title: "How we build",
    status: "open",
    why: "Rules.",
  },
  { type: "node.accepted", id: "how", actor: "you" },
  {
    type: "node.proposed",
    id: "lint",
    kind: "card",
    title: "Biome lints",
    status: "open",
    why: "One tool.",
    parent: "how",
  },
  { type: "node.accepted", id: "lint", actor: "you" },
];

function mapOf() {
  return fold(parseLog(events.map((e) => JSON.stringify(e)).join("\n")));
}

test("the whole tree names the home card", () => {
  const map = mapOf();
  expect(cardOfTurn(map, null)).toBe("root");
  expect(cardOfTurn(map, "gone")).toBe("root");
  expect(cardOfTurn(map, "retry")).toBe("retry");
});

test("a change of card sends the description, and the same card sends a reminder", () => {
  const map = mapOf();
  const first = cardLine(map, "retry", null);
  expect(first.announced).toBe("retry");
  expect(first.text).toContain("[the map is now at #retry — Checkout retries]");
  expect(first.text).toContain("why: Two tries.");
  const second = cardLine(map, "retry", first.announced);
  expect(second.text).toBe("[still on #retry — Checkout retries]");
  const moved = cardLine(map, null, second.announced);
  expect(moved.text).toStartWith(
    "[the map is now at #root — We build software]",
  );
  expect(moved.text).toContain("children: #retry — Checkout retries");
});

test("a map with no card has no line", () => {
  const map = fold([]);
  expect(cardLine(map, null, null)).toEqual({ text: "", announced: null });
  expect(describeCard(map, "x")).toBe("");
});

test("the build rules are the titles under the build-rules card", () => {
  expect(buildRuleTitles(mapOf())).toEqual(["#lint — Biome lints"]);
});
