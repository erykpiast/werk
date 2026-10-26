import { afterEach, expect, test } from "bun:test";
import { head, linkLine } from "./b-helpers.ts";
import { cleanupAll, type P, project } from "./cli.ts";

afterEach(cleanupAll);

/** The printed fix commands: the indented lines that start with `werk `. */
const commands = (out: string) =>
  out
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("werk "));

/** Splits a printed command line into arguments, keeping quoted strings whole. */
function argv(line: string): string[] {
  const out: string[] = [];
  for (const m of line.matchAll(/"([^"]*)"|(\S+)/g)) out.push(m[1] ?? (m[2] as string));
  return out.slice(1);
}

function base(p: P) {
  p.card("root", "Root");
  p.card("basis", "Basis", { parent: "root", status: "decided" });
}

test("64.1 missing kill criterion: stays open, printed command fixes it", () => {
  const p = project();
  base(p);
  p.card("card", "The card", { parent: "root", who: "you" });
  p.seed("edge.added", { from: "card", to: "basis", type: "depends_on", why: "uses it" });
  p.seed("node.added", { id: "card:opt0", kind: "option", title: "Other", why_not: "worse" });
  p.seed("edge.added", { from: "card:opt0", to: "card", type: "alternative_to" });
  const before = p.lines().length;
  const r = p.werk("status", "card", "decided");
  expect(r.code).not.toBe(0);
  expect(r.all).toMatch(/kill criterion/);
  const cmds = commands(r.all).filter((c) => c.startsWith("werk kill card"));
  expect(cmds.length).toBeGreaterThan(0);
  expect(head(p, "card")).toContain("[open]");
  expect(
    p
      .events()
      .slice(before)
      .filter((e) => e.type === "node.decided").length,
  ).toBe(0);
  // The printed command with a concrete value in place of the placeholder.
  const fix = cmds.find((c) => c === "werk kill card --revisit") ?? (cmds[0] as string);
  const args = argv(fix).map((a) => a.replace(/^<.*>$/, "the value"));
  expect(p.werk(...args).code).toBe(0);
  expect(p.werk("status", "card", "decided").code).toBe(0);
  expect(head(p, "card")).toContain("[decided]");
});

test("64.2 several missing facts, each with its own command", () => {
  const p = project();
  base(p);
  p.card("card", "The card", { parent: "root", body: "Some text" });
  const r = p.werk("status", "card", "decided");
  expect(r.code).not.toBe(0);
  for (const fact of ["who", "basis", "option", "kill criterion"]) expect(r.all).toContain(`${fact}:`);
  const cmds = commands(r.all);
  expect(cmds.some((c) => c.startsWith("werk edit card --who"))).toBe(true);
  expect(cmds.some((c) => c.startsWith("werk link card") && c.includes("depends_on"))).toBe(true);
  expect(cmds.some((c) => c.startsWith("werk add card:opt0"))).toBe(true);
  expect(cmds.some((c) => c.startsWith("werk kill card"))).toBe(true);
  expect(head(p, "card")).toContain("[open]");
  // Run the first printed command of each fact, with concrete values for the placeholders.
  const run = [
    ["edit", "card", "--who", "you"],
    ["link", "card", "basis", "--type", "depends_on", "--why", "uses the basis"],
    ["add", "card:opt0", "--kind", "option", "--title", "Another way", "--why_not", "costs more"],
    ["link", "card:opt0", "card", "--type", "alternative_to"],
    ["kill", "card", "--revisit"],
  ];
  for (const args of run) expect(p.werk(...args).code).toBe(0);
  const r2 = p.werk("status", "card", "decided");
  expect(r2.code).toBe(0);
  expect(head(p, "card")).toContain("[decided]");
});

test("64.3 ghost obeys the same check through held edges", () => {
  const p = project();
  base(p);
  p.werk("add", "g1", "--title", "Ghost one", "--parent", "root", "--who", "you");
  p.werk("link", "g1", "basis", "--type", "depends_on", "--why", "uses it");
  p.werk("add", "g1:opt0", "--kind", "option", "--title", "Alt", "--why_not", "worse");
  p.werk("link", "g1:opt0", "g1", "--type", "alternative_to");
  p.werk("kill", "g1", "--revisit");
  p.werk("add", "g2", "--title", "Ghost two", "--parent", "root", "--who", "you");
  p.werk("add", "g2:opt0", "--kind", "option", "--title", "Alt", "--why_not", "worse");
  p.werk("link", "g2:opt0", "g2", "--type", "alternative_to");
  p.werk("kill", "g2", "--revisit");
  expect(p.werk("status", "g1", "decided").code).toBe(0);
  expect(head(p, "g1")).toContain("[decided]");
  const r = p.werk("status", "g2", "decided");
  expect(r.code).not.toBe(0);
  expect(r.all).toContain("basis:");
  expect(commands(r.all).some((c) => c.startsWith("werk link g2") && c.includes("depends_on"))).toBe(true);
  expect(head(p, "g2")).not.toContain("[decided]");
});

function decided(p: P) {
  base(p);
  p.card("card", "The card", { parent: "root", status: "decided", who: "you", body: "A long body that says a lot." });
  p.seed("edge.added", { from: "card", to: "basis", type: "depends_on", why: "uses it" });
  p.seed("node.added", { id: "card:opt0", kind: "option", title: "Other", why_not: "worse" });
  p.seed("edge.added", { from: "card:opt0", to: "card", type: "alternative_to" });
  p.seed("kill.added", { id: "card", criterion: { form: "revisit" } });
}

test("64.4 an amend that removes a required fact is refused", () => {
  const p = project();
  decided(p);
  const before = p.werk("show", "card").out;
  // The amend that drops the depends_on edge: the unlink of that edge.
  const r = p.werk("unlink", "card", "basis", "--type", "depends_on");
  expect(r.code).not.toBe(0);
  expect(r.all).toContain("basis");
  expect(commands(r.all).some((c) => c.includes("depends_on"))).toBe(true);
  expect(head(p, "card")).toContain("[decided]");
  expect(p.werk("show", "card").out).toBe(before);
  expect(linkLine(before, "depends_on", "basis")).toBeDefined();
});

test("64.5 an amend that keeps every fact succeeds; text not checked", () => {
  const p = project();
  decided(p);
  const before = p.lines().length;
  const prop = p.werk(
    "propose",
    "card",
    "--ops",
    JSON.stringify([{ tag: "elaborated", old: "A long body that says a lot.", new: "Short." }]),
  );
  expect(prop.code).toBe(0);
  const acc = p.werk("accept", "card", "--actor", "you");
  expect(acc.code).toBe(0);
  const s = p.werk("show", "card").out;
  expect(s.split("\n")[0]).toContain("[decided]");
  expect(s).toContain("Short.");
  const types = p
    .events()
    .slice(before)
    .map((e) => `${e.type}:${(e.payload as { reason?: string }).reason ?? ""}`);
  expect(types).toContain("node.reopened:amended");
  expect(types).toContain("node.decided:");
});
