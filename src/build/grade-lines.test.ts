import { expect, test } from "bun:test";
import { build, decided, link, open } from "../map/mark-fixtures.ts";
import { parseTicket } from "../tickets/ticket-parse.ts";
import { closureOf, criteriaOf, lineSpecs, SCOPE_LINE } from "./grade-lines.ts";

const ticket = (criteria: string) =>
  parseTicket(
    "01.md",
    `title: T\ncites: a\nblocked_by:\nstories:\ntouches: x\n\n## What to build\n\nx\n\n## Acceptance criteria\n\n${criteria}\n\n## Checks\n`,
  );

test("each bullet of the acceptance criteria is one criterion, with or without a checkbox", () => {
  const found = ticket("- [ ] first\n- [x] second\n- third\nnot a bullet");
  expect(found && criteriaOf(found)).toEqual(["first", "second", "third"]);
});

test("a ticket with no criteria section has none", () => {
  const found = parseTicket("01.md", "title: T\n");
  expect(found && criteriaOf(found)).toEqual([]);
});

test("the closure holds each cited decided card and every decided card it depends on", () => {
  const map = build(
    decided("a"),
    decided("b"),
    decided("c"),
    open("open"),
    link("a", "b"),
    link("b", "c"),
    link("a", "open"),
    link("c", "a"),
  );
  expect(closureOf(map, ["a"])).toEqual(["a", "b", "c"]);
  expect(closureOf(map, ["missing", "open"])).toEqual([]);
});

test("the lines are the criteria, then the cards, then one scope line", () => {
  const specs = lineSpecs(["x", "y"], [{ id: "a", title: "A" }]);
  expect(specs.map((s) => [s.id, s.kind])).toEqual([
    ["criterion-1", "delivery"],
    ["criterion-2", "delivery"],
    ["card-a", "contradiction"],
    [SCOPE_LINE, "scope"],
  ]);
  expect(specs[2]?.card).toBe("a");
});
