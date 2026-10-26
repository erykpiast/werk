import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Project } from "../src/test/project.ts";
import { card, ok, seeded } from "./helpers.ts";

function chat(p: Project, name: string, rows: object[]): void {
  mkdirSync(join(p.dir, ".werk", "chats"), { recursive: true });
  writeFileSync(join(p.dir, ".werk", "chats", `${name}.jsonl`), `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`);
}

test("11.1 the rollup counts the card and its whole refines subtree", async () => {
  const p = seeded([
    card("root", "Root", { status: "decided" }),
    card("c1", "Child one", { parent: "root" }),
    card("c2", "Child two", { parent: "root", status: "proto" }),
    card("g1", "Grandchild", { parent: "c1", status: "decided" }),
  ]);
  const out = (await ok(p, ["show", "root"])).out;
  const rollups = out.split("\n").filter((l) => l.startsWith("subtree:"));
  expect(rollups.length).toBe(1);
  const line = rollups[0] as string;
  expect(line).toContain("4 cards");
  expect(line).toContain("1 open");
  expect(line).toContain("1 proto");
  expect(line).toContain("2 decided");
});

test("11.2 each incoming refines link shows the child's own rollup", async () => {
  const p = seeded([
    card("parent", "Parent"),
    card("child", "Child", { parent: "parent" }),
    card("g1", "Grand one", { parent: "child" }),
    card("g2", "Grand two", { parent: "child", status: "decided" }),
  ]);
  const out = (await ok(p, ["show", "parent"])).out;
  const link = out.split("\n").find((l) => l.includes("<- refines") && l.includes("child")) ?? "";
  expect(link).toContain("3 cards");
  expect(link).not.toContain("4 cards");
  expect(out.split("\n").find((l) => l.startsWith("subtree:"))).toContain("4 cards");
});

test("11.3 a card prints its options, excerpts and a proposed source with their words", async () => {
  const p = seeded([
    card("root", "Root"),
    card("other", "Other card", { parent: "root" }),
    card("main", "Main card", { parent: "root" }),
    ["edge.added", { from: "main", to: "other", type: "depends_on", why: "main reads the grid of other" }],
    ["node.added", { id: "main:opt0", kind: "option", title: "Use a queue", why_not: "Too slow to start" }],
    ["edge.added", { from: "main:opt0", to: "main", type: "alternative_to" }],
  ]);
  chat(p, "talk", [{ speaker: "person", at: "t1", session: "s1", kind: "spoken", text: "we never rewrite the log" }]);
  await ok(p, ["quote", "main", "talk", "we never rewrite the log"]);
  await ok(p, ["accept", "main:ex0", "--actor", "you"]);
  await ok(p, ["add", "bench", "--kind", "source", "--title", "Bench run", "--finding", "Reads take 3 ms"]);
  await ok(p, ["link", "main", "bench", "--type", "supported_by"]);
  const out = (await ok(p, ["show", "main"])).out;
  expect(out).toContain("depends_on");
  expect(out).toContain("why: main reads the grid of other");
  const iDep = out.indexOf("depends_on");
  const iOpt = out.indexOf("\nOptions\n");
  const iSay = out.indexOf("\nSay\n");
  const iEv = out.indexOf("\nEv\n");
  expect(iOpt).toBeGreaterThan(iDep);
  const opt = out.slice(iOpt);
  expect(opt).toContain("Use a queue");
  expect(opt).toContain("Too slow to start");
  expect(iSay).toBeGreaterThan(-1);
  const say = out.slice(iSay, iEv > iSay ? iEv : undefined);
  expect(say).toContain("person");
  expect(say).toContain('"we never rewrite the log"');
  expect(iEv).toBeGreaterThan(-1);
  const ev = out.slice(iEv);
  expect(ev).toContain("Bench run");
  expect(ev).toContain("Reads take 3 ms");
  expect(ev.split("\n").find((l) => l.includes("Bench run"))).toContain("proposed");
});

test("11.4 a card with no options prints no Options section", async () => {
  const p = seeded([card("root", "Root"), card("main", "Main card", { parent: "root" })]);
  chat(p, "talk", [{ speaker: "agent", at: "t1", session: "s1", kind: "spoken", text: "one log per project" }]);
  await ok(p, ["quote", "main", "talk", "one log per project"]);
  await ok(p, ["add", "bench", "--kind", "source", "--title", "Bench run", "--finding", "Fast"]);
  await ok(p, ["link", "main", "bench", "--type", "supported_by"]);
  const out = (await ok(p, ["show", "main"])).out;
  expect(out).toContain("\nSay\n");
  expect(out).toContain("\nEv\n");
  expect(out).not.toContain("Options");
});

test("11.5 show with no id prints the root card", async () => {
  const p = seeded([card("root", "Root"), card("second", "Second", { parent: "root" })]);
  const run = await p.werk(["show"]);
  expect(run.code).toBe(0);
  expect(run.out).toContain("Root");
  expect(run.out).toContain("subtree:");
  expect(run.out).toContain("<- refines         second  Second  (1 card, 1 open)");
});
