// Held-out steps 64.1-64.5: the contract check on a decide and on an amend.
import { expect, test } from "bun:test";
import { make, type P } from "./lib.ts";

/** Splits a printed command line into words, with double-quoted words kept whole. */
function words(line: string): string[] {
  return [...line.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => (m[1] ?? m[2]) as string);
}

/** Fills the placeholders of a printed command the way an agent would. */
function fill(line: string): string {
  return line
    .replace("you|me|prototype", "me")
    .replaceAll("<card>", "base")
    .replace(/<[^"]*>/g, "filled in by the agent");
}

/** The printed commands: each fact's first command and its `then:` lines, without the `or:` lines. */
function printed(err: string): string[] {
  return err
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => (l.startsWith("werk ") || l.startsWith("then: werk ")) && !/^werk [a-z-]+:/.test(l))
    .map((l) => l.replace(/^then: /, ""));
}

async function runPrinted(p: P, line: string) {
  const args = words(fill(line));
  expect(args[0]).toBe("werk");
  return p.w(...args.slice(1));
}

const statusOf = async (p: P, id: string) => /\[(\w+)\]/.exec((await p.w("show", id)).out.split("\n")[0] ?? "")?.[1];

function baseMap(p: P): void {
  p.card("root", { title: "Root", status: "decided", who: "me" });
  p.card("base", { title: "Base", parent: "root", status: "decided", who: "me" });
}

function option(p: P, card: string): void {
  p.seed("node.added", { id: `${card}:opt0`, kind: "option", title: "Another way", why_not: "It costs more" });
  p.seed("edge.added", { from: `${card}:opt0`, to: card, type: "alternative_to" });
}

test("64.1 a card that lacks a kill criterion stays open, and the printed command fixes it", async () => {
  const p = make();
  baseMap(p);
  p.card("c", { title: "C", body: "text", parent: "root", who: "me" });
  p.seed("edge.added", { from: "c", to: "base", type: "depends_on", why: "It reads the base" });
  option(p, "c");
  const n = p.lines().length;
  const r = await p.w("status", "c", "decided");
  expect(r.code).not.toBe(0);
  const out = r.out + r.err;
  expect(out).toMatch(/kill criterion/);
  expect(out).not.toMatch(/^\s*who:/m);
  const cmd = out
    .split("\n")
    .map((l) => l.trim().replace(/^or: /, ""))
    .find((l) => /^werk kill c --revisit$/.test(l));
  expect(cmd).toBeDefined();
  expect(await statusOf(p, "c")).toBe("open");
  expect(p.lines().length).toBe(n);
  expect((await runPrinted(p, cmd as string)).code).toBe(0);
  const again = await p.w("status", "c", "decided");
  expect(again.code).toBe(0);
  expect(await statusOf(p, "c")).toBe("decided");
});

test("64.2 a card that lacks several facts reports each missing fact with its own command", async () => {
  const p = make();
  baseMap(p);
  p.card("c", { title: "C", body: "Only a body." });
  const r = await p.w("status", "c", "decided");
  expect(r.code).not.toBe(0);
  const out = r.out + r.err;
  expect(out).toMatch(/who/);
  expect(out).toMatch(/basis/);
  expect(out).toMatch(/option/);
  expect(out).toMatch(/kill criterion/);
  expect(out).toMatch(/werk edit c --who/);
  expect(out).toMatch(/werk link c \S+ --type depends_on/);
  expect(out).toMatch(/werk add c:opt0 --kind option/);
  expect(out).toMatch(/werk kill c/);
  expect(await statusOf(p, "c")).toBe("open");
  const results = [];
  for (const line of printed(out)) results.push({ line, run: await runPrinted(p, line) });
  for (const { line, run } of results) expect({ line, code: run.code, err: run.err }).toMatchObject({ code: 0 });
  const again = await p.w("status", "c", "decided");
  expect({ code: again.code, err: again.err }).toMatchObject({ code: 0 });
  expect(await statusOf(p, "c")).toBe("decided");
});

test("64.3 a ghost card obeys the same check through its held edges", async () => {
  const p = make();
  baseMap(p);
  // First ghost: who, depends_on, a rejected option and a kill criterion, all on its held edges.
  expect((await p.w("add", "g1", "--title", "Ghost one", "--parent", "root", "--who", "me")).code).toBe(0);
  expect((await p.w("link", "g1", "base", "--type", "depends_on", "--why", "It reads the base")).code).toBe(0);
  expect((await p.w("add", "g1:opt0", "--kind", "option", "--title", "Other", "--why_not", "Slower")).code).toBe(0);
  expect((await p.w("link", "g1:opt0", "g1", "--type", "alternative_to")).code).toBe(0);
  expect((await p.w("kill", "g1", "--revisit")).code).toBe(0);
  // Second ghost: the same facts but no depends_on basis and no parent.
  // A proposed ghost with no parent, as the log can hold it; its who comes through an edit.
  p.seed("node.proposed", { id: "g2", kind: "card", title: "Ghost two" });
  expect((await p.w("edit", "g2", "--who", "me")).code).toBe(0);
  expect((await p.w("add", "g2:opt0", "--kind", "option", "--title", "Other", "--why_not", "Slower")).code).toBe(0);
  expect((await p.w("link", "g2:opt0", "g2", "--type", "alternative_to")).code).toBe(0);
  expect((await p.w("kill", "g2", "--revisit")).code).toBe(0);

  const one = await p.w("status", "g1", "decided");
  expect({ code: one.code, err: one.err }).toMatchObject({ code: 0 });
  expect(await statusOf(p, "g1")).toBe("decided");
  const two = await p.w("status", "g2", "decided");
  expect(two.code).not.toBe(0);
  const out = two.out + two.err;
  expect(out).toMatch(/basis/);
  expect(out).toMatch(/werk link g2 \S+ --type depends_on/);
  expect(await statusOf(p, "g2")).not.toBe("decided");
});

async function decidedCard(p: P): Promise<void> {
  baseMap(p);
  p.card("c", { title: "C", why: "Because", body: "A long body that explains the card in detail.", who: "me" });
  p.seed("edge.added", { from: "c", to: "base", type: "depends_on", why: "It reads the base" });
  option(p, "c");
  expect((await p.w("kill", "c", "--revisit")).code).toBe(0);
  expect((await p.w("status", "c", "decided")).code).toBe(0);
}

test("64.4 an amend that removes a required fact is refused and the decided card stays the same", async () => {
  const p = make();
  await decidedCard(p);
  const before = (await p.w("show", "c")).out;
  const n = p.lines().length;
  const r = await p.w("unlink", "c", "base", "--type", "depends_on");
  expect(r.code).not.toBe(0);
  const out = r.out + r.err;
  expect(out).toMatch(/basis/);
  expect(out).toMatch(/werk link c \S+ --type depends_on/);
  expect(p.lines().length).toBe(n);
  expect(await statusOf(p, "c")).toBe("decided");
  expect((await p.w("show", "c")).out).toBe(before);
});

test("64.5 an amend that keeps every fact succeeds, and card text is not checked", async () => {
  const p = make();
  await decidedCard(p);
  const n = p.lines().length;
  const ops = JSON.stringify([
    { tag: "elaborated", old: "A long body that explains the card in detail.", new: "Short." },
  ]);
  const proposed = await p.w("propose", "c", "--ops", ops);
  expect({ code: proposed.code, err: proposed.err }).toMatchObject({ code: 0 });
  const accepted = await p.w("accept", "c", "--actor", "you");
  expect({ code: accepted.code, err: accepted.err }).toMatchObject({ code: 0 });
  const show = (await p.w("show", "c")).out;
  expect(show).toContain("[decided]");
  expect(show).toContain("Short.");
  const types = p
    .events()
    .slice(n)
    .filter((e) => e.payload.id === "c")
    .map((e) => e.type);
  expect(types).toContain("node.reopened");
  expect(types).toContain("node.decided");
});
