import { expect, test } from "bun:test";
import { proj } from "./c-lib.ts";

const spoken = (speaker: string, text: string, kind = "spoken") => ({ speaker, at: "t0", session: "s1", kind, text });

test("11.1 rollup counts the subtree", () => {
  const p = proj();
  p.card("root", { title: "Root" }, true);
  p.card("c1", { title: "C1", parent: "root" });
  p.card("c2", { title: "C2", parent: "root", status: "proto" });
  p.card("g", { title: "G", parent: "c1" }, true);
  const r = p.werk("show", "root");
  const rollup = r.out.split("\n").filter((l) => l.startsWith("subtree"));
  expect(rollup.length).toBe(1);
  expect(rollup[0]).toContain("4 cards");
  expect(rollup[0]).toContain("1 open");
  expect(rollup[0]).toContain("1 proto");
  expect(rollup[0]).toContain("2 decided");
});

test("11.2 incoming refines link shows child's rollup", () => {
  const p = proj();
  p.card("parent", { title: "Parent" });
  p.card("child", { title: "Child", parent: "parent" });
  p.card("g1", { title: "G1", parent: "child" });
  p.card("g2", { title: "G2", parent: "child" }, true);
  const r = p.werk("show", "parent");
  const link = r.out.split("\n").find((l) => l.includes("<- refines") && l.includes("child"));
  expect(link).toBeDefined();
  expect(link).toContain("(3 cards");
  expect(r.out).toContain("subtree: 4 cards");
});

test("11.3 options, say, ev sections", () => {
  const p = proj();
  p.card("dep", { title: "Dep" }, true);
  p.card("c", { title: "C" });
  p.seed("edge.added", { from: "c", to: "dep", type: "depends_on", why: "takes the basis" });
  p.seed("node.added", { id: "c:opt0", kind: "option", title: "Opt title", why_not: "Opt why not" });
  p.seed("edge.added", { from: "c:opt0", to: "c", type: "alternative_to" });
  p.chat("t", [spoken("person", "we said these exact words")]);
  expect(p.werk("quote", "c", "t", "exact words").code).toBe(0);
  p.seed("node.proposed", { id: "s", kind: "source", title: "Src title", finding: "Src finding" });
  p.seed("edge.added", { from: "c", to: "s", type: "supported_by" });
  const out = p.werk("show", "c").out;
  expect(out).toContain("why: takes the basis");
  const iOpt = out.indexOf("Options\n");
  expect(iOpt).toBeGreaterThan(out.lastIndexOf("-> "));
  expect(out).toContain("Opt title");
  expect(out).toContain("why not: Opt why not");
  expect(out).toMatch(/Say\n.*person: "exact words"/);
  expect(out).toMatch(/Ev\n.*Src title.*proposed\n.*Src finding/);
});

test("11.4 no options, no Options section", () => {
  const p = proj();
  p.card("c", { title: "C" });
  p.chat("t", [spoken("person", "some words here")]);
  p.werk("quote", "c", "t", "words here");
  p.seed("node.added", { id: "s", kind: "source", title: "Src title", finding: "F" });
  p.seed("edge.added", { from: "c", to: "s", type: "supported_by" });
  const out = p.werk("show", "c").out;
  expect(out).toContain("Say\n");
  expect(out).toContain("Ev\n");
  expect(out).not.toContain("Options");
});

test("11.5 show with no id prints the root", () => {
  const p = proj();
  p.card("root", { title: "The root title" });
  p.card("second", { title: "Second", parent: "root" });
  const out = p.werk("show").out;
  expect(out).toContain("The root title");
  expect(out).toContain("subtree: 2 cards");
  expect(out).toMatch(/<- refines\s+second\s+Second\s+\(1 card/);
});

test("68.1 say then show", () => {
  const p = proj();
  p.card("werk-chat", { title: "The composer sends a live agent turn" }, true);
  const n = p.lines().length;
  const r = p.werk("say", "#werk-chat", "The reply streams over SSE");
  expect(r.code).toBe(0);
  expect(p.lines().length).toBe(n + 1);
  const ev = JSON.parse(p.lines().at(-1) as string);
  expect(ev.type).toBe("note.added");
  expect(ev.payload.id).toBe("werk-chat");
  expect(p.werk("show", "#werk-chat").out).toContain("The reply streams over SSE");
});

test("68.2 inbox thread in order", () => {
  const p = proj();
  p.card("werk-chat", { title: "Chat" });
  for (const t of ["first", "second", "third"]) p.werk("say", "werk-chat", t);
  const out = p.werk("inbox").out;
  expect(out).toContain("werk-chat");
  const [a, b, c] = ["first", "second", "third"].map((t) => out.indexOf(t));
  expect(a).toBeGreaterThanOrEqual(0);
  expect(b).toBeGreaterThan(a as number);
  expect(c).toBeGreaterThan(b as number);
});

test("68.3 inbox groups by card", () => {
  const p = proj();
  p.card("werk-chat", { title: "Chat" });
  p.card("visual", { title: "Visual" });
  p.werk("say", "werk-chat", "chat one");
  p.werk("say", "visual", "visual one");
  p.werk("say", "werk-chat", "chat two");
  const out = p.werk("inbox").out;
  const ci = out.indexOf("chat one");
  const ct = out.indexOf("chat two");
  const vi = out.indexOf("visual one");
  expect(ci).toBeGreaterThanOrEqual(0);
  expect(vi).toBeGreaterThanOrEqual(0);
  // group for #werk-chat shows chat one then chat two together, visual not between
  expect(ct).toBeGreaterThan(ci);
  expect(vi < ci || vi > ct).toBe(true);
  const visualGroup = out.slice(out.lastIndexOf("#visual"));
  expect(visualGroup).not.toContain("chat");
});

test("68.4 note on a ghost card", () => {
  const p = proj();
  p.card("visual", { title: "Visual" });
  p.seed("node.proposed", { id: "werk-pane", kind: "card", title: "Pane", parent: "visual" });
  p.seed("edge.added", { from: "visual", to: "werk-pane", type: "depends_on", why: "w" });
  expect(p.werk("say", "#werk-pane", "Describe the pane here").code).toBe(0);
  const out = p.werk("inbox").out;
  expect(out).toContain("werk-pane");
  expect(out).toContain("Describe the pane here");
});

test("68.5 note on an unknown card fails", () => {
  const p = proj();
  p.card("werk-chat", { title: "Chat" });
  const n = p.lines().length;
  const r = p.werk("say", "#no-such-card", "lost note");
  expect(r.code).not.toBe(0);
  expect(r.out + r.err).toContain("no-such-card");
  expect(p.lines().length).toBe(n);
  expect(p.werk("inbox").out).not.toContain("lost note");
});
