import { afterEach, beforeEach, expect, test } from "bun:test";
import { decided, open } from "../src/map/mark-fixtures.ts";
import { chat, createProject, logText, type Project, seed, spoken, werk } from "./h.ts";

let p: Project;
beforeEach(() => {
  p = createProject();
  seed(p, open("base", { title: "Base card" }), open("other", { title: "Other card" }));
});
afterEach(() => p.dispose());
const propose = (id = "g", title = "Use a log") =>
  werk(p, "add", id, "--title", title, "--body", "Body words here.", "--why", "Because it is simple.");

test("62.1 propose, then accept into the map", async () => {
  const before = logText(p);
  const r = await propose();
  expect(r.stdout).toContain("proposed");
  const after = logText(p);
  expect(after.startsWith(before)).toBe(true);
  expect(after.slice(before.length).trim().split("\n").length).toBe(1);
  const s = (await werk(p, "show", "g")).stdout;
  expect(s).toContain("Use a log");
  expect(s).toContain("Body words here.");
  expect(s).toContain("Because it is simple.");
  expect(s).toContain("proposed");
  const b2 = logText(p);
  const a = await werk(p, "accept", "g", "--actor", "you");
  expect(a.code).toBe(0);
  const a2 = logText(p);
  expect(a2.startsWith(b2)).toBe(true);
  expect(a2.slice(b2.length).trim().split("\n").length).toBe(1);
  const s2 = (await werk(p, "show", "g")).stdout;
  expect(s2).toContain("Use a log");
  expect(s2).toContain("Body words here.");
  expect(s2).toContain("Because it is simple.");
  expect(s2).not.toContain("proposed");
});

test("62.2 an accept without the person's claim refuses", async () => {
  await propose();
  const n = p.events().length;
  const r = await werk(p, "accept", "g");
  expect(r.code).not.toBe(0);
  expect(p.events().length).toBe(n);
  expect((await werk(p, "show", "g")).stdout).toContain("proposed");
  await werk(p, "accept", "g", "--actor", "you");
  expect((await werk(p, "show", "g")).stdout).not.toContain("proposed");
});

test("62.3 the words of a ghost are frozen", async () => {
  await propose();
  const n = p.events().length;
  const a = await werk(p, "edit", "g", "--body", "New body");
  expect(a.code).not.toBe(0);
  expect(p.events().length).toBe(n);
  const b = await werk(p, "propose", "g", "--title", "Use an append-only log");
  expect(b.code).not.toBe(0);
  expect(p.events().length).toBe(n);
  const c = await werk(p, "add", "g", "--title", "A different title");
  expect(c.code).not.toBe(0);
  expect(p.events().length).toBe(n);
  const s = (await werk(p, "show", "g")).stdout;
  expect(s).toContain("Use a log");
  expect(s).toContain("proposed");
});

test("62.4 a retitle on a real card shows only the new title", async () => {
  await propose();
  await werk(p, "accept", "g", "--actor", "you");
  const n = p.events().length;
  const r = await werk(p, "propose", "g", "--title", "Use an append-only log");
  expect(r.code).toBe(0);
  expect(p.events().length).toBe(n + 1);
  const s = (await werk(p, "show", "g")).stdout;
  expect(s).toContain("Use an append-only log");
  expect(s).not.toContain("Use a log");
  expect(logText(p)).toContain('"Use a log"');
  const m = await werk(p, "edit", "g", "--body", "A new body.");
  expect(m.code).toBe(0);
  const s2 = (await werk(p, "show", "g")).stdout;
  expect(s2).toContain("A new body.");
  expect(s2).toContain("Use an append-only log");
});

test("62.5 an option, a source and an excerpt also enter as ghosts", async () => {
  chat(p, "talk", spoken("the exact words"));
  const events = () => p.events().length;
  let n = events();
  const o = await werk(p, "add", "base:opt0", "--kind", "option", "--title", "Alt", "--why", "Too slow");
  expect(o.stdout).toContain("proposed");
  expect(events()).toBe(n + 1);
  n = events();
  const s = await werk(p, "add", "src1", "--kind", "source", "--title", "Src", "--why", "Finding");
  expect(s.stdout).toContain("proposed");
  expect(events()).toBe(n + 1);
  n = events();
  const e = await werk(p, "quote", "base", "talk", "the exact words");
  expect(e.stdout).toContain("proposed");
  expect(events()).toBe(n + 1);
  for (const id of ["base:opt0", "src1", "base:ex0"]) {
    expect((await werk(p, "show", id)).stdout).toContain("proposed");
  }
  expect((await werk(p, "show", "base:opt0")).stdout).toContain("Too slow");
  const a = await werk(p, "accept", "base:opt0", "--actor", "you");
  expect(a.code).toBe(0);
  const so = (await werk(p, "show", "base:opt0")).stdout;
  expect(so).not.toContain("proposed");
  expect(so).toContain("Too slow");
  expect((await werk(p, "show", "src1")).stdout).toContain("proposed");
  expect((await werk(p, "show", "base:ex0")).stdout).toContain("proposed");
});
