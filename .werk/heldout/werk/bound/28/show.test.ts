import { expect } from "bun:test";
import { decided, ghost, link, open } from "../src/map/mark-fixtures.ts";
import { type Ctx, t } from "./helpers.ts";

const excerpt = (card: string) => ({
  type: "excerpt.quoted",
  id: `${card}:ex0`,
  title: "the exact words",
  card,
  conversation: "talk",
  session: "6ae61be7",
  message: 0,
  start: 0,
  end: 15,
  speaker: "Ada",
  said_at: "10:02",
});
const rollupLines = (s: string) => s.split("\n").filter((l) => /\brollup\b|\bcards?\b.*\bopen\b/i.test(l));

t("11.1 the rollup counts the card and its refines subtree", async (ctx) => {
  ctx.seed(
    ...decided("root", { title: "Root" }),
    ...open("c1", { parent: "root", title: "C1" }),
    ...open("c2", { parent: "root", title: "C2", status: "proto" }),
    ...decided("g", { parent: "c1", title: "G" }),
  );
  const r = await ctx.werk("show", "root");
  expect(r.code).toBe(0);
  const lines = rollupLines(r.stdout);
  expect(lines).toHaveLength(1);
  expect(lines[0]).toMatch(/\b4\b/);
  expect(lines[0]).toMatch(/1 open/);
  expect(lines[0]).toMatch(/1 proto/);
  expect(lines[0]).toMatch(/2 decided/);
});

t("11.2 each incoming refines link shows the child's own rollup", async (ctx) => {
  ctx.seed(
    ...decided("parent", { title: "Parent" }),
    ...open("child", { parent: "parent", title: "Child" }),
    ...open("g1", { parent: "child", title: "G1" }),
    ...decided("g2", { parent: "child", title: "G2" }),
  );
  const r = await ctx.werk("show", "parent");
  const out = r.stdout.split("\n");
  const own = out.find((l) => /rollup/i.test(l) && !l.includes("refines"));
  expect(own).toMatch(/\b4\b/);
  const link = out.find((l) => l.includes("<- refines") && l.includes("child"));
  expect(link).toMatch(/\b3\b/);
});

t("11.3 a card prints options, excerpts and a proposed source with their words", async (ctx) => {
  ctx.seed(
    ...decided("dep", { title: "Dep" }),
    ...open("card", { title: "Card" }),
    link("card", "dep", "depends_on"),
    ...open("opt", { kind: "option", title: "Option title", why: "why-not text" }),
    link("opt", "card", "alternative_to"),
    ghost("src", { kind: "source", title: "Source title", why: "Finding text" }),
    link("card", "src", "supported_by"),
    excerpt("card"),
    { type: "node.accepted", id: "card:ex0", actor: "you" },
  );
  const r = await ctx.werk("show", "card");
  const out = r.stdout;
  expect(out).toContain("Ada");
  expect(out).toContain("the exact words");
  expect(out).toContain("depends_on");
  expect(out).toMatch(/Options/);
  expect(out).toContain("Option title");
  expect(out).toContain("why-not text");
  expect(out).toMatch(/\bSay\b/);
  expect(out).toMatch(/\bEv\b/);
  expect(out).toContain("Source title");
  expect(out).toContain("Finding text");
  expect(out).toContain("proposed");
});

t("11.4 a card with no options prints no Options section", async (ctx) => {
  ctx.seed(
    ...open("card", { title: "Card" }),
    excerpt("card"),
    { type: "node.accepted", id: "card:ex0", actor: "you" },
    ...open("src", { kind: "source", title: "Source title", why: "Finding" }),
    link("card", "src", "supported_by"),
  );
  const r = await ctx.werk("show", "card");
  expect(r.code).toBe(0);
  expect(r.stdout).toMatch(/\bSay\b/);
  expect(r.stdout).toMatch(/\bEv\b/);
  expect(r.stdout).not.toMatch(/Options/);
});

t("11.5 show with no id prints the root card", async (ctx) => {
  ctx.seed(...open("root", { title: "The root" }), ...open("second", { parent: "root", title: "Second" }));
  const r = await ctx.werk("show");
  expect(r.code).toBe(0);
  expect(r.stdout).toContain("The root");
  expect(r.stdout).toMatch(/rollup/i);
  expect(r.stdout).toMatch(/<- refines\s+second/);
});
