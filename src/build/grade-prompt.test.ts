import { expect, test } from "bun:test";
import type { Grade } from "./grade.ts";
import { lineSpecs } from "./grade-lines.ts";
import { gradePrompt } from "./grade-prompt.ts";

const base = {
  ticket: "title: T\n",
  stories: ["96. As a person"],
  cards: [
    { id: "a", title: "A", why: "because", body: "the body", rejected: [] },
  ],
  specs: lineSpecs(["c1"], [{ id: "a", title: "A" }]),
  base: "abc123",
  previous: null,
};

test("the first grade asks for every gap at once and lists every line", () => {
  const prompt = gradePrompt(base);
  expect(prompt).toContain("first grade of this build");
  expect(prompt).toContain("git diff abc123");
  expect(prompt).toContain("- criterion-1 (delivery): c1");
  expect(prompt).toContain("- card-a (contradiction): A");
  expect(prompt).toContain("- scope (scope):");
  expect(prompt).toContain("### #a — A");
  expect(prompt).toContain("96. As a person");
  expect(prompt).toContain('"lines"');
});

const previous: Grade = {
  lines: [
    {
      id: "criterion-1",
      kind: "delivery",
      text: "c1",
      score: 2,
      gap: "an empty list is sent",
      builds: false,
      person: false,
      failed: true,
    },
    {
      id: "card-a",
      kind: "contradiction",
      text: "A",
      card: "a",
      score: 4,
      gap: "",
      builds: true,
      person: false,
      failed: false,
    },
  ],
};

test("a later grade holds the earlier gaps and asks for regressions only on the passed lines", () => {
  const prompt = gradePrompt({ ...base, previous });
  expect(prompt).toContain("later grade of this build");
  expect(prompt).toContain("- criterion-1: an empty list is sent");
  expect(prompt).toContain("passed at the earlier grade: card-a");
  expect(prompt).toContain("regression");
});

test("a ticket with no stories or cards says none, and a grade with no gaps says none", () => {
  const prompt = gradePrompt({
    ...base,
    stories: [],
    cards: [],
    previous: { lines: [] },
  });
  expect(prompt).toContain("## Stories this ticket delivers\n\nNone.");
  expect(prompt).toContain("## Decided cards\n\nNone.");
  expect(prompt).toContain("failed at the earlier grade:\nNone.");
  expect(prompt).toContain("passed at the earlier grade: none.");
  const bare = gradePrompt({
    ...base,
    cards: [{ id: "b", title: "B", why: "w", body: "", rejected: [] }],
  });
  expect(bare).toContain("### #b — B\nwhy: w\n\n");
});
