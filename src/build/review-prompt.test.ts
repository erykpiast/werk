import { expect, test } from "bun:test";
import { AREAS } from "./review.ts";
import { reviewPrompt } from "./review-prompt.ts";

test("a reviewer prompt holds one area and the diff command", () => {
  const prompt = reviewPrompt(AREAS[3], "abc123");
  expect(prompt).toContain("security reviewer");
  expect(prompt).toContain("input validation");
  expect(prompt).not.toContain("module boundaries");
  expect(prompt).toContain("git diff abc123");
  expect(prompt).toContain('"findings"');
});

test("every area gets its own name and focus in the prompt", () => {
  for (const area of AREAS) {
    const prompt = reviewPrompt(area, "b");
    expect(prompt).toContain(`${area.area} reviewer`);
    expect(prompt).toContain(area.focus);
  }
});

test("the prompt tells the reviewer to read only and gives the reply format", () => {
  const prompt = reviewPrompt(AREAS[0], "b");
  expect(prompt).toContain("Do not try to change anything");
  expect(prompt).toContain("CRITICAL, HIGH, MEDIUM or LOW");
  expect(prompt).toContain('"severity"');
  expect(prompt.endsWith("\n")).toBe(true);
});
