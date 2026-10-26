import { expect, test } from "bun:test";
import { card, edge, ghost, lines, setupWerk } from "./support.ts";

const { werk, seed } = setupWerk();

const rollupLines = (text: string) =>
  lines(text).filter((l) => /rollup|\bcards?\b/i.test(l) && /\d/.test(l));

test("11.1 the rollup counts the card and its whole refines subtree", async () => {
  seed(
    card("root", { title: "Root card", status: "decided" }),
    card("c1", { title: "Child one", parent: "root" }),
    card("c2", { title: "Child two", status: "proto", parent: "root" }),
    card("g1", { title: "Grandchild", status: "decided", parent: "c1" }),
  );
  const r = await werk("show", "root");
  expect(r.code).toBe(0);
  const own = lines(r.stdout).filter((l) => /4 cards/.test(l));
  expect(own).toHaveLength(1);
  expect(own[0]).toMatch(/1 open/);
  expect(own[0]).toMatch(/1 proto/);
  expect(own[0]).toMatch(/2 decided/);
});

test("11.2 each incoming refines link shows the child's own rollup", async () => {
  seed(
    card("parent", { title: "Parent", status: "decided" }),
    card("child", { title: "Child", parent: "parent" }),
    card("gc1", { title: "Grand one", parent: "child" }),
    card("gc2", { title: "Grand two", status: "decided", parent: "child" }),
  );
  const r = await werk("show", "parent");
  expect(r.code).toBe(0);
  const out = lines(r.stdout);
  const link = out.find((l) => l.includes("<-") && l.includes("child"));
  expect(link).toBeDefined();
  expect(
    out.some(
      (l) => l.includes("<-") && l.includes("child") && /3 cards/.test(l),
    ) || out.some((l, i) => out[i - 1]?.includes("<-") && /3 cards/.test(l)),
  ).toBe(true);
  expect(out.some((l) => /4 cards/.test(l))).toBe(true);
});

test("11.3 a card prints its options, excerpts and a proposed source with their words", async () => {
  seed(
    card("dep", { title: "Dependency", status: "decided" }),
    card("main", { title: "Main card", why: "because" }),
    edge("main", "dep", "depends_on", "it takes the dependency"),
    card("main:opt0", {
      kind: "option",
      title: "The other way",
      why: "it costs too much",
    }),
    edge("main:opt0", "main", "alternative_to"),
    card("quote1", {
      kind: "excerpt",
      title: "Ana",
      body: "we must ship on friday",
    }),
    edge("main", "quote1", "supported_by"),
    ghost("src1", {
      kind: "source",
      title: "Survey results",
      why: "most want it",
    }),
    edge("main", "src1", "supported_by"),
  );
  const r = await werk("show", "main");
  expect(r.code).toBe(0);
  const text = r.stdout;
  expect(text).toContain("it takes the dependency");
  const optionsAt = text.indexOf("Options");
  expect(optionsAt).toBeGreaterThan(text.indexOf("depends_on"));
  expect(text.slice(optionsAt)).toContain("The other way");
  expect(text.slice(optionsAt)).toContain("it costs too much");
  expect(text).toMatch(/^Say/m);
  expect(text).toContain("we must ship on friday");
  expect(text).toMatch(/^Ev/m);
  const ev = text.slice(text.search(/^Ev/m));
  expect(ev).toContain("Survey results");
  expect(ev).toContain("most want it");
  expect(ev).toContain("proposed");
});

test("11.4 a card with no options prints no Options section", async () => {
  seed(
    card("main", { title: "Main card" }),
    card("quote1", {
      kind: "excerpt",
      title: "Ana",
      body: "we must ship on friday",
    }),
    edge("main", "quote1", "supported_by"),
    card("src1", {
      kind: "source",
      title: "Survey results",
      why: "most want it",
    }),
    edge("main", "src1", "supported_by"),
  );
  const text = (await werk("show", "main")).stdout;
  expect(text).toMatch(/^Say/m);
  expect(text).toMatch(/^Ev/m);
  expect(text).not.toContain("Options");
});

test("11.5 show with no id prints the root card", async () => {
  seed(
    card("top", { title: "Top card", status: "decided" }),
    card("second", { title: "Second card", parent: "top" }),
  );
  const r = await werk("show");
  expect(r.code).toBe(0);
  expect(r.stdout).toContain("Top card");
  expect(rollupLines(r.stdout).length).toBeGreaterThan(0);
  const link = lines(r.stdout).find(
    (l) => l.includes("<-") && l.includes("second"),
  );
  expect(link).toBeDefined();
});
