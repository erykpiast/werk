import { afterEach, beforeEach, expect, test } from "bun:test";
import { createProject, decided, ghost, link, open, seed, werkIn, type Project } from "./support.ts";

let p: Project;
let werk: ReturnType<typeof werkIn>;
beforeEach(() => {
  p = createProject();
  werk = werkIn(p);
});
afterEach(() => p.dispose());

const reopened = (id: string) => ({ type: "node.reopened", id, reason: "rejected", at: "2026-10-10T09:00:00.000Z" });
const rollupLines = (s: string) => s.split("\n").filter((l) => /roll/i.test(l));

test("11.1 the rollup counts the card and its refines subtree", async () => {
  seed(p, [
    decided("root", { title: "Root" }),
    decided("c1", { title: "C1", parent: "root" }),
    open("c2", { title: "C2", parent: "root", status: "proto" }),
    decided("gc", { title: "GC", parent: "c1" }),
    reopened("c1"),
  ]);
  const r = await werk("show", "root");
  expect(r.code).toBe(0);
  const lines = rollupLines(r.stdout);
  expect(lines).toHaveLength(1);
  expect(lines[0]).toMatch(/\b4\b/);
  expect(lines[0]).toMatch(/1 open/);
  expect(lines[0]).toMatch(/1 proto/);
  expect(lines[0]).toMatch(/2 decided/);
});

test("11.2 each incoming refines link shows the child's own rollup", async () => {
  seed(p, [
    decided("parent", { title: "Parent" }),
    decided("child", { title: "Child", parent: "parent" }),
    open("gc1", { title: "GC1", parent: "child" }),
    decided("gc2", { title: "GC2", parent: "child" }),
    reopened("child"),
  ]);
  const r = await werk("show", "parent");
  const out = r.stdout.split("\n");
  const incoming = out.findIndex((l) => /<-\s+refines\s+child/.test(l));
  expect(incoming).toBeGreaterThanOrEqual(0);
  const around = out.slice(incoming, incoming + 3).join("\n");
  expect(around).toMatch(/\b3\b/);
  const own = rollupLines(r.stdout);
  expect(own.some((l) => /\b4\b/.test(l))).toBe(true);
});

test("11.3 a card prints options, excerpts and a proposed source with their words", async () => {
  seed(p, [
    decided("other", { title: "Other card" }),
    open("card", { title: "The card" }),
    link("card", "other", "depends_on", "needs the other card for sign-in"),
    open("card:opt0", { kind: "option", title: "Use cookies", why: "cookies break on mobile" }),
    { type: "edge.added", from: "card:opt0", to: "card", link: "alternative_to", why: "weighed" },
    ghost("card:src", { kind: "source", title: "Auth study", body: "links expire after 15 minutes" }),
    { type: "edge.added", from: "card", to: "card:src", link: "supported_by", why: "evidence" },
  ]);
  // an excerpt, through the quote verb, needs a chat log
  const { mkdirSync, writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  mkdirSync(join(p.dir, ".werk", "chats"), { recursive: true });
  writeFileSync(
    join(p.dir, ".werk", "chats", "talk.jsonl"),
    `${JSON.stringify({ speaker: "person", at: "10:02", session: "s1", kind: "spoken", text: "links must expire fast" })}\n`,
  );
  const q = await werk("quote", "card", "talk", "links must expire fast");
  expect(q.code).toBe(0);
  const r = await werk("show", "card");
  const s = r.stdout;
  expect(s).toMatch(/depends_on\s+other/);
  expect(s).toContain("needs the other card for sign-in");
  const linksEnd = s.lastIndexOf("-> ") > s.lastIndexOf("<- ") ? s.lastIndexOf("-> ") : s.lastIndexOf("<- ");
  const opt = s.indexOf("Options");
  expect(opt).toBeGreaterThan(linksEnd);
  expect(s).toContain("Use cookies");
  expect(s).toContain("cookies break on mobile");
  expect(s).toMatch(/Say/);
  expect(s).toContain("person");
  expect(s).toContain("links must expire fast");
  expect(s).toMatch(/Ev/);
  expect(s).toContain("Auth study");
  expect(s).toContain("links expire after 15 minutes");
  expect(s).toMatch(/Auth study[^\n]*proposed|proposed[^\n]*Auth study/);
});

test("11.4 a card with no options prints no Options section", async () => {
  seed(p, [
    open("card", { title: "The card" }),
    open("card:src", { kind: "source", title: "A study", body: "a finding" }),
    { type: "edge.added", from: "card", to: "card:src", link: "supported_by", why: "evidence" },
  ]);
  const { mkdirSync, writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  mkdirSync(join(p.dir, ".werk", "chats"), { recursive: true });
  writeFileSync(
    join(p.dir, ".werk", "chats", "talk.jsonl"),
    `${JSON.stringify({ speaker: "person", at: "10:02", session: "s1", kind: "spoken", text: "say this" })}\n`,
  );
  expect((await werk("quote", "card", "talk", "say this")).code).toBe(0);
  const s = (await werk("show", "card")).stdout;
  expect(s).toMatch(/Say/);
  expect(s).toMatch(/Ev/);
  expect(s).not.toMatch(/Options/);
});

test("11.5 show with no id prints the root card", async () => {
  seed(p, [open("rootcard", { title: "The root" }), open("second", { title: "Second", parent: "rootcard" })]);
  const r = await werk("show");
  expect(r.code).toBe(0);
  expect(r.stdout).toContain("The root");
  expect(rollupLines(r.stdout).length).toBeGreaterThan(0);
  expect(r.stdout).toMatch(/<-\s+refines\s+second/);
});
