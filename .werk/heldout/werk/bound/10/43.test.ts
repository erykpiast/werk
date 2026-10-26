// werk/43: `werk followup` records, lists and corrects follow-ups on a finished ticket.
import { expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { useWerk } from "./support.ts";

const w = useWerk();
const boardPath = () => join(w.project().dir, ".werk", "board.jsonl");
const seed = (...events: unknown[]) => {
  mkdirSync(join(w.project().dir, ".werk"), { recursive: true });
  writeFileSync(boardPath(), events.map((e) => `${JSON.stringify(e)}\n`).join(""));
};
const boardLines = () => readFileSync(boardPath(), "utf8").split("\n").filter((l) => l !== "").length;
const doneTicket = (id: string) => [
  { type: "ticket.planned", id },
  { type: "ticket.moved", id, to: "building" },
  { type: "ticket.moved", id, to: "merging", actor: "loop" },
  { type: "ticket.merge", id },
];
const list = async (id: string) => {
  const r = await w.run("followup", id, "--list");
  expect(r.code).toBe(0);
  return r.stdout.split("\n").filter((l) => l !== "");
};

test("43.1 a build miss on a done ticket is recorded and listed", async () => {
  seed(...doneTicket("app/01"));
  const r = await w.run("followup", "app/01", "--class", "build", "--found", "after-merge", "--why", "the link expires after 1 minute, the card says 15", "--catchable", "yes");
  expect(r.code).toBe(0);
  expect(r.stdout).toMatch(/recorded/);
  const out = await list("app/01");
  expect(out).toHaveLength(1);
  expect(out[0]).toMatch(/^1\./);
  expect(out[0]).toMatch(/\bbuild\b/);
  expect(out[0]).toMatch(/after[- ]merge/);
  expect(out[0]).toContain("the link expires after 1 minute, the card says 15");
  expect(out[0]).toMatch(/catch\w*:?\s*yes/i);
});

test("43.2 a plan miss is recorded without a catchable answer", async () => {
  seed(...doneTicket("app/01"));
  const r = await w.run("followup", "app/01", "--class", "plan", "--found", "review", "--why", "no card said how long the link lasts");
  expect(r.code).toBe(0);
  expect(r.stdout).toMatch(/recorded/);
  const out = await list("app/01");
  expect(out).toHaveLength(1);
  expect(out[0]).toMatch(/^1\./);
  expect(out[0]).toMatch(/\bplan\b/);
  expect(out[0]).toMatch(/found review/);
  expect(out[0]).toContain("no card said how long the link lasts");
  expect(out[0]).not.toMatch(/catch/i);
});

test("43.3 a wrong catchable answer is refused and nothing is recorded", async () => {
  seed(...doneTicket("app/01"));
  const first = await w.run("followup", "app/01", "--class", "build", "--found", "review", "--why", "the button label is wrong");
  expect(first.code).not.toBe(0);
  expect(first.stderr).toMatch(/build miss needs (a|the) catchable answer/i);
  const second = await w.run("followup", "app/01", "--class", "plan", "--found", "review", "--why", "the card was silent", "--catchable", "no");
  expect(second.code).not.toBe(0);
  expect(second.stderr).toMatch(/plan miss has no catchable answer|plan miss does not take a catchable answer/i);
  expect(await list("app/01")).toEqual([]);
});

test("43.4 a ticket that is not done, or does not exist, is refused", async () => {
  seed(
    { type: "ticket.planned", id: "app/02" },
    { type: "ticket.moved", id: "app/02", to: "building" },
  );
  const notDone = await w.run("followup", "app/02", "--class", "build", "--found", "review", "--why", "rename the button", "--catchable", "no");
  expect(notDone.code).not.toBe(0);
  expect(notDone.stderr).toMatch(/not done/i);
  const missing = await w.run("followup", "app/99", "--class", "plan", "--found", "review", "--why", "missing rule");
  expect(missing.code).not.toBe(0);
  expect(missing.stderr).toMatch(/does not exist|no ticket/i);
  expect(await list("app/02")).toEqual([]);
  expect(boardLines()).toBe(2);
});

test("43.5 the last correction of a record is the class in force", async () => {
  seed(...doneTicket("app/01"));
  expect((await w.run("followup", "app/01", "--class", "build", "--found", "after-merge", "--why", "the link lasts 1 minute", "--catchable", "yes")).code).toBe(0);
  const toPlan = await w.run("followup", "app/01", "--class", "plan", "--found", "after-merge", "--why", "the card never said 15 minutes", "--of", "1");
  expect(toPlan.code).toBe(0);
  const one = await list("app/01");
  expect(one).toHaveLength(2);
  expect(one[0]).toMatch(/^1\..*in force.*\bplan\b/);
  expect(one[1]).toMatch(/^2\..*correct\w* (of )?1/);
  const toBuild = await w.run("followup", "app/01", "--class", "build", "--found", "after-merge", "--why", "the card does say 15 minutes", "--catchable", "yes", "--of", "1");
  expect(toBuild.code).toBe(0);
  const two = await list("app/01");
  expect(two[0]).toMatch(/^1\..*in force.*\bbuild\b/);
});
