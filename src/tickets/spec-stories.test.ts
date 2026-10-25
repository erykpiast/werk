import { expect, test } from "bun:test";
import { storiesOf } from "./spec-stories.ts";

test("the numbered lines under the heading are the stories", () => {
  const spec =
    "# Spec\n\n## User stories\n\n1. As a person, I want a.\n93. As b.\n\n## Seams\n\n7. not a story\n";
  expect(storiesOf(spec)).toEqual(["1", "93"]);
});

test("a deeper heading inside the section does not end it", () => {
  expect(
    storiesOf("## User stories\n1. a\n### Notes\n2. b\n# Next\n3. c\n"),
  ).toEqual(["1", "2"]);
});

test("a heading of any level and case counts", () => {
  expect(storiesOf("### user stories\n1. a\n")).toEqual(["1"]);
});

test("a spec with no such heading gives null", () => {
  expect(storiesOf("# Spec\n1. a\n")).toBeNull();
});

test("a heading with no stories gives an empty list", () => {
  expect(storiesOf("## User stories\n\nnone\n")).toEqual([]);
});
