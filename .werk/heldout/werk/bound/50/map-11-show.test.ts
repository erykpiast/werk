import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  createProject,
  decided,
  link,
  open,
  type Project,
  seedMap,
  werk,
} from "./support.ts";

let p: Project;
beforeEach(() => {
  p = createProject();
});
afterEach(() => p.dispose());

const chat = () => {
  mkdirSync(join(p.dir, ".werk", "chats"), { recursive: true });
  const line = {
    kind: "spoken",
    speaker: "you",
    session: "s1",
    at: "2026-10-10T09:00:00.000Z",
    text: "the link must last fifteen minutes",
  };
  writeFileSync(
    join(p.dir, ".werk", "chats", "talk.jsonl"),
    `${JSON.stringify(line)}\n`,
  );
};

/** The lines of the output that carry a count of cards. */
const rollupLines = (text: string) =>
  text.split("\n").filter((l) => /\b\d+\s+cards?\b/i.test(l));

test("11.1 the rollup counts the card and its whole refines subtree", async () => {
  seedMap(
    p,
    decided("root", { title: "Root card" }),
    open("c1", { title: "Child open", parent: "root" }),
    open("c2", { title: "Child proto", parent: "root", status: "proto" }),
    decided("g1", { title: "Grandchild", parent: "c1" }),
  );
  const r = await werk(p, "show", "root");
  expect(r.code).toBe(0);
  const lines = rollupLines(r.stdout);
  expect(lines).toHaveLength(1);
  expect(lines[0]).toMatch(/\b4\s+cards?\b/);
  expect(lines[0]).toMatch(/\b1\s+open\b/);
  expect(lines[0]).toMatch(/\b1\s+proto\b/);
  expect(lines[0]).toMatch(/\b2\s+decided\b/);
});

test("11.2 each incoming refines link shows the child's own rollup", async () => {
  seedMap(
    p,
    decided("parent", { title: "Parent card" }),
    open("child", { title: "Child card", parent: "parent" }),
    open("g1", { title: "Grandchild open", parent: "child" }),
    decided("g2", { title: "Grandchild decided", parent: "child" }),
  );
  const r = await werk(p, "show", "parent");
  expect(r.code).toBe(0);
  expect(r.stdout).toMatch(/<- refines\s+child/);
  const lines = rollupLines(r.stdout);
  expect(lines.some((l) => /\b3\s+cards?\b/.test(l) && !l.includes("4"))).toBe(
    true,
  );
  expect(lines.some((l) => /\b4\s+cards?\b/.test(l))).toBe(true);
});

test("11.3 a card prints its options, excerpts and a proposed source with their words", async () => {
  chat();
  seedMap(
    p,
    decided("other", { title: "Other card" }),
    open("main", { title: "Main card" }),
    open("opt", { kind: "option", title: "Option title", why: "why not this" }),
    {
      type: "edge.added",
      from: "opt",
      to: "main",
      link: "alternative_to",
      why: "w",
    },
    link("main", "other", "depends_on"),
    {
      type: "node.proposed",
      id: "src",
      kind: "source",
      title: "Source title",
      why: "Source finding text",
      status: "open",
    },
    {
      type: "edge.added",
      from: "main",
      to: "src",
      link: "supported_by",
      why: "w",
    },
  );
  const q = await werk(p, "quote", "main", "talk", "must last fifteen");
  expect(q.code).toBe(0);
  expect((await werk(p, "accept", "main:ex0", "--actor", "you")).code).toBe(0);
  const r = await werk(p, "show", "main");
  expect(r.code).toBe(0);
  const out = r.stdout;
  expect(out).toMatch(/depends_on\s+other/);
  expect(out).toContain("main takes other");
  const options = out.indexOf("Options");
  expect(options).toBeGreaterThan(out.indexOf("depends_on"));
  expect(out.slice(options)).toContain("Option title");
  expect(out.slice(options)).toContain("why not this");
  expect(out).toMatch(/^\s*Say\b/m);
  expect(out).toContain("you");
  expect(out).toContain("the link must last fifteen minutes");
  expect(out).toMatch(/^\s*Ev\b/m);
  const ev = out.slice(out.search(/^\s*Ev\b/m));
  expect(ev).toContain("Source title");
  expect(ev).toContain("Source finding text");
  expect(ev).toContain("proposed");
});

test("11.4 a card with no options prints no Options section", async () => {
  chat();
  seedMap(
    p,
    open("main", { title: "Main card" }),
    {
      type: "node.proposed",
      id: "src",
      kind: "source",
      title: "Source title",
      why: "Source finding text",
      status: "open",
    },
    {
      type: "edge.added",
      from: "main",
      to: "src",
      link: "supported_by",
      why: "w",
    },
  );
  expect((await werk(p, "quote", "main", "talk", "must last fifteen")).code).toBe(0);
  const out = (await werk(p, "show", "main")).stdout;
  expect(out).toMatch(/^\s*Say\b/m);
  expect(out).toMatch(/^\s*Ev\b/m);
  expect(out).not.toContain("Options");
});

test("11.5 show with no id prints the root card", async () => {
  seedMap(
    p,
    open("root", { title: "The root card" }),
    open("second", { title: "Second card", parent: "root" }),
  );
  const r = await werk(p, "show");
  expect(r.code).toBe(0);
  expect(r.stdout).toContain("The root card");
  expect(rollupLines(r.stdout).length).toBeGreaterThan(0);
  expect(r.stdout).toMatch(/<- refines\s+second/);
  expect(r.stdout).toContain("Second card");
});
