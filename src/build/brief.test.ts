import { expect, test } from "bun:test";
import {
  type BriefInput,
  buildBrief,
  FAILURE_LIMIT,
  storyLines,
  tailOf,
} from "./brief.ts";

const input: BriefInput = {
  ticket: "title: T\n",
  stories: ["1. As a person, I want x."],
  cards: [
    {
      id: "a",
      title: "Card A",
      why: "Because.",
      body: "The body.",
      rejected: [{ title: "Other way", whyNot: "It is slower." }],
    },
    { id: "b", title: "Card B", why: "Why.", body: "", rejected: [] },
  ],
  checks: ["make test"],
  index: "a  Card A\nb  Card B",
  obligation: "build-x",
  pass: 1,
  base: "abc123",
  failure: null,
};

test("a text over the limit keeps its end and says it was cut", () => {
  const long = `${"x".repeat(5000)}END`;
  const cut = tailOf(long);
  expect(cut.startsWith("[cut]")).toBe(true);
  expect(cut.endsWith("END")).toBe(true);
  expect(cut.length).toBe(FAILURE_LIMIT + "[cut]\n".length);
  expect(tailOf("short")).toBe("short");
});

test("story lines are the spec lines of the numbers, with leading zeros ignored", () => {
  const spec = "## User stories\n\n1. One.\n2. Two.\n  84. Eighty-four.\n";
  expect(storyLines(spec, ["84", "01"])).toEqual([
    "1. One.",
    "84. Eighty-four.",
  ]);
  expect(storyLines(spec, ["9"])).toEqual([]);
  expect(storyLines(null, ["1"])).toEqual([]);
});

test("the first pass is told nothing is done and nothing failed", () => {
  const brief = buildBrief(input);
  expect(brief.startsWith("/implement")).toBe(true);
  expect(brief).toContain("Nothing is done yet");
  expect(brief).toContain("Nothing has failed yet");
  expect(brief).toContain("Rejected option: Other way — It is slower.");
  expect(brief).toContain("- `make test`");
  expect(brief).toContain("a  Card A\nb  Card B");
  expect(brief).toContain("build-x");
  expect(brief).toContain("1. As a person, I want x.");
});

test("a later pass reads git history from the base and gets the last failure cut", () => {
  const brief = buildBrief({
    ...input,
    pass: 3,
    failure: `${"y".repeat(9000)}LAST`,
  });
  expect(brief).toContain("This is pass 3");
  expect(brief).toContain("git diff abc123");
  expect(brief).not.toContain("Nothing is done yet");
  expect(brief).toContain("LAST");
  expect(brief.length).toBeLessThan(9000);
});

test("a ticket with no stories and no cards says so", () => {
  const brief = buildBrief({ ...input, stories: [], cards: [] });
  expect(brief).toContain("## Stories this ticket delivers\n\nNone.");
  expect(brief).toContain("## Cited cards\n\nNone.");
});
