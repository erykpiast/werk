// Held-out steps 11.1-11.5: show and its rollups.
import { expect, test } from "bun:test";
import { card, chat, link, ok, seeded } from "./cli-helpers.ts";

const rollupLine = (text: string) => text.split("\n").find((l) => l.startsWith("subtree:")) ?? "";
const num = (line: string, word: string) => Number(new RegExp(`(\\d+) ${word}`).exec(line)?.[1] ?? "NaN");

test("11.1 the rollup counts the card and its whole refines subtree", async () => {
  const p = seeded([
    card("root", "Root", { status: "decided" }),
    card("c1", "Child one", { parent: "root" }),
    card("c2", "Child two", { parent: "root", status: "proto" }),
    card("g1", "Grandchild", { parent: "c1", status: "decided" }),
  ]);
  const shown = (await ok(p, ["show", "root"])).out;
  expect(shown.split("\n").filter((l) => l.startsWith("subtree:"))).toHaveLength(1);
  const line = rollupLine(shown);
  expect(num(line, "cards?")).toBe(4);
  expect(num(line, "open")).toBe(1);
  expect(num(line, "proto")).toBe(1);
  expect(num(line, "decided")).toBe(2);
  expect(num(line, "open") + num(line, "proto") + num(line, "decided")).toBe(num(line, "cards?"));
});

test("11.2 each incoming refines link shows the child's own rollup", async () => {
  const p = seeded([
    card("parent", "Parent"),
    card("child", "Child", { parent: "parent" }),
    card("g1", "Grand one", { parent: "child" }),
    card("g2", "Grand two", { parent: "child", status: "decided" }),
  ]);
  const shown = (await ok(p, ["show", "parent"])).out;
  const incoming = shown.split("\n").find((l) => /<- refines\s+child/.test(l)) ?? "";
  expect(incoming).not.toBe("");
  expect(num(incoming, "cards?")).toBe(3);
  expect(num(rollupLine(shown), "cards?")).toBe(4);
});

test("11.3 a card prints its options, excerpts and a proposed source with their words", async () => {
  const p = seeded([
    card("root", "Root"),
    card("base", "Base card", { parent: "root", status: "decided" }),
    card("c", "The card", { parent: "root" }),
    link("c", "base", "depends_on", "the card reuses the base format"),
    ["node.added", { id: "c:opt0", kind: "option", title: "Plain files", why_not: "No atomic writes." }],
    link("c:opt0", "c", "alternative_to"),
  ]);
  chat(p, "talk", [{ speaker: "person", at: "2026-10-01T10:00:00Z", session: "s1", kind: "spoken", text: "keep the base format please" }]);
  await ok(p, ["quote", "c", "talk", "keep the base format"]);
  await ok(p, ["add", "src1", "--kind", "source", "--title", "Format study", "--url", "https://example.com", "--finding", "The base format is stable."]);
  await ok(p, ["link", "c", "src1", "--type", "supported_by"]);
  const shown = (await ok(p, ["show", "c"])).out;
  const ls = shown.split("\n");
  expect(shown).toMatch(/-> depends_on\s+base.*/);
  expect(shown).toContain("the card reuses the base format");
  const lastLink = ls.findLastIndex((l) => /^\s+(->|<-) /.test(l));
  const opts = ls.indexOf("Options");
  expect(opts).toBeGreaterThan(lastLink);
  const optText = ls.slice(opts).join("\n");
  expect(optText).toContain("Plain files");
  expect(optText).toContain("No atomic writes.");
  const say = ls.indexOf("Say");
  expect(say).toBeGreaterThan(-1);
  expect(ls.slice(say).join("\n")).toContain('person: "keep the base format"');
  const ev = ls.indexOf("Ev");
  expect(ev).toBeGreaterThan(-1);
  const evText = ls.slice(ev).join("\n");
  expect(evText).toContain("Format study");
  expect(evText).toContain("The base format is stable.");
  expect(ls.slice(ev).find((l) => l.includes("src1") && l.includes("Format study"))).toContain("proposed");
});

test("11.4 a card with no options prints no Options section", async () => {
  const p = seeded([
    card("root", "Root"),
    card("c", "The card", { parent: "root" }),
    ["node.added", { id: "src1", kind: "source", title: "Study", url: "https://e.com", finding: "found" }],
    link("c", "src1", "supported_by"),
  ]);
  chat(p, "talk", [{ speaker: "agent", at: "t1", session: "s1", kind: "spoken", text: "one exact sentence" }]);
  await ok(p, ["quote", "c", "talk", "one exact sentence"]);
  const ls = (await ok(p, ["show", "c"])).out.split("\n");
  expect(ls).toContain("Say");
  expect(ls).toContain("Ev");
  expect(ls).not.toContain("Options");
});

test("11.5 show with no id prints the root card", async () => {
  const p = seeded([card("root", "The root title"), card("second", "Second card", { parent: "root" })]);
  const shown = (await ok(p, ["show"])).out;
  expect(shown).toContain("The root title");
  expect(rollupLine(shown)).toMatch(/2 cards/);
  const incoming = shown.split("\n").find((l) => /<- refines\s+second/.test(l)) ?? "";
  expect(incoming).toMatch(/\(1 card/);
});
