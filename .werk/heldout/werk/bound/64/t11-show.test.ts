import { afterEach, beforeEach, expect, test } from "bun:test";
import { decided, link, open } from "../src/map/mark-fixtures.ts";
import { accepted, chat, createProject, type Project, realDecided, seed, spoken, werk } from "./h.ts";

let p: Project;
beforeEach(() => {
  p = createProject();
});
afterEach(() => p.dispose());

test("11.1 rollup counts the card and its subtree", async () => {
  seed(
    p,
    realDecided("root", { title: "Root" }),
    open("c1", { parent: "root" }),
    open("c2", { parent: "root", status: "proto" }),
    realDecided("gc", { parent: "c1" }),
  );
  const r = (await werk(p, "show", "root")).stdout;
  const rl = r.split("\n").filter((l) => l.startsWith("rollup:"));
  expect(rl.length).toBe(1);
  expect(rl[0]).toBe("rollup: 4 cards: 1 open, 1 proto, 2 decided");
});

test("11.2 incoming refines link shows the child's own rollup", async () => {
  seed(
    p,
    realDecided("parent"),
    open("child", { parent: "parent" }),
    open("g1", { parent: "child" }),
    realDecided("g2", { parent: "child" }),
  );
  const r = (await werk(p, "show", "parent")).stdout;
  expect(r).toContain("rollup: 4 cards");
  expect(r).toMatch(/<- refines\s+child .*\(rollup: 3 cards:/);
});

test("11.3 options, say and ev sections", async () => {
  seed(
    p,
    decided("base"),
    open("card", { title: "Card" }),
    link("card", "base", "depends_on"),
    open("card:opt0", { kind: "option", title: "Alt option", why: "too slow" }),
    link("card:opt0", "card", "alternative_to"),
  );
  chat(p, "talk", spoken("we do want this exactly"));
  await werk(p, "quote", "card", "talk", "we do want this exactly");
  await werk(p, "add", "src1", "--kind", "source", "--title", "Source title", "--why", "the finding text");
  await werk(p, "link", "card", "src1", "--type", "supported_by");
  const r = (await werk(p, "show", "card")).stdout;
  expect(r).toMatch(/-> depends_on\s+base[\s\S]*why: card takes base/);
  const iLinks = r.indexOf("-> depends_on");
  const iOpt = r.indexOf("Options:");
  expect(iOpt).toBeGreaterThan(iLinks);
  expect(r).toContain("Alt option");
  expect(r).toContain("why not: too slow");
  expect(r).toContain("Say:\n  person: we do want this exactly");
  expect(r).toMatch(/Ev:\n\s+src1\s+Source title\s+proposed\n\s+finding: the finding text/);
});

test("11.4 no options, no Options section", async () => {
  seed(p, open("card"));
  chat(p, "talk", spoken("said words"));
  await werk(p, "quote", "card", "talk", "said words");
  await werk(p, "add", "src1", "--kind", "source", "--title", "S", "--why", "f");
  await werk(p, "link", "card", "src1", "--type", "supported_by");
  const r = (await werk(p, "show", "card")).stdout;
  expect(r).toContain("Say:");
  expect(r).toContain("Ev:");
  expect(r).not.toContain("Options");
});

test("11.5 show with no id prints the root", async () => {
  seed(p, open("root", { title: "The Root" }), open("second", { parent: "root", title: "Second" }));
  const r = await werk(p, "show");
  expect(r.code).toBe(0);
  expect(r.stdout).toContain("The Root");
  expect(r.stdout).toMatch(/rollup: 2 cards/);
  expect(r.stdout).toMatch(/<- refines\s+second\s+Second\s+\(rollup: 1 cards/);
});
