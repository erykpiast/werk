// werk/11: werk show prints a rollup line, per-link rollups, and the Options, Say and Ev sections.
import { expect, test } from "bun:test";
import { card, link, useWerk } from "./support.ts";

const w = useWerk();
const show = async (...args: string[]) => {
  const r = await w.run("show", ...args);
  expect(r.stderr).toBe("");
  expect(r.code).toBe(0);
  return r.stdout;
};
const rollupLines = (text: string) => text.split("\n").filter((l) => /rollup|\bcards?\b.*\bopen\b/i.test(l) && /\d+\s+cards?/i.test(l));

test("11.1 the rollup counts the card and its whole refines subtree", async () => {
  w.seed(
    ...card("root", { status: "decided" }),
    ...card("c1", { parent: "root", status: "open" }),
    ...card("c2", { parent: "root", status: "proto" }),
    ...card("g1", { parent: "c1", status: "decided" }),
  );
  const out = await show("root");
  const lines = rollupLines(out);
  expect(lines).toHaveLength(1);
  const [line] = lines as [string];
  expect(line).toMatch(/\b4 cards\b/);
  expect(line).toMatch(/\b1 open\b/);
  expect(line).toMatch(/\b1 proto\b/);
  expect(line).toMatch(/\b2 decided\b/);
});

test("11.2 each incoming refines link shows the child's own rollup", async () => {
  w.seed(
    ...card("parent", { status: "decided" }),
    ...card("child", { parent: "parent", status: "open" }),
    ...card("g1", { parent: "child", status: "open" }),
    ...card("g2", { parent: "child", status: "decided" }),
  );
  const out = await show("parent");
  const row = out.split("\n").find((l) => /<-\s+refines\s+child/.test(l));
  expect(row).toBeDefined();
  const after = out.split("\n").slice(out.split("\n").indexOf(row as string), out.split("\n").indexOf(row as string) + 3).join("\n");
  expect(after).toMatch(/\b3 cards\b/);
  expect(rollupLines(out).some((l) => /\b4 cards\b/.test(l))).toBe(true);
});

test("11.3 a card prints its options, excerpts and a proposed source with their words", async () => {
  w.seed(
    ...card("base", { status: "decided" }),
    ...card("pricing", { title: "Pricing" }),
    link("pricing", "base", "depends_on", "the plan sets the price"),
    { type: "node.proposed", id: "pricing:opt0", kind: "option", title: "Flat fee", why: "customers hate surprises", status: "open" },
    { type: "node.accepted", id: "pricing:opt0", actor: "you" },
    link("pricing:opt0", "pricing", "alternative_to"),
    { type: "node.proposed", id: "quote1", kind: "excerpt", title: "Ana", speaker: "Ana", body: "we pay per seat today", status: "open" },
    { type: "node.accepted", id: "quote1", actor: "you" },
    link("pricing", "quote1", "supported_by", "she said it"),
    { type: "node.proposed", id: "src1", kind: "source", title: "Seat study", why: "most firms pay per seat", status: "open" },
    link("pricing", "src1", "supported_by", "data"),
  );
  const out = await show("pricing");
  expect(out).toMatch(/depends_on\s+base[^\n]*\n\s+why: the plan sets the price/);
  const at = (needle: RegExp) => out.search(needle);
  expect(at(/Options/)).toBeGreaterThan(at(/depends_on/));
  expect(out).toMatch(/Options[\s\S]*Flat fee[\s\S]*customers hate surprises/);
  expect(out).toMatch(/Say[\s\S]*Ana[\s\S]*we pay per seat today/);
  expect(out).toMatch(/Ev[\s\S]*Seat study[\s\S]*most firms pay per seat[\s\S]*proposed/);
  expect(out).toMatch(/Seat study[^\n]*proposed|proposed[^\n]*Seat study/);
});

test("11.4 a card with no options prints no Options section", async () => {
  w.seed(
    ...card("pricing", { title: "Pricing" }),
    { type: "node.proposed", id: "quote1", kind: "excerpt", title: "Ana", body: "we pay per seat today", status: "open" },
    { type: "node.accepted", id: "quote1", actor: "you" },
    link("pricing", "quote1", "supported_by", "she said it"),
    { type: "node.proposed", id: "src1", kind: "source", title: "Seat study", status: "open" },
    { type: "node.accepted", id: "src1", actor: "you" },
    link("pricing", "src1", "supported_by", "data"),
  );
  const out = await show("pricing");
  expect(out).toMatch(/^Say\b/m);
  expect(out).toMatch(/^Ev\b/m);
  expect(out).not.toMatch(/Options/);
});

test("11.5 show with no id prints the root card", async () => {
  w.seed(...card("top", { title: "The top card" }), ...card("second", { parent: "top", title: "Second card" }));
  const r = await w.run("show");
  expect(r.stderr).toBe("");
  expect(r.code).toBe(0);
  expect(r.stdout).toContain("The top card");
  expect(rollupLines(r.stdout).length).toBeGreaterThan(0);
  const row = r.stdout.split("\n").findIndex((l) => /<-\s+refines\s+second/.test(l));
  expect(row).toBeGreaterThanOrEqual(0);
  expect(r.stdout.split("\n").slice(row, row + 3).join("\n")).toMatch(/\b1 cards?\b/);
});
