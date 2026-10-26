import { expect, test } from "bun:test";
import { card, events, ok, project, seed } from "./helpers.ts";

/** A map with a decided root and a decided card "base" that a card can depend on. */
function base() {
  const p = project();
  seed(p, [card("root", "Root", { status: "decided" }), card("base", "Base", { status: "decided", parent: "root" })]);
  return p;
}

const statusLine = async (p: ReturnType<typeof project>, id: string) =>
  (await ok(p, ["show", id])).out.split("\n")[0] ?? "";

/** Runs a printed command line such as `werk kill k --revisit`. */
async function runPrinted(p: ReturnType<typeof project>, line: string) {
  const args = [...line.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]).slice(1) as string[];
  return ok(p, args);
}

test("64.1 a card that lacks a kill criterion stays open, and the printed command fixes it", async () => {
  const p = base();
  await ok(p, ["add", "k", "--title", "Keep logs", "--body", "We keep logs.", "--who", "you"]);
  await ok(p, ["link", "k", "base", "--type", "depends_on", "--why", "takes the base"]);
  await ok(p, ["add", "k:opt0", "--kind", "option", "--title", "Drop logs", "--why_not", "loses history"]);
  await ok(p, ["link", "k:opt0", "k", "--type", "alternative_to"]);
  await ok(p, ["accept", "k", "--actor", "you"]);
  const before = events(p).length;
  const run = await p.werk(["status", "k", "decided"]);
  expect(run.code).not.toBe(0);
  const text = run.out + run.err;
  expect(text).toContain("kill criterion");
  expect(text).not.toContain("who:");
  const fix = text
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.startsWith("werk kill k"));
  expect(fix).toBeDefined();
  expect(await statusLine(p, "k")).toContain("[open]");
  expect(events(p)).toHaveLength(before);
  await runPrinted(p, fix as string);
  await ok(p, ["status", "k", "decided"]);
  expect(await statusLine(p, "k")).toContain("[decided]");
});

test("64.2 a card that lacks several facts reports each with its own command", async () => {
  const p = base();
  await ok(p, ["add", "k", "--title", "Keep logs", "--body", "We keep logs."]);
  await ok(p, ["accept", "k", "--actor", "you"]);
  const run = await p.werk(["status", "k", "decided"]);
  expect(run.code).not.toBe(0);
  const text = run.out + run.err;
  const printed = text.split("\n").map((l) => l.trim().replace(/^(or|then): /, ""));
  expect(await statusLine(p, "k")).toContain("[open]");
  expect(text).toContain("who:");
  expect(printed.some((l) => l.startsWith("werk edit k --who"))).toBe(true);
  expect(text).toContain("option:");
  expect(printed.some((l) => l.startsWith("werk add k:opt0 --kind option"))).toBe(true);
  expect(text).toContain("kill criterion:");
  expect(printed.some((l) => l.startsWith("werk kill k"))).toBe(true);
  // The missing depends_on basis, with its fix.
  expect(text).toContain("basis:");
  expect(printed.some((l) => l.startsWith("werk link k") && l.includes("depends_on"))).toBe(true);
  // Each printed command, with its placeholders filled in.
  await ok(p, ["edit", "k", "--who", "you"]);
  await ok(p, ["link", "k", "base", "--type", "depends_on", "--why", "takes the base"]);
  await ok(p, ["add", "k:opt0", "--kind", "option", "--title", "Drop logs", "--why_not", "loses history"]);
  await ok(p, ["link", "k:opt0", "k", "--type", "alternative_to"]);
  await ok(p, ["kill", "k", "--revisit"]);
  await ok(p, ["status", "k", "decided"]);
  expect(await statusLine(p, "k")).toContain("[decided]");
});

test("64.3 a ghost card obeys the same check through its held edges", async () => {
  const p = base();
  await ok(p, ["add", "g1", "--title", "Ghost one", "--who", "you"]);
  await ok(p, ["link", "g1", "base", "--type", "depends_on", "--why", "takes the base"]);
  await ok(p, ["add", "g1:opt0", "--kind", "option", "--title", "Alt one", "--why_not", "worse"]);
  await ok(p, ["link", "g1:opt0", "g1", "--type", "alternative_to"]);
  await ok(p, ["kill", "g1", "--revisit"]);
  await ok(p, ["status", "g1", "decided"]);
  expect(await statusLine(p, "g1")).toContain("[decided]");

  await ok(p, ["add", "g2", "--title", "Ghost two", "--who", "you"]);
  await ok(p, ["add", "g2:opt0", "--kind", "option", "--title", "Alt two", "--why_not", "worse"]);
  await ok(p, ["link", "g2:opt0", "g2", "--type", "alternative_to"]);
  await ok(p, ["kill", "g2", "--revisit"]);
  const run = await p.werk(["status", "g2", "decided"]);
  expect(run.code).not.toBe(0);
  const text = run.out + run.err;
  expect(text).toContain("basis");
  expect(text).toContain("depends_on");
  expect(await statusLine(p, "g2")).not.toContain("[decided]");
});

async function decidedCard() {
  const p = base();
  await ok(p, ["add", "d", "--title", "Keep logs", "--body", "We keep every log line for a year.", "--who", "you"]);
  await ok(p, ["link", "d", "base", "--type", "depends_on", "--why", "takes the base"]);
  await ok(p, ["add", "d:opt0", "--kind", "option", "--title", "Drop logs", "--why_not", "loses history"]);
  await ok(p, ["link", "d:opt0", "d", "--type", "alternative_to"]);
  await ok(p, ["kill", "d", "--revisit"]);
  await ok(p, ["status", "d", "decided"]);
  await ok(p, ["accept", "d", "--actor", "you"]);
  return p;
}

test("64.4 an amend that removes the depends_on edge is refused and the card stays the same", async () => {
  const p = await decidedCard();
  const before = (await ok(p, ["show", "d"])).out;
  expect(before).toStartWith("card d  [decided]\n");
  const run = await p.werk(["unlink", "d", "base", "--type", "depends_on"]);
  expect(run.code).not.toBe(0);
  const text = run.out + run.err;
  expect(text).toContain("basis");
  expect((await ok(p, ["show", "d"])).out).toBe(before);
});

test("64.5 an amend that keeps every fact succeeds, and card text is not checked", async () => {
  const p = await decidedCard();
  const ops = [{ tag: "elaborated", old: "We keep every log line for a year.", new: "Logs stay." }];
  await ok(p, ["propose", "d", "--ops", JSON.stringify(ops)]);
  const from = events(p).length;
  await ok(p, ["accept", "d", "--actor", "you"]);
  const out = (await ok(p, ["show", "d"])).out;
  expect(out).toStartWith("card d  [decided]\n");
  expect(out).toContain("\nLogs stay.\n");
  const amend = events(p).slice(from);
  const types = amend.map((e) => e.type);
  // The log shows the amend as a reopen and a decide of the card.
  expect(types).toContain("node.reopened");
  expect(types).toContain("node.decided");
});
