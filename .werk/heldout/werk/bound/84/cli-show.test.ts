import { expect, test } from "bun:test";
import { freshProject } from "../src/test/project.ts";
import { card, fresh, ok, seed } from "./cli-helpers.ts";

test("11.1 rollup counts card and subtree", async () => {
  const p = freshProject();
  seed(p, [
    card("root", "Root", { status: "decided" }),
    card("c1", "C1", { parent: "root" }),
    card("c2", "C2", { parent: "root", status: "proto" }),
    card("g", "G", { parent: "c1", status: "decided" }),
  ]);
  const out = (await ok(p, ["show", "root"])).out;
  const roll = out.split("\n").filter((l) => l.startsWith("subtree:"));
  expect(roll).toHaveLength(1);
  expect(roll[0]).toBe("subtree: 4 cards, 1 open, 1 proto, 2 decided");
});

test("11.2 incoming refines link shows child's rollup", async () => {
  const p = fresh([
    card("parent", "Parent", { parent: "root" }),
    card("child", "Child", { parent: "parent" }),
    card("g1", "G1", { parent: "child" }),
    card("g2", "G2", { parent: "child", status: "decided" }),
  ]);
  const out = (await ok(p, ["show", "parent"])).out;
  expect(out).toMatch(/<- refines\s+child\s+Child\s+\(3 cards/);
  expect(out).toContain("subtree: 4 cards");
});

const rich = () =>
  fresh([
    card("a", "A", { parent: "root", status: "decided" }),
    card("b", "B", { parent: "root" }),
    { type: "node.proposed", actor: "agent", payload: { id: "s1", kind: "source", title: "SrcT", finding: "FND" } },
    { type: "edge.added", payload: { from: "a", to: "s1", type: "supported_by" } },
    {
      type: "excerpt.quoted",
      actor: "agent",
      payload: { id: "a:ex0", title: "words said", card: "a", conversation: "c", session: "s", message: 0, start: 0, end: 10, speaker: "person", said_at: "t" },
    },
  ]);

test("11.3 options, say, ev sections", async () => {
  const p = await rich();
  seed(p, [
    { type: "edge.added", payload: { from: "a", to: "b", type: "depends_on", why: "because of reasons" } },
    { type: "node.added", payload: { id: "a:opt0", kind: "option", title: "OptT", why_not: "WN" } },
    { type: "edge.added", payload: { from: "a:opt0", to: "a", type: "alternative_to" } },
  ]);
  const out = (await ok(p, ["show", "a"])).out;
  expect(out).toContain("depends_on");
  expect(out).toContain("because of reasons");
  const links = out.indexOf("depends_on");
  const opt = out.indexOf("Options");
  expect(opt).toBeGreaterThan(links);
  expect(out.slice(opt)).toContain("OptT");
  expect(out.slice(opt)).toContain("WN");
  expect(out).toMatch(/Say\n\s+a:ex0\s+person: "words said"/);
  const ev = out.slice(out.indexOf("Ev\n"));
  expect(ev).toContain("SrcT");
  expect(ev).toContain("FND");
  expect(ev).toContain("proposed");
});

test("11.4 no options, no Options section", async () => {
  const p = rich();
  const out = (await ok(p, ["show", "a"])).out;
  expect(out).toContain("Say\n");
  expect(out).toContain("Ev\n");
  expect(out).not.toContain("Options");
});

test("11.5 show with no id prints root", async () => {
  const p = fresh([card("kid", "Kid", { parent: "root" })]);
  const out = (await ok(p, ["show"])).out;
  expect(out).toContain("Root");
  expect(out).toContain("subtree: 2 cards");
  expect(out).toMatch(/<- refines\s+kid\s+Kid\s+\(1 card/);
});
