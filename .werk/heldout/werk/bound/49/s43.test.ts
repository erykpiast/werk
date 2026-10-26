import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, setDefaultTimeout, test } from "bun:test";
import { createProject, makeWerk } from "./support.ts";

setDefaultTimeout(120000);

type P = ReturnType<typeof createProject>;
async function withW<T>(body: (w: ReturnType<typeof makeWerk>, p: P, seed: (...e: unknown[]) => void, lines: () => string[]) => Promise<T>) {
  const p = createProject();
  try {
    const boardPath = join(p.dir, ".werk", "board.jsonl");
    const seed = (...events: unknown[]) => {
      mkdirSync(join(p.dir, ".werk"), { recursive: true });
      writeFileSync(boardPath, events.map((e) => `${JSON.stringify(e)}\n`).join(""));
    };
    const lines = () => readFileSync(boardPath, "utf8").trim().split("\n");
    return await body(makeWerk(p), p, seed, lines);
  } finally {
    await p.dispose();
  }
}
const done = (id: string) => [
  { type: "ticket.planned", id },
  { type: "ticket.moved", id, to: "building" },
  { type: "ticket.moved", id, to: "merging", actor: "loop" },
  { type: "ticket.merge", id },
];

test("43.1 a build miss on a done ticket is recorded and listed", () =>
  withW(async (w, _p, seed) => {
    seed(...done("app/01"));
    const r = await w("followup", "app/01", "--class", "build", "--found", "after-merge", "--why", "the link expires after 1 minute, the card says 15", "--catchable", "yes");
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/recorded/);
    const l = await w("followup", "app/01", "--list");
    expect(l.code).toBe(0);
    expect(l.stdout).toMatch(/^1\./);
    expect(l.stdout).toMatch(/build/);
    expect(l.stdout).toMatch(/after[- ]merge/);
    expect(l.stdout).toContain("the link expires after 1 minute, the card says 15");
    expect(l.stdout).toMatch(/(catchable|could catch)[: ]+yes/i);
  }));

test("43.2 a plan miss is recorded without a catchable answer", () =>
  withW(async (w, _p, seed) => {
    seed(...done("app/01"));
    const r = await w("followup", "app/01", "--class", "plan", "--found", "review", "--why", "no card said how long the link lasts");
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/recorded/);
    const l = await w("followup", "app/01", "--list");
    expect(l.stdout).toMatch(/^1\./);
    expect(l.stdout).toMatch(/plan/);
    expect(l.stdout).toMatch(/review/);
    expect(l.stdout).toContain("no card said how long the link lasts");
    expect(l.stdout).not.toMatch(/catch/i);
  }));

test("43.3 a wrong catchable answer is refused and nothing is recorded", () =>
  withW(async (w, _p, seed) => {
    seed(...done("app/01"));
    const a = await w("followup", "app/01", "--class", "build", "--found", "review", "--why", "the button label is wrong");
    expect(a.code).not.toBe(0);
    expect(a.all).toMatch(/build miss needs/i);
    expect(a.all).toMatch(/catchable/i);
    const b = await w("followup", "app/01", "--class", "plan", "--found", "review", "--why", "the card was silent", "--catchable", "no");
    expect(b.code).not.toBe(0);
    expect(b.all).toMatch(/plan miss/i);
    const l = await w("followup", "app/01", "--list");
    expect(l.stdout.trim()).toBe("");
  }));

test("43.4 a ticket not done, or missing, is refused", () =>
  withW(async (w, _p, seed) => {
    seed({ type: "ticket.planned", id: "app/02" }, { type: "ticket.moved", id: "app/02", to: "building" });
    const a = await w("followup", "app/02", "--class", "build", "--found", "review", "--why", "rename the button", "--catchable", "no");
    expect(a.code).not.toBe(0);
    expect(a.all).toMatch(/not done/);
    const b = await w("followup", "app/99", "--class", "plan", "--found", "review", "--why", "missing rule");
    expect(b.code).not.toBe(0);
    expect(b.all).toMatch(/does not exist|no ticket|unknown ticket|not exist/i);
    const l = await w("followup", "app/02", "--list");
    expect(l.stdout.trim()).toBe("");
  }));

test("43.5 the last correction is the class in force", () =>
  withW(async (w, _p, seed) => {
    seed(...done("app/01"), { type: "ticket.followup_recorded", id: "app/01", class: "build", found: "after-merge", why: "the link expires", catchable: true });
    const a = await w("followup", "app/01", "--class", "plan", "--found", "after-merge", "--why", "the card never said 15 minutes", "--of", "1");
    expect(a.code).toBe(0);
    const l1 = await w("followup", "app/01", "--list");
    const rows = l1.stdout.trim().split("\n");
    expect(rows[0]).toMatch(/^1\..*in force: plan/);
    expect(rows[1]).toMatch(/^2\. correction of 1/);
    const b = await w("followup", "app/01", "--class", "build", "--found", "after-merge", "--why", "the card does say 15 minutes", "--catchable", "yes", "--of", "1");
    expect(b.code).toBe(0);
    const l2 = await w("followup", "app/01", "--list");
    expect(l2.stdout.trim().split("\n")[0]).toMatch(/^1\..*in force: build/);
  }));
