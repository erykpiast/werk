import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Cli, cli, decided, link, open } from "./cli.ts";

let c: Cli;
beforeEach(() => {
  c = cli();
});
afterEach(() => c.dispose());

test("11.1 the rollup counts the card and its refines subtree", async () => {
  c.write([
    ...decided("root", { title: "Root" }),
    ...decided("c1", { title: "C1", parent: "root" }),
    ...open("c2", { title: "C2", parent: "root", status: "proto" }),
    ...decided("g", { title: "G", parent: "c1" }),
    { type: "node.reopened", id: "c1", reason: "rejected" },
  ]);
  const out = (await c.werk("show", "root")).stdout;
  expect(out.match(/^rollup: .*$/gm)).toEqual(["rollup: 4 cards: 1 open, 1 proto, 2 decided"]);
});

test("11.2 each incoming refines link shows the child's own rollup", async () => {
  c.write([
    ...open("parent", { title: "Parent" }),
    ...open("child", { title: "Child", parent: "parent" }),
    ...open("g1", { title: "G1", parent: "child" }),
    ...decided("g2", { title: "G2", parent: "child" }),
  ]);
  const out = (await c.werk("show", "parent")).stdout;
  expect(out).toMatch(/<-\s+refines\s+child\s+Child\s+\(rollup: 3 cards: /);
  expect(out).toMatch(/^rollup: 4 cards/m);
});

async function richCard() {
  c.write([
    ...open("other", { title: "Other card" }),
    ...open("main", { title: "Main card" }),
    link("main", "other", "depends_on"),
    ...open("opt", { title: "Hosted option", kind: "option", why: "costs too much" }),
    { type: "edge.added", from: "opt", to: "main", link: "alternative_to", why: "" },
    { type: "node.proposed", id: "src", kind: "source", title: "The benchmark", why: "it is slow", status: "open" },
    { type: "edge.added", from: "main", to: "src", link: "supported_by", why: "" },
  ]);
}
function chat() {
  const dir = join(c.project.dir, ".werk", "chats");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "talk.jsonl"), `${JSON.stringify({ speaker: "person", at: "10:02", session: "s1", kind: "spoken", text: "we must keep it simple" })}\n`);
}

test("11.3 a card prints links, options, say and ev sections", async () => {
  await richCard();
  chat();
  expect((await c.werk("quote", "main", "talk", "we must keep it simple")).code).toBe(0);
  await c.werk("accept", "main:ex0", "--actor", "you");
  const out = (await c.werk("show", "main")).stdout;
  expect(out).toMatch(/->\s+depends_on\s+other.*\n\s+why: /);
  const iLink = out.indexOf("depends_on");
  const iOpt = out.indexOf("Options:");
  expect(iOpt).toBeGreaterThan(iLink);
  expect(out).toMatch(/Options:\n\s+opt\s+Hosted option\n\s+why not: costs too much/);
  expect(out).toMatch(/Say:\n\s+person: we must keep it simple/);
  expect(out).toMatch(/Ev:\n\s+src\s+The benchmark\s+proposed\n\s+finding: it is slow/);
});

test("11.4 a card with no options prints no Options section", async () => {
  c.write([
    ...open("main", { title: "Main card" }),
    { type: "node.proposed", id: "src", kind: "source", title: "The benchmark", why: "slow", status: "open" },
    { type: "edge.added", from: "main", to: "src", link: "supported_by", why: "" },
  ]);
  chat();
  expect((await c.werk("quote", "main", "talk", "we must keep it simple")).code).toBe(0);
  const out = (await c.werk("show", "main")).stdout;
  expect(out).toContain("Say:");
  expect(out).toContain("Ev:");
  expect(out).not.toContain("Options");
});

test("11.5 show with no id prints the root card", async () => {
  c.write([...open("root", { title: "The root" }), ...open("kid", { title: "Kid", parent: "root" })]);
  const out = (await c.werk("show")).stdout;
  expect(out).toContain("The root");
  expect(out).toMatch(/^rollup: 2 cards/m);
  expect(out).toMatch(/<-\s+refines\s+kid\s+Kid\s+\(rollup: 1 cards/);
});
