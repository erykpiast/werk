// Held-out steps 64.x: the contract check on a move to decided and on an amend.
import { expect, test } from "bun:test";
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../src/test/project.ts";

const logOf = (p: Project) => join(p.dir, ".werk", "log.jsonl");
const lines = (p: Project) =>
  readFileSync(logOf(p), "utf8")
    .split("\n")
    .filter((l) => l !== "");

function seed(p: Project, list: object[]) {
  const start = lines(p).length;
  appendFileSync(
    logOf(p),
    list.map((e, i) => `${JSON.stringify({ seq: start + i + 1, at: "t", actor: "you", ...e })}\n`).join(""),
  );
}

/** A map with no root card: one decided top card #base, so a card's only basis is a depends_on link. */
function withBase(): Project {
  const p = freshProject();
  seed(p, [
    {
      type: "node.added",
      payload: { id: "base", kind: "card", title: "Base", status: "decided", who: "me", no_basis: "top" },
    },
    { type: "kill.added", payload: { id: "base", criterion: { form: "revisit" } } },
  ]);
  return p;
}

async function ok(p: Project, args: string[]) {
  const run = await p.werk(args);
  if (run.code !== 0) throw new Error(`werk ${args.join(" ")} exited ${run.code}: ${run.err}`);
  return run;
}
const head = async (p: Project, id: string) => (await p.werk(["show", id])).out.split("\n")[0] as string;

/** Splits a printed command line into its arguments, keeping a double-quoted text as one. */
function argv(line: string): string[] {
  return [...line.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => (m[1] ?? m[2]) as string);
}
/** Every printed fix line, without its "or:" or "then:" lead. */
function fixes(err: string): string[] {
  return err
    .split("\n")
    .filter((l) => /^\s+(or: |then: )?werk /.test(l))
    .map((l) => l.trim().replace(/^(or|then): /, ""));
}
/** Fills the placeholders of a printed fix with concrete words. */
const fill = (line: string) =>
  line
    .replace("you|me|prototype", "you")
    .replace(/<what (\S+) takes from <card>>/, "reads the base")
    .replace("<card>", "base")
    .replace("<the option>", "Another way")
    .replace("<why it lost>", "costs more");

test("64.1 a card that lacks a kill criterion stays open, and the printed command fixes it", async () => {
  const p = withBase();
  seed(p, [
    { type: "node.added", payload: { id: "c", kind: "card", title: "C", who: "you" } },
    { type: "edge.added", payload: { from: "c", to: "base", type: "depends_on", why: "reads the base" } },
    { type: "node.added", payload: { id: "c:opt0", kind: "option", title: "Other", why_not: "slower" } },
    { type: "edge.added", payload: { from: "c:opt0", to: "c", type: "alternative_to" } },
  ]);
  const before = lines(p);
  const run = await p.werk(["status", "c", "decided"]);
  expect(run.code).not.toBe(0);
  const out = run.out + run.err;
  expect(out).toContain("kill criterion");
  expect(out).not.toContain("who:");
  expect(out).not.toContain("basis:");
  expect(out).not.toContain("option:");
  const fix = fixes(out).find((l) => l.startsWith("werk kill c") && !l.includes("<"));
  expect(fix).toBeDefined();
  expect(await head(p, "c")).toContain("[open]");
  expect(lines(p)).toEqual(before);
  await ok(p, argv(fix as string).slice(1));
  await ok(p, ["status", "c", "decided"]);
  expect(await head(p, "c")).toContain("[decided]");
});

test("64.2 a card that lacks several facts reports each with its own command", async () => {
  const p = withBase();
  seed(p, [{ type: "node.added", payload: { id: "c", kind: "card", title: "C", body: "Some body." } }]);
  const run = await p.werk(["status", "c", "decided"]);
  expect(run.code).not.toBe(0);
  const out = run.out + run.err;
  for (const fact of ["who:", "basis:", "option:", "kill criterion:"]) expect(out).toContain(fact);
  expect(await head(p, "c")).toContain("[open]");
  const printed = fixes(out);
  // One command per fact: the first printed form of each, with the option's "then" link after its add.
  const steps = [
    printed.find((l) => l.startsWith("werk edit c --who")),
    printed.find((l) => l.startsWith("werk link c base") || l.startsWith("werk link c <card>")),
    printed.find((l) => l.startsWith("werk add c:opt0")),
    printed.find((l) => l.startsWith("werk link c:opt0 c")),
    printed.find((l) => l.startsWith("werk kill c --revisit")),
  ];
  for (const s of steps) expect(s).toBeDefined();
  for (const s of steps) await ok(p, argv(fill(s as string)).slice(1));
  await ok(p, ["status", "c", "decided"]);
  expect(await head(p, "c")).toContain("[decided]");
});

test("64.3 a ghost card obeys the same check through its held edges", async () => {
  const p = withBase();
  await ok(p, ["add", "g1", "--title", "G1", "--who", "you"]);
  await ok(p, ["link", "g1", "base", "--type", "depends_on", "--why", "reads the base"]);
  await ok(p, ["add", "g1:opt0", "--kind", "option", "--title", "Other", "--why_not", "slower"]);
  await ok(p, ["link", "g1:opt0", "g1", "--type", "alternative_to"]);
  await ok(p, ["kill", "g1", "--revisit"]);
  await ok(p, ["add", "g2", "--title", "G2", "--who", "you"]);
  await ok(p, ["add", "g2:opt0", "--kind", "option", "--title", "Other", "--why_not", "slower"]);
  await ok(p, ["link", "g2:opt0", "g2", "--type", "alternative_to"]);
  await ok(p, ["kill", "g2", "--revisit"]);
  expect((await p.werk(["status", "g1", "decided"])).code).toBe(0);
  expect(await head(p, "g1")).toContain("[decided]");
  const run = await p.werk(["status", "g2", "decided"]);
  expect(run.code).not.toBe(0);
  const out = run.out + run.err;
  expect(out).toContain("basis:");
  expect(fixes(out).some((l) => l.startsWith("werk link g2 "))).toBe(true);
  expect(await head(p, "g2")).not.toContain("[decided]");
});

/** A real decided card #c with who, a depends_on link to #base, an option and a kill criterion. */
function decided(): Project {
  const p = withBase();
  seed(p, [
    {
      type: "node.added",
      payload: {
        id: "c",
        kind: "card",
        title: "C",
        body: "A long body of several words.",
        status: "decided",
        who: "you",
      },
    },
    { type: "edge.added", payload: { from: "c", to: "base", type: "depends_on", why: "reads the base" } },
    { type: "node.added", payload: { id: "c:opt0", kind: "option", title: "Other", why_not: "slower" } },
    { type: "edge.added", payload: { from: "c:opt0", to: "c", type: "alternative_to" } },
    { type: "kill.added", payload: { id: "c", criterion: { form: "revisit" } } },
  ]);
  return p;
}

test("64.4 an amend that removes a required fact is refused and the card stays the same", async () => {
  const p = decided();
  const before = (await ok(p, ["show", "c"])).out;
  expect(before).toContain("[decided]");
  const run = await p.werk(["unlink", "c", "base", "--type", "depends_on"]);
  expect(run.code).not.toBe(0);
  const out = run.out + run.err;
  expect(out).toContain("basis:");
  expect(fixes(out).some((l) => l.startsWith("werk link c "))).toBe(true);
  expect((await ok(p, ["show", "c"])).out).toBe(before);
});

test("64.5 an amend that keeps every fact succeeds, and card text is not checked", async () => {
  const p = decided();
  const n = lines(p).length;
  await ok(p, [
    "propose",
    "c",
    "--ops",
    JSON.stringify([{ tag: "elaborated", old: "A long body of several words.", new: "Short." }]),
  ]);
  await ok(p, ["accept", "c", "--actor", "you"]);
  const show = (await ok(p, ["show", "c"])).out;
  expect(show.split("\n")[0]).toContain("[decided]");
  expect(show).toContain("Short.");
  const types = lines(p)
    .slice(n)
    .map((l) => JSON.parse(l).type);
  expect(types).toContain("node.reopened");
  expect(types).toContain("node.decided");
});
