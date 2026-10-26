// 11.1 - 11.5: werk show prints rollups and the sections of a card.
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decided, ghost, link, open } from "../src/map/mark-fixtures.ts";
import { useTools } from "./support.ts";

const t = useTools();
const rollupLine = (out: string, cards: number) =>
  out.split("\n").find((l) => new RegExp(`\\b${cards} cards?\\b`).test(l));

test("11.1 the rollup counts the card and its refines subtree", async () => {
  t().seed(
    decided("root", { title: "Root" }),
    open("c1", { title: "Child one", parent: "root" }),
    open("c2", { title: "Child two", parent: "root", status: "proto" }),
    decided("g1", { title: "Grandchild", parent: "c1" }),
  );
  const r = await t().werk("show", "root");
  expect(r.code, r.stderr).toBe(0);
  const line = rollupLine(r.stdout, 4);
  expect(line, r.stdout).toBeDefined();
  expect(line).toMatch(/\b1 open\b/);
  expect(line).toMatch(/\b1 proto\b/);
  expect(line).toMatch(/\b2 decided\b/);
  expect(r.stdout.split("\n").filter((l) => /\b\d+ cards?\b/.test(l) && /decided/.test(l))).toHaveLength(1);
});

test("11.2 each incoming refines link shows the child's own rollup", async () => {
  t().seed(
    decided("parent", { title: "Parent" }),
    open("child", { title: "Child card", parent: "parent" }),
    open("g1", { title: "Grand one", parent: "child" }),
    decided("g2", { title: "Grand two", parent: "child" }),
  );
  const r = await t().werk("show", "parent");
  expect(r.code, r.stderr).toBe(0);
  const lines = r.stdout.split("\n");
  const linkRow = lines.find((l) => /<- refines\s+child\b/.test(l));
  expect(linkRow, r.stdout).toBeDefined();
  const idx = lines.indexOf(linkRow as string);
  // The rollup may sit on the link row or on the line under it.
  expect(`${linkRow}\n${lines[idx + 1] ?? ""}`).toMatch(/\b3 cards?\b/);
  const own = lines.filter((l) => !/<- refines/.test(l) && /\b4 cards?\b/.test(l));
  expect(own, r.stdout).toHaveLength(1);
});

function sourcesAndExcerpt(withOption: boolean) {
  const { project, seed } = t();
  const dir = join(project.dir, ".werk", "chats");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "talk.jsonl"),
    `${JSON.stringify({ speaker: "maya", at: "10:02", session: "6ae61be7", kind: "spoken", text: "the link must expire after 15 minutes" })}\n`,
  );
  seed(
    decided("base", { title: "Base card" }),
    decided("card", { title: "Main card" }),
    link("card", "base"),
    ghost("card:src", { kind: "source", title: "Security memo", why: "Links should expire after 15 minutes", body: "Links should expire after 15 minutes" }),
    { type: "edge.added", from: "card", to: "card:src", link: "supported_by", why: "" },
  );
  if (withOption) {
    seed(
      open("card:opt0", { kind: "option", title: "Never expire", why: "Leaks stay valid forever" }),
      { type: "edge.added", from: "card:opt0", to: "card", link: "alternative_to", why: "" },
    );
  }
}

test("11.3 a card prints its options, excerpts and a proposed source with their words", async () => {
  // The depends-on link needs a reason (link() gives one).
  sourcesAndExcerpt(true);
  const { werk } = t();
  const q = await werk("quote", "card", "talk", "must expire after 15 minutes");
  expect(q.code, q.stderr).toBe(0);
  await werk("accept", "card:ex0", "--actor", "you");
  const r = await werk("show", "card");
  expect(r.code, r.stderr).toBe(0);
  const out = r.stdout;
  expect(out).toMatch(/depends_on\s+base[\s\S]*why: card takes base/);
  const linksAt = out.indexOf("depends_on");
  const optionsAt = out.search(/^Options\b/m);
  expect(optionsAt, out).toBeGreaterThan(linksAt);
  expect(out.slice(optionsAt)).toContain("Never expire");
  expect(out.slice(optionsAt)).toContain("Leaks stay valid forever");
  const say = out.search(/^Say\b/m);
  expect(say, out).toBeGreaterThanOrEqual(0);
  expect(out.slice(say)).toContain("maya");
  expect(out.slice(say)).toContain("must expire after 15 minutes");
  const ev = out.search(/^Ev\b/m);
  expect(ev, out).toBeGreaterThanOrEqual(0);
  expect(out.slice(ev)).toContain("Security memo");
  expect(out.slice(ev)).toContain("Links should expire after 15 minutes");
  expect(out.slice(ev)).toContain("proposed");
});

test("11.4 a card with no options prints no Options section", async () => {
  sourcesAndExcerpt(false);
  const { werk } = t();
  await werk("quote", "card", "talk", "must expire after 15 minutes");
  await werk("accept", "card:ex0", "--actor", "you");
  const r = await werk("show", "card");
  expect(r.code, r.stderr).toBe(0);
  expect(r.stdout).toMatch(/^Say\b/m);
  expect(r.stdout).toMatch(/^Ev\b/m);
  expect(r.stdout).not.toMatch(/^Options\b/m);
});

test("11.5 show with no id prints the root card", async () => {
  t().seed(decided("root", { title: "The root card" }), open("second", { title: "Second card", parent: "root" }));
  const r = await t().werk("show");
  expect(r.code, r.stderr).toBe(0);
  expect(r.stdout).toContain("The root card");
  expect(r.stdout).toMatch(/\b2 cards?\b/);
  const row = r.stdout.split("\n").findIndex((l) => /<- refines\s+second\b/.test(l));
  expect(row).toBeGreaterThanOrEqual(0);
  const lines = r.stdout.split("\n");
  expect(`${lines[row]}\n${lines[row + 1] ?? ""}`).toMatch(/\b1 cards?\b/);
});
