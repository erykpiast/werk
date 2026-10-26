// Held-out steps 62.1 to 62.5: proposals enter as ghosts, and only the person's claim accepts them.
import { expect, test } from "bun:test";
import { chat, events, header, lines, ok, project, real, seed } from "./b-helpers.ts";

test("62.1 an agent proposes a card and a person accepts it into the map", async () => {
  const p = project();
  seed(p, real("root", "Root"), real("other", "Other", { parent: "root" }));
  const before = lines(p);
  const add = await ok(p, ["add", "log", "--title", "Use a log", "--body", "One file.", "--why", "Replay works"]);
  expect(add.out).toContain("proposed");
  const mid = lines(p);
  expect(mid).toHaveLength(before.length + 1);
  expect(mid.slice(0, before.length)).toEqual(before);
  const shown = (await ok(p, ["show", "log"])).out;
  expect(shown).toContain("Use a log");
  expect(shown).toContain("One file.");
  expect(shown).toContain("why: Replay works");
  expect(shown.split("\n")[0]).toContain("proposed");
  const accept = await p.werk(["accept", "log", "--actor", "you"]);
  expect(accept.code).toBe(0);
  const after = lines(p);
  expect(after).toHaveLength(mid.length + 1);
  expect(after.slice(0, mid.length)).toEqual(mid);
  const real2 = (await ok(p, ["show", "log"])).out;
  expect(real2).toContain("Use a log");
  expect(real2).toContain("One file.");
  expect(real2).toContain("why: Replay works");
  expect(real2.split("\n")[0]).not.toContain("proposed");
}, 30_000);

test("62.2 an accept without the person's claim refuses and leaves the ghost waiting", async () => {
  const p = project();
  await ok(p, ["add", "log", "--title", "Use a log"]);
  const before = lines(p);
  const run = await p.werk(["accept", "log"]);
  expect(run.code).not.toBe(0);
  expect(lines(p)).toEqual(before);
  expect(await header(p, "log")).toContain("proposed");
  await ok(p, ["accept", "log", "--actor", "you"]);
  expect(await header(p, "log")).not.toContain("proposed");
}, 30_000);

test("62.3 the words of a ghost are frozen", async () => {
  const p = project();
  await ok(p, ["add", "log", "--title", "Use a log", "--body", "First body."]);
  const before = lines(p);
  for (const args of [
    ["edit", "log", "--body", "Other body."],
    ["retitle", "log", "Use an append-only log"],
    ["add", "log", "--title", "A different title"],
  ]) {
    const run = await p.werk(args);
    expect(run.code).not.toBe(0);
    expect(lines(p)).toEqual(before);
  }
  const shown = (await ok(p, ["show", "log"])).out;
  expect(shown).toContain("Use a log");
  expect(shown.split("\n")[0]).toContain("proposed");
}, 30_000);

test("62.4 a retitle on a real card shows only the new title and keeps the old one in the log", async () => {
  const p = project();
  await ok(p, ["add", "log", "--title", "Use a log", "--body", "First body."]);
  await ok(p, ["accept", "log", "--actor", "you"]);
  const before = lines(p);
  const run = await p.werk(["retitle", "log", "Use an append-only log"]);
  expect(run.code).toBe(0);
  const after = lines(p);
  expect(after).toHaveLength(before.length + 1);
  expect(after.slice(0, before.length)).toEqual(before);
  const shown = (await ok(p, ["show", "log"])).out;
  expect(shown).toContain("Use an append-only log");
  expect(shown).not.toMatch(/Use a log(?!\w)/);
  expect(before.some((l) => l.includes('"Use a log"'))).toBe(true);
  expect(lines(p).some((l) => l.includes('"Use a log"'))).toBe(true);
  await ok(p, ["edit", "log", "--body", "Second body."]);
  const edited = (await ok(p, ["show", "log"])).out;
  expect(edited).toContain("Second body.");
  expect(edited).toContain("Use an append-only log");
}, 30_000);

test("62.5 an option, a source and an excerpt also enter as ghosts", async () => {
  const p = project();
  seed(p, real("store", "Storage"));
  chat(p, "talk", "we keep one log per conversation");
  const steps: [string, string[]][] = [
    ["store:opt0", ["add", "store:opt0", "--kind", "option", "--title", "Use Postgres", "--why_not", "Needs a server"]],
    ["bench", ["add", "bench", "--kind", "source", "--title", "Benchmark notes", "--finding", "Log is fast"]],
    ["store:ex0", ["quote", "store", "talk", "one log per conversation"]],
  ];
  for (const [, args] of steps) {
    const before = lines(p);
    const run = await ok(p, args);
    expect(run.out).toContain("proposed");
    const after = lines(p);
    expect(after).toHaveLength(before.length + 1);
    expect(after.slice(0, before.length)).toEqual(before);
  }
  const opt = (await ok(p, ["show", "store:opt0"])).out;
  expect(opt).toContain("Use Postgres");
  expect(opt).toContain("why not: Needs a server");
  expect(opt.split("\n")[0]).toContain("proposed");
  const src = (await ok(p, ["show", "bench"])).out;
  expect(src).toContain("Benchmark notes");
  expect(src).toContain("finding: Log is fast");
  expect(src.split("\n")[0]).toContain("proposed");
  const ex = (await ok(p, ["show", "store:ex0"])).out;
  expect(ex).toContain("one log per conversation");
  expect(ex.split("\n")[0]).toContain("proposed");

  await ok(p, ["accept", "store:opt0", "--actor", "you"]);
  const optReal = (await ok(p, ["show", "store:opt0"])).out;
  expect(optReal.split("\n")[0]).not.toContain("proposed");
  expect(optReal).toContain("why not: Needs a server");
  expect(await header(p, "bench")).toContain("proposed");
  expect(await header(p, "store:ex0")).toContain("proposed");
  expect(events(p).length).toBeGreaterThan(0);
}, 30_000);
