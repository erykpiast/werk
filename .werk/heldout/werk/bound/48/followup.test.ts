import { expect, test } from "bun:test";
import { lines, setupWerk } from "./support.ts";

const { werk, seedBoard } = setupWerk();

const planned = (id: string) => ({
  type: "ticket.planned",
  id,
  title: `Ticket ${id}`,
});
const moved = (id: string, to: string) => ({ type: "ticket.moved", id, to });
const done = (id: string) => [
  planned(id),
  moved(id, "building"),
  moved(id, "merging"),
  { type: "ticket.merge", id },
];

test("43.1 a build miss on a done ticket is recorded and listed", async () => {
  seedBoard(...done("app/01"));
  const r = await werk(
    "followup",
    "app/01",
    "--class",
    "build",
    "--found",
    "after-merge",
    "--why",
    "the link expires after 1 minute, the card says 15",
    "--catchable",
    "yes",
  );
  expect(r.code).toBe(0);
  expect(r.stdout).toMatch(/recorded/);
  const list = await werk("followup", "app/01", "--list");
  expect(list.code).toBe(0);
  const out = lines(list.stdout);
  expect(out).toHaveLength(1);
  expect(out[0]).toMatch(/^1\./);
  expect(out[0]).toContain("build");
  expect(out[0]).toMatch(/after[- ]merge/);
  expect(out[0]).toContain("the link expires after 1 minute, the card says 15");
  expect(out[0]).toMatch(/catch\w*:?\s*yes/i);
});

test("43.2 a plan miss is recorded without a catchable answer", async () => {
  seedBoard(...done("app/01"));
  const r = await werk(
    "followup",
    "app/01",
    "--class",
    "plan",
    "--found",
    "review",
    "--why",
    "no card said how long the link lasts",
  );
  expect(r.code).toBe(0);
  expect(r.stdout).toMatch(/recorded/);
  const out = lines((await werk("followup", "app/01", "--list")).stdout);
  expect(out).toHaveLength(1);
  expect(out[0]).toMatch(/^1\./);
  expect(out[0]).toContain("plan");
  expect(out[0]).toContain("review");
  expect(out[0]).toContain("no card said how long the link lasts");
  expect(out[0]).not.toMatch(/catch/i);
});

test("43.3 a wrong catchable answer is refused and nothing is recorded", async () => {
  seedBoard(...done("app/01"));
  const build = await werk(
    "followup",
    "app/01",
    "--class",
    "build",
    "--found",
    "review",
    "--why",
    "the button label is wrong",
  );
  expect(build.code).not.toBe(0);
  expect(build.stderr).toMatch(/build miss needs .*catchable/);
  const plan = await werk(
    "followup",
    "app/01",
    "--class",
    "plan",
    "--found",
    "review",
    "--why",
    "the card was silent",
    "--catchable",
    "no",
  );
  expect(plan.code).not.toBe(0);
  expect(plan.stderr).toMatch(/plan miss/);
  expect(plan.stderr).toMatch(/catchable/);
  const list = await werk("followup", "app/01", "--list");
  expect(list.code).toBe(0);
  expect(lines(list.stdout)).toHaveLength(0);
});

test("43.4 a ticket that is not done, or does not exist, is refused", async () => {
  seedBoard(planned("app/02"), moved("app/02", "building"));
  const building = await werk(
    "followup",
    "app/02",
    "--class",
    "build",
    "--found",
    "review",
    "--why",
    "rename the button",
    "--catchable",
    "no",
  );
  expect(building.code).not.toBe(0);
  expect(building.stderr).toMatch(/not done/);
  const missing = await werk(
    "followup",
    "app/99",
    "--class",
    "plan",
    "--found",
    "review",
    "--why",
    "missing rule",
  );
  expect(missing.code).not.toBe(0);
  expect(missing.stderr).toMatch(/no ticket|does not exist/);
  const list = await werk("followup", "app/02", "--list");
  expect(lines(list.stdout)).toHaveLength(0);
});

test("43.5 the last correction of a record is the class in force", async () => {
  seedBoard(...done("app/01"));
  expect(
    (
      await werk(
        "followup",
        "app/01",
        "--class",
        "build",
        "--found",
        "after-merge",
        "--why",
        "the link expires after 1 minute",
        "--catchable",
        "yes",
      )
    ).code,
  ).toBe(0);
  const first = await werk(
    "followup",
    "app/01",
    "--class",
    "plan",
    "--found",
    "after-merge",
    "--why",
    "the card never said 15 minutes",
    "--of",
    "1",
  );
  expect(first.code).toBe(0);
  let out = lines((await werk("followup", "app/01", "--list")).stdout);
  const one = out.find((l) => l.startsWith("1."));
  expect(one).toMatch(/in force/);
  expect(one).toContain("plan");
  expect(out.some((l) => /correction of 1/.test(l))).toBe(true);
  const second = await werk(
    "followup",
    "app/01",
    "--class",
    "build",
    "--found",
    "after-merge",
    "--why",
    "the card does say 15 minutes",
    "--catchable",
    "yes",
    "--of",
    "1",
  );
  expect(second.code).toBe(0);
  out = lines((await werk("followup", "app/01", "--list")).stdout);
  const again = out.find((l) => l.startsWith("1.")) as string;
  expect(again).toMatch(/in force/);
  expect(again).toContain("build miss");
  expect(again).not.toContain("plan miss");
});
