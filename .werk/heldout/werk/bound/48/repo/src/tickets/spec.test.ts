import { expect, test } from "bun:test";
import { specStories } from "./spec.ts";

test("the stories are the numbered lines under User stories, up to the next heading of the same level or higher", () => {
  const spec = `# Spec

## Problem

1. Not a story.

## User stories

1. As a person, I want one.
   2. An indented line is not a story.
2. As an agent, I want two.

### Notes under the stories

78. A deeper heading keeps the list going.

## Seams

3. Not a story.
`;
  expect(specStories(spec)).toEqual([1, 2, 78]);
});

test("a spec with no User stories heading has no stories list, and an empty section has an empty one", () => {
  expect(specStories("# Spec\n\n1. A line.\n")).toBeUndefined();
  expect(specStories("# User stories\n\nNone yet.\n")).toEqual([]);
});
