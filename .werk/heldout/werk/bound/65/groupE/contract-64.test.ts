// Held-out steps 64.1–64.5: the decide contract check and its printed fixes.
import { expect, test } from "bun:test";
import type { Project } from "../../src/test/project.ts";
import { card, kill, lines, ok, seeded } from "./helpers.ts";

/** Each printed fix line that starts with werk, as an argument list for the command line. */
function printedCommands(err: string): string[][] {
  return err
    .split("\n")
    .map((l) => l.trim().replace(/^(or|then): /, ""))
    .filter((l) => l.startsWith("werk "))
    .map((l) => {
      const args: string[] = [];
      for (const m of l.slice(5).matchAll(/"([^"]*)"|(\S+)/g)) args.push(m[1] ?? (m[2] as string));
      return args;
    });
}

const statusOf = async (p: Project, id: string) => /\[(\w+)\]/.exec((await ok(p, ["show", id])).out)?.[1];

test("64.1 a card that lacks a kill criterion stays open, and the printed command fixes it", async () => {
  const p = seeded([
    card("base", "decided", undefined, { no_basis: "top" }),
    kill("base"),
    { type: "node.added", payload: { id: "x", kind: "card", title: "X", status: "open", who: "you" } },
    { type: "edge.added", payload: { from: "x", to: "base", type: "depends_on", why: "x reads base" } },
    { type: "node.added", payload: { id: "x:opt0", kind: "option", title: "Other", why_not: "slow", status: "open" } },
    { type: "edge.added", payload: { from: "x:opt0", to: "x", type: "alternative_to" } },
  ]);
  const before = lines(p);
  const run = await p.werk(["status", "x", "decided"]);
  expect(run.code).not.toBe(0);
  const text = run.err + run.out;
  expect(text).toContain("kill criterion");
  expect(text).not.toContain("  who:");
  expect(text).not.toContain("  basis:");
  expect(text).not.toContain("  option:");
  const cmds = printedCommands(text).filter((c) => c[0] === "kill" && c[1] === "x");
  expect(cmds.length).toBeGreaterThan(0);
  expect(await statusOf(p, "x")).toBe("open");
  expect(lines(p)).toEqual(before);
  const exact = cmds.find((c) => !c.some((a) => a.includes("<"))) as string[];
  expect(exact).toBeDefined();
  await ok(p, exact);
  await ok(p, ["status", "x", "decided"]);
  expect(await statusOf(p, "x")).toBe("decided");
});

test("64.2 a card that lacks several facts reports each missing fact with its own command", async () => {
  const p = seeded([
    card("base", "decided", undefined, { no_basis: "top" }),
    kill("base"),
    { type: "node.added", payload: { id: "x", kind: "card", title: "X", body: "Some body text.", status: "open" } },
  ]);
  const run = await p.werk(["status", "x", "decided"]);
  expect(run.code).not.toBe(0);
  const text = run.err + run.out;
  for (const fact of ["  who:", "  basis:", "  option:", "  kill criterion:"]) expect(text).toContain(fact);
  const cmds = printedCommands(text);
  expect(cmds.some((c) => c[0] === "edit" && c.includes("--who"))).toBe(true);
  expect(cmds.some((c) => c[0] === "link" && c.includes("depends_on"))).toBe(true);
  expect(cmds.some((c) => c[0] === "add" && c.includes("option"))).toBe(true);
  expect(cmds.some((c) => c[0] === "kill")).toBe(true);
  expect(await statusOf(p, "x")).toBe("open");
  // Each printed command in turn, with its placeholders filled as the agent would.
  await ok(p, ["edit", "x", "--who", "you"]);
  await ok(p, ["link", "x", "base", "--type", "depends_on", "--why", "x reads base"]);
  await ok(p, ["add", "x:opt0", "--kind", "option", "--title", "Other", "--why_not", "slow"]);
  await ok(p, ["link", "x:opt0", "x", "--type", "alternative_to"]);
  await ok(p, ["kill", "x", "--revisit"]);
  await ok(p, ["status", "x", "decided"]);
  expect(await statusOf(p, "x")).toBe("decided");
});

test("64.3 a ghost card obeys the same check through its held edges", async () => {
  const p = seeded([card("base", "decided", undefined, { no_basis: "top" }), kill("base")]);
  await ok(p, ["add", "g1", "--title", "G1", "--who", "you"]);
  await ok(p, ["link", "g1", "base", "--type", "depends_on", "--why", "g1 reads base"]);
  await ok(p, ["add", "g1:opt0", "--kind", "option", "--title", "Other", "--why_not", "slow"]);
  await ok(p, ["link", "g1:opt0", "g1", "--type", "alternative_to"]);
  await ok(p, ["kill", "g1", "--revisit"]);
  await ok(p, ["add", "g2", "--title", "G2", "--who", "you"]);
  await ok(p, ["add", "g2:opt0", "--kind", "option", "--title", "Other", "--why_not", "slow"]);
  await ok(p, ["link", "g2:opt0", "g2", "--type", "alternative_to"]);
  await ok(p, ["kill", "g2", "--revisit"]);

  await ok(p, ["status", "g1", "decided"]);
  const g1 = (await ok(p, ["show", "g1"])).out;
  expect(g1).toContain("[decided]");
  expect(g1).toContain("proposed");

  const run = await p.werk(["status", "g2", "decided"]);
  expect(run.code).not.toBe(0);
  const text = run.err + run.out;
  expect(text).toContain("  basis:");
  expect(printedCommands(text).some((c) => c[0] === "link" && c.includes("depends_on"))).toBe(true);
  expect(await statusOf(p, "g2")).not.toBe("decided");
});

function decidedWithFacts(): Project {
  return seeded([
    card("base", "decided", undefined, { no_basis: "top" }),
    kill("base"),
    {
      type: "node.added",
      payload: {
        id: "x",
        kind: "card",
        title: "X",
        body: "A long body that says many things.",
        status: "open",
        who: "you",
      },
    },
    { type: "edge.added", payload: { from: "x", to: "base", type: "depends_on", why: "x reads base" } },
    { type: "node.added", payload: { id: "x:opt0", kind: "option", title: "Other", why_not: "slow", status: "open" } },
    { type: "edge.added", payload: { from: "x:opt0", to: "x", type: "alternative_to" } },
    kill("x"),
    { type: "node.decided", payload: { id: "x" } },
  ]);
}

test("64.4 an amend that removes a required fact is refused and the decided card stays the same", async () => {
  const p = decidedWithFacts();
  const shown = (await ok(p, ["show", "x"])).out;
  expect(shown).toContain("[decided]");
  const run = await p.werk(["unlink", "x", "base", "--type", "depends_on"]);
  expect(run.code).not.toBe(0);
  const text = run.err + run.out;
  expect(text).toContain("basis");
  expect(printedCommands(text).some((c) => c[0] === "link" && c.includes("depends_on"))).toBe(true);
  expect((await ok(p, ["show", "x"])).out).toBe(shown);
});

test("64.5 an amend that keeps every fact succeeds, and card text is not checked", async () => {
  const p = decidedWithFacts();
  const before = lines(p).length;
  const ops = JSON.stringify([{ tag: "elaborated", old: "A long body that says many things.", new: "Short." }]);
  await ok(p, ["propose", "x", "--ops", ops]);
  await ok(p, ["accept", "x", "--actor", "you"]);
  const out = (await ok(p, ["show", "x"])).out;
  expect(out).toContain("[decided]");
  expect(out).toContain("Short.");
  const added = lines(p)
    .slice(before)
    .map((l) => JSON.parse(l) as { type: string; payload: { id?: string } });
  const types = added.filter((e) => e.payload.id === "x").map((e) => e.type);
  expect(types).toContain("node.reopened");
  expect(types).toContain("node.decided");
});
