import { afterEach, beforeEach, expect, test } from "bun:test";
import { type World, child, decided, decidedChild, ghost, link, open, world } from "./support.ts";

let w: World;
beforeEach(() => {
  w = world();
});
afterEach(() => w.project.dispose());

const rollupLine = (out: string) => out.split("\n").filter((l) => /\bcards?\b/.test(l) && /\bopen\b/.test(l));

function mix() {
  w.seed(
    decided("root", { title: "Root" }),
    open("c1", { title: "Child open", parent: "root" }),
    open("c2", { title: "Child proto", parent: "root", status: "proto" }),
    decided("g1", { title: "Grandchild", parent: "c1" }),
  );
}

test("11.1 the rollup counts the card and its whole refines subtree", async () => {
  mix();
  const r = await w.werk("show", "root");
  expect(r.code, r.stderr).toBe(0);
  const lines = rollupLine(r.stdout);
  expect(lines).toHaveLength(1);
  expect(lines[0]).toMatch(/\b4 cards\b/);
  expect(lines[0]).toMatch(/\b1 open\b/);
  expect(lines[0]).toMatch(/\b1 proto\b/);
  expect(lines[0]).toMatch(/\b2 decided\b/);
});

test("11.2 each incoming refines link shows the child's own rollup", async () => {
  w.seed(
    decided("parent", { title: "Parent" }),
    open("kid", { title: "Kid", parent: "parent" }),
    open("gk1", { title: "Grand open", parent: "kid" }),
    decided("gk2", { title: "Grand decided", parent: "kid" }),
  );
  const r = await w.werk("show", "parent");
  const out = r.stdout;
  expect(out).toMatch(/<- refines\s+kid/);
  const link = out.split("\n").find((l) => /<- refines\s+kid/.test(l)) ?? "";
  const next = out.split("\n")[out.split("\n").indexOf(link) + 1] ?? "";
  expect(`${link}\n${next}`).toMatch(/\b3 cards\b/);
  expect(out).toMatch(/\b4 cards\b/);
});

test("11.3 a card prints options, excerpts and a proposed source with their words", async () => {
  w.seed(
    decided("other", { title: "Other card" }),
    open("card", { title: "The card" }),
    link("card", "other", "depends_on"),
    open("card:opt0", { kind: "option", title: "Use files", why: "files are slow" }),
    link("card:opt0", "card", "alternative_to"),
    ghost("src1", { kind: "source", title: "Pricing study", why: "Seats win at scale" }),
    link("card", "src1", "supported_by"),
  );
  w.chat("pricing", { speaker: "person", at: "10:02", session: "6ae61be7", kind: "spoken", text: "seats are the unit we bill" });
  const q = await w.werk("quote", "card", "pricing", "seats are the unit we bill");
  expect(q.code, q.stderr).toBe(0);
  const r = await w.werk("show", "card");
  const out = r.stdout;
  expect(out).toContain("depends_on");
  expect(out).toMatch(/Options/);
  expect(out).toContain("Use files");
  expect(out).toContain("files are slow");
  expect(out).toMatch(/Say/);
  expect(out).toContain("person");
  expect(out).toContain("seats are the unit we bill");
  expect(out).toMatch(/\bEv\b/);
  expect(out).toContain("Pricing study");
  expect(out).toContain("Seats win at scale");
  expect(out).toMatch(/Pricing study[\s\S]*proposed/);
});

test("11.4 a card with no options prints no Options section", async () => {
  w.seed(
    open("card", { title: "The card" }),
    ghost("src1", { kind: "source", title: "Pricing study", why: "finding" }),
    link("card", "src1", "supported_by"),
  );
  w.chat("pricing", { speaker: "person", at: "10:02", session: "6ae61be7", kind: "spoken", text: "seats are the unit" });
  await w.werk("quote", "card", "pricing", "seats are the unit");
  const out = (await w.werk("show", "card")).stdout;
  expect(out).toMatch(/\bSay\b/);
  expect(out).toMatch(/\bEv\b/);
  expect(out).not.toMatch(/Options/);
});

test("11.5 show with no id prints the root card", async () => {
  w.seed(decided("root", { title: "The root" }), open("second", { title: "Second card", parent: "root" }));
  const r = await w.werk("show");
  expect(r.code, r.stderr).toBe(0);
  expect(r.stdout).toContain("The root");
  expect(r.stdout).toMatch(/\b2 cards\b/);
  expect(r.stdout).toMatch(/<- refines\s+second/);
});
