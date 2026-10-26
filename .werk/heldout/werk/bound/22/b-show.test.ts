import { afterEach, expect, test } from "bun:test";
import { chat } from "./b-helpers.ts";
import { cleanupAll, project } from "./cli.ts";

afterEach(cleanupAll);

const subtree = (out: string) => out.split("\n").filter((l) => l.startsWith("subtree:"));
const count = (line: string, word: string) => Number(new RegExp(`(\\d+) ${word}`).exec(line)?.[1] ?? 0);

test("11.1 rollup counts card and whole subtree", () => {
  const p = project();
  p.card("root", "Root", { status: "decided" });
  p.card("child-open", "Child open", { parent: "root" });
  p.card("child-proto", "Child proto", { parent: "root", status: "proto" });
  p.card("grandchild", "Grandchild", { parent: "child-open", status: "decided" });
  const out = p.werk("show", "root").out;
  const lines = subtree(out);
  expect(lines.length).toBe(1);
  const l = lines[0] as string;
  expect(count(l, "cards?")).toBe(4);
  expect(count(l, "open")).toBe(1);
  expect(count(l, "proto")).toBe(1);
  expect(count(l, "decided")).toBe(2);
  expect(count(l, "open") + count(l, "proto") + count(l, "decided")).toBe(count(l, "cards?"));
});

test("11.2 incoming refines link shows the child's own rollup", () => {
  const p = project();
  p.card("root", "Root");
  p.card("parent", "Parent", { parent: "root" });
  p.card("child", "Child", { parent: "parent" });
  p.card("g-open", "Grand open", { parent: "child" });
  p.card("g-decided", "Grand decided", { parent: "child", status: "decided" });
  const out = p.werk("show", "parent").out;
  const link = out.split("\n").find((l) => /^\s+<- refines\s+child\s/.test(l));
  expect(link).toBeDefined();
  expect(link).toMatch(/\(3 cards/);
  expect(count(subtree(out)[0] as string, "cards?")).toBe(4);
});

test("11.3 card prints options, excerpts and proposed source with their words", () => {
  const p = project();
  p.card("root", "Root");
  p.card("basis", "Basis card", { parent: "root", status: "decided" });
  p.card("card", "The card", { parent: "root" });
  p.seed("edge.added", { from: "card", to: "basis", type: "depends_on", why: "takes the format from it" });
  p.seed("node.added", { id: "card:opt0", kind: "option", title: "Other way", why_not: "too slow" });
  p.seed("edge.added", { from: "card:opt0", to: "card", type: "alternative_to" });
  chat(p, "talk", [
    { speaker: "person", at: "2026-10-01T00:00:00Z", session: "s1", kind: "spoken", text: "keep every write forever" },
  ]);
  expect(p.werk("quote", "card", "talk", "keep every write forever").code).toBe(0);
  expect(p.werk("add", "paper", "--kind", "source", "--title", "Log paper", "--finding", "logs scale").code).toBe(0);
  expect(p.werk("link", "card", "paper", "--type", "supported_by").code).toBe(0);
  const out = p.werk("show", "card").out;
  const lines = out.split("\n");
  const dep = lines.findIndex((l) => /^\s+-> depends_on\s+basis/.test(l));
  expect(dep).toBeGreaterThan(-1);
  expect(lines[dep + 1]).toContain("takes the format from it");
  const lastLink = lines.reduce((acc, l, i) => (/^\s+(->|<-)\s/.test(l) ? i : acc), -1);
  const opts = lines.indexOf("Options");
  expect(opts).toBeGreaterThan(lastLink);
  const optText = lines.slice(opts).join("\n");
  expect(optText).toContain("Other way");
  expect(optText).toContain("too slow");
  const say = lines.indexOf("Say");
  expect(say).toBeGreaterThan(-1);
  const sayText = lines.slice(say, say + 4).join("\n");
  expect(sayText).toContain("person");
  expect(sayText).toContain("keep every write forever");
  const ev = lines.indexOf("Ev");
  expect(ev).toBeGreaterThan(-1);
  const evText = lines.slice(ev, ev + 3).join("\n");
  expect(evText).toContain("Log paper");
  expect(evText).toContain("logs scale");
  expect(lines[ev + 1]).toContain("proposed");
});

test("11.4 no options, no Options section", () => {
  const p = project();
  p.card("root", "Root");
  p.card("card", "The card", { parent: "root" });
  chat(p, "talk", [
    { speaker: "person", at: "2026-10-01T00:00:00Z", session: "s1", kind: "spoken", text: "say it once" },
  ]);
  p.werk("quote", "card", "talk", "say it once");
  p.werk("add", "paper", "--kind", "source", "--title", "Paper", "--finding", "found");
  p.werk("link", "card", "paper", "--type", "supported_by");
  const lines = p.werk("show", "card").out.split("\n");
  expect(lines).toContain("Say");
  expect(lines).toContain("Ev");
  expect(lines).not.toContain("Options");
});

test("11.5 show with no id prints the root card", () => {
  const p = project();
  p.card("root", "Root of the map");
  p.card("second", "Second card", { parent: "root" });
  p.card("leaf", "Leaf", { parent: "second", status: "decided" });
  const out = p.werk("show").out;
  expect(out).toContain("Root of the map");
  expect(subtree(out).length).toBe(1);
  expect(out).toMatch(/^\s+<- refines\s+second\s+Second card\s+\(2 cards/m);
});
