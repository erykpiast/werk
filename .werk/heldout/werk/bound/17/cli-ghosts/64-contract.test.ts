// Held-out 64.x: the contract check on decide and on amend. Each card sits at the top of the map, so
// its depends_on link is its only basis.
import { expect, test } from "bun:test";
import { head, project } from "./helpers.ts";

const base = () => project([{ id: "base", title: "Base", status: "decided", who: "you", unchallenged: "seed" }]);

type P = ReturnType<typeof base>;

/** Splits one printed command line into its arguments, without the leading `werk`. */
function argv(line: string): string[] {
  const out: string[] = [];
  for (const m of line.trim().matchAll(/"([^"]*)"|(\S+)/g)) out.push(m[1] ?? m[2] ?? "");
  expect(out[0]).toBe("werk");
  return out.slice(1);
}

function fullCard(p: P, id: string, ghost: boolean) {
  p.ok("add", id, "--title", `Card ${id}`, "--body", "A long body with several words in it.");
  if (!ghost) p.ok("accept", id, "--actor", "you");
  p.ok("edit", id, "--who", "you");
  p.ok("link", id, "base", "--type", "depends_on", "--why", "takes the base");
  p.ok("add", `${id}:opt0`, "--kind", "option", "--title", "Another way", "--why_not", "costs more");
  p.ok("link", `${id}:opt0`, id, "--type", "alternative_to");
  if (!ghost) p.ok("accept", `${id}:opt0`, "--actor", "you");
}

test("64.1 a card that lacks a kill criterion stays open, and the printed command fixes it", () => {
  const p = base();
  fullCard(p, "c", false);
  const before = p.events().length;
  const run = p.werk("status", "c", "decided");
  expect(run.code).not.toBe(0);
  const text = run.out + run.err;
  expect(text).toContain("kill criterion");
  expect(text).not.toMatch(/^\s+(who|basis|option):/m);
  const printed = text.split("\n").find((l) => l.trim() === "werk kill c --revisit" || l.trim() === "or: werk kill c --revisit");
  expect(printed).toBeDefined();
  expect(head(p.show("c"))).toContain("[open]");
  expect(p.events().slice(before).filter((e) => e.type === "node.decided")).toEqual([]);
  p.ok(...argv((printed as string).replace(/^\s*or:\s*/, "")));
  expect(p.werk("status", "c", "decided").code).toBe(0);
  expect(head(p.show("c"))).toContain("[decided]");
});

test("64.2 a card that lacks several facts reports each missing fact with its own command", () => {
  const p = base();
  p.ok("add", "c", "--title", "Bare card", "--body", "Only words.");
  p.ok("accept", "c", "--actor", "you");
  const run = p.werk("status", "c", "decided");
  expect(run.code).not.toBe(0);
  const text = run.out + run.err;
  const lines = text.split("\n").map((l) => l.trim().replace(/^(or|then):\s*/, ""));
  expect(text).toMatch(/who:/);
  expect(text).toMatch(/basis:/);
  expect(text).toMatch(/option:/);
  expect(text).toMatch(/kill criterion:/);
  const who = lines.find((l) => l.startsWith("werk edit c --who"));
  const basis = lines.find((l) => l.startsWith("werk link c ") && l.includes("--type depends_on"));
  const optAdd = lines.find((l) => l.startsWith("werk add c:opt0 --kind option"));
  const optLink = lines.find((l) => l.startsWith("werk link c:opt0 c --type alternative_to"));
  const kill = lines.find((l) => l === "werk kill c --revisit");
  for (const each of [who, basis, optAdd, optLink, kill]) expect(each).toBeDefined();
  expect(head(p.show("c"))).toContain("[open]");
  // Each printed command with its placeholders filled in.
  p.ok(...argv((who as string).replace("you|me|prototype", "you")));
  p.ok(...argv((basis as string).replace("<card>", "base").replace(/"<[^"]*>"/, '"takes the base"')));
  p.ok(...argv((optAdd as string).replace('"<the option>"', '"Another way"').replace('"<why it lost>"', '"costs more"')));
  p.ok(...argv(optLink as string));
  p.ok(...argv(kill as string));
  // The option is a ghost until the person accepts it; its held link still counts.
  const again = p.werk("status", "c", "decided");
  expect(again.err).toBe("");
  expect(head(p.show("c"))).toContain("[decided]");
});

test("64.3 a ghost card obeys the same check through its held edges", () => {
  const p = base();
  fullCard(p, "g1", true);
  p.ok("kill", "g1", "--revisit");
  p.ok("add", "g2", "--title", "Second ghost");
  p.ok("edit", "g2", "--who", "you");
  p.ok("add", "g2:opt0", "--kind", "option", "--title", "Another way", "--why_not", "costs more");
  p.ok("link", "g2:opt0", "g2", "--type", "alternative_to");
  p.ok("kill", "g2", "--revisit");
  expect(p.werk("status", "g1", "decided").code).toBe(0);
  expect(head(p.show("g1"))).toContain("[decided]");
  const run = p.werk("status", "g2", "decided");
  expect(run.code).not.toBe(0);
  const text = run.out + run.err;
  expect(text).toMatch(/basis:/);
  expect(text).toMatch(/werk link g2 \S+ --type depends_on/);
  expect(head(p.show("g2"))).not.toContain("[decided]");
});

function decidedCard(p: P) {
  fullCard(p, "c", false);
  p.ok("kill", "c", "--revisit");
  p.ok("status", "c", "decided");
  expect(head(p.show("c"))).toContain("[decided]");
}

test("64.4 an amend that removes a required fact is refused and the decided card stays the same", () => {
  const p = base();
  decidedCard(p);
  const before = p.show("c");
  const run = p.werk("unlink", "c", "base", "--type", "depends_on");
  expect(run.code).not.toBe(0);
  const text = run.out + run.err;
  expect(text).toMatch(/basis:/);
  expect(text).toMatch(/werk link c \S+ --type depends_on/);
  const after = p.show("c");
  expect(head(after)).toContain("[decided]");
  expect(after).toBe(before);
});

test("64.5 an amend that keeps every fact succeeds, and card text is not checked", () => {
  const p = base();
  decidedCard(p);
  const before = p.events().length;
  const ops = JSON.stringify([{ tag: "elaborated", old: "A long body with several words in it.", new: "Short." }]);
  expect(p.werk("propose", "c", "--ops", ops).code).toBe(0);
  const accept = p.werk("accept", "c", "--actor", "you");
  expect(accept.code).toBe(0);
  const shown = p.show("c");
  expect(head(shown)).toContain("[decided]");
  expect(shown).toContain("Short.");
  expect(shown).not.toContain("A long body");
  const types = p.events().slice(before).map((e) => e.type);
  expect(types.some((t) => /reopen/.test(t))).toBe(true);
  expect(types.some((t) => /decide/.test(t))).toBe(true);
});
