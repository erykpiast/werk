import { expect, test } from "bun:test";
import {
  buildFollowupRecord,
  type FollowupRecord,
  followupLines,
  inForce,
} from "./followup-records.ts";

const base = { class: "plan", found: "review", why: "no card said so" };
const built = (records: FollowupRecord[], rec: Record<string, unknown>) =>
  buildFollowupRecord(records, rec) as FollowupRecord;

test("a build miss needs the catchable answer, and a plan miss refuses it", () => {
  expect(buildFollowupRecord([], { ...base, class: "build" })).toMatchObject({
    rule: "bad-event",
  });
  expect(buildFollowupRecord([], { ...base, catchable: true })).toMatchObject({
    rule: "bad-event",
  });
  expect(built([], { ...base, class: "build", catchable: false })).toEqual({
    n: 1,
    class: "build",
    found: "review",
    why: "no card said so",
    catchable: false,
  });
});

test("class, found and reason are checked", () => {
  for (const bad of [
    { ...base, class: "x" },
    { ...base, found: "x" },
    { ...base, why: " " },
  ])
    expect(buildFollowupRecord([], bad)).toMatchObject({ rule: "bad-event" });
});

test("a correction names an existing original, never a correction", () => {
  const first = built([], base);
  expect(buildFollowupRecord([first], { ...base, of: 2 })).toMatchObject({
    rule: "bad-event",
  });
  const fix = built([first], {
    ...base,
    class: "build",
    catchable: true,
    of: 1,
  });
  expect(fix).toMatchObject({ n: 2, of: 1 });
  expect(buildFollowupRecord([first, fix], { ...base, of: 2 })).toMatchObject({
    detail: expect.stringContaining("original record 1"),
  });
});

test("the last correction is the one in force, and the list shows it", () => {
  const first = built([], base);
  const c1 = built([first], {
    ...base,
    class: "build",
    catchable: true,
    of: 1,
  });
  const c2 = built([first, c1], { ...base, of: 1, why: "again" });
  const all = [first, c1, c2];
  expect(inForce(all, first)).toBe(c2);
  expect(inForce(all, c2)).toBe(c2);
  expect(followupLines(all)).toEqual([
    "1. corrected by 3, in force: plan miss, found review - again",
    "2. correction of 1: build miss, found review, check could catch: yes - no card said so",
    "3. correction of 1: plan miss, found review - again",
  ]);
  expect(followupLines([first])).toEqual([
    "1. plan miss, found review - no card said so",
  ]);
});
