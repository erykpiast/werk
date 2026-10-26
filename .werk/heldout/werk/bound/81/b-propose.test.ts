import { expect, test } from "bun:test";
import { Map_ } from "./b-lib.ts";

const firstLine = (out: string) => out.split("\n")[0] as string;
const isGhost = (out: string) => /\bproposed\b/.test(firstLine(out));

test("62.1 agent proposes a card and the person accepts", async () => {
  const m = new Map_();
  await m.root();
  await m.real("other", "Other");
  const base = m.lines();
  const add = await m.ok("add", "use-log", "--title", "Use a log", "--body", "Append only.", "--why", "History matters");
  expect(add.out).toContain("proposed");
  const l1 = m.lines();
  expect(l1.length).toBe(base.length + 1);
  expect(l1.slice(0, base.length)).toEqual(base);
  const s = await m.ok("show", "use-log");
  for (const t of ["Use a log", "Append only.", "History matters"]) expect(s.out).toContain(t);
  expect(isGhost(s.out)).toBe(true);
  const acc = await m.w("accept", "use-log", "--actor", "you");
  expect(acc.code).toBe(0);
  const l2 = m.lines();
  expect(l2.length).toBe(l1.length + 1);
  expect(l2.slice(0, l1.length)).toEqual(l1);
  const s2 = await m.ok("show", "use-log");
  for (const t of ["Use a log", "Append only.", "History matters"]) expect(s2.out).toContain(t);
  expect(isGhost(s2.out)).toBe(false);
});

test("62.2 accept without claim refuses", async () => {
  const m = new Map_();
  await m.root();
  await m.ghost("c", "C");
  const before = m.raw();
  expect((await m.w("accept", "c")).code).not.toBe(0);
  expect(m.raw()).toBe(before);
  expect(isGhost((await m.ok("show", "c")).out)).toBe(true);
  await m.ok("accept", "c", "--actor", "you");
  expect(isGhost((await m.ok("show", "c")).out)).toBe(false);
});

test("62.3 ghost words frozen", async () => {
  const m = new Map_();
  await m.root();
  await m.ghost("c", "Use a log");
  for (const args of [
    ["edit", "c", "--body", "new body"],
    ["retitle", "c", "Use an append-only log"],
    ["add", "c", "--title", "Different title"],
  ]) {
    const before = m.raw();
    const r = await m.w(...args);
    expect(r.code).not.toBe(0);
    expect(m.raw()).toBe(before);
  }
  const s = await m.ok("show", "c");
  expect(s.out).toContain("Use a log");
  expect(s.out).not.toContain("append-only");
  expect(isGhost(s.out)).toBe(true);
});

test("62.4 retitle on a real card", async () => {
  const m = new Map_();
  await m.root();
  await m.real("c", "Use a log");
  const before = m.count();
  const r = await m.w("retitle", "c", "Use an append-only log");
  expect(r.code).toBe(0);
  expect(m.count()).toBe(before + 1);
  const s = await m.ok("show", "c");
  expect(s.out).toContain("Use an append-only log");
  expect(s.out).not.toContain("Use a log");
  expect(m.lines().slice(0, -1).some((l) => l.includes('"title":"Use a log"'))).toBe(true);
  expect(m.raw()).toContain('"title":"Use a log"');
  await m.ok("edit", "c", "--body", "The new body.");
  const s2 = await m.ok("show", "c");
  expect(s2.out).toContain("The new body.");
  expect(s2.out).toContain("Use an append-only log");
});

test("62.5 option, source and excerpt enter as ghosts", async () => {
  const m = new Map_();
  await m.root();
  await m.real("c", "Card");
  m.chat("talk", [{ kind: "spoken", speaker: "person", text: "keep one log per project" }]);
  const steps: string[][] = [
    ["add", "c:opt0", "--kind", "option", "--title", "Use a table", "--why_not", "no history"],
    ["add", "src", "--kind", "source", "--title", "Paper", "--finding", "logs win"],
    ["quote", "c", "talk", "one log per project"],
  ];
  for (const args of steps) {
    const before = m.lines();
    const r = await m.ok(...args);
    expect(r.out).toContain("proposed");
    const after = m.lines();
    expect(after.length).toBe(before.length + 1);
    expect(after.slice(0, before.length)).toEqual(before);
  }
  await m.ok("link", "c:opt0", "c", "--type", "alternative_to");
  const o = (await m.ok("show", "c:opt0")).out;
  expect(isGhost(o)).toBe(true);
  expect(o).toContain("Use a table");
  expect(o).toContain("no history");
  const s = (await m.ok("show", "src")).out;
  expect(isGhost(s)).toBe(true);
  expect(s).toContain("logs win");
  const e = (await m.ok("show", "c:ex0")).out;
  expect(isGhost(e)).toBe(true);
  expect(e).toContain("one log per project");
  await m.ok("accept", "c:opt0", "--actor", "you");
  const o2 = (await m.ok("show", "c:opt0")).out;
  expect(isGhost(o2)).toBe(false);
  expect(o2).toContain("no history");
  expect(isGhost((await m.ok("show", "src")).out)).toBe(true);
  expect(isGhost((await m.ok("show", "c:ex0")).out)).toBe(true);
});
