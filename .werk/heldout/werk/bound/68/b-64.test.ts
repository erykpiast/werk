// Held-out steps 64.1 to 64.5: the contract check on decide and on amend.
import { expect, test } from "bun:test";
import { decided, events, header, lines, ok, project, real, seed } from "./b-helpers.ts";

/** Splits a printed command line into its arguments, honouring double quotes. */
function argv(command: string): string[] {
  return [...command.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2] ?? "");
}

/** The printed werk commands of a refusal, without the leading `or:` or `then:`. */
function printed(err: string): string[] {
  return err
    .split("\n")
    .map((l) => l.trim().replace(/^(or|then): /, ""))
    .filter((l) => l.startsWith("werk "));
}

test("64.1 a card that lacks a kill criterion stays open, and the printed command fixes it", async () => {
  const p = project();
  decided(p, "base", "Base");
  seed(
    p,
    real("x", "X", { who: "you" }),
    { type: "edge.added", payload: { from: "x", to: "base", type: "depends_on", why: "x reads base" } },
    real("x:opt0", "Other", { kind: "option", why_not: "slower" }),
    { type: "edge.added", payload: { from: "x:opt0", to: "x", type: "alternative_to" } },
  );
  const before = lines(p);
  const run = await p.werk(["status", "x", "decided"]);
  expect(run.code).not.toBe(0);
  expect(run.err).toContain("kill criterion");
  expect(run.err).not.toContain("  who:");
  expect(run.err).not.toContain("  basis:");
  expect(run.err).not.toContain("  option:");
  const fix = printed(run.err).find((c) => c.startsWith("werk kill x") && !c.includes("<"));
  expect(fix).toBeDefined();
  expect(await header(p, "x")).toContain("[open]");
  expect(lines(p)).toEqual(before);
  await ok(p, argv(fix as string).slice(1));
  await ok(p, ["status", "x", "decided"]);
  expect(await header(p, "x")).toContain("[decided]");
}, 30_000);

test("64.2 a card that lacks several facts reports each missing fact with its own command", async () => {
  const p = project();
  decided(p, "base", "Base");
  seed(p, real("x", "X", { body: "Some body." }));
  const run = await p.werk(["status", "x", "decided"]);
  expect(run.code).not.toBe(0);
  for (const fact of ["who:", "basis:", "option:", "kill criterion:"]) expect(run.err).toContain(fact);
  const commands = printed(run.err);
  expect(commands.some((c) => c.startsWith("werk edit x --who"))).toBe(true);
  expect(commands.some((c) => c.startsWith("werk link x") && c.includes("depends_on"))).toBe(true);
  expect(commands.some((c) => c.startsWith("werk add x:opt0"))).toBe(true);
  expect(commands.some((c) => c.startsWith("werk kill x"))).toBe(true);
  expect(await header(p, "x")).toContain("[open]");
  // Each printed command, with its placeholders filled in.
  await ok(p, ["edit", "x", "--who", "you"]);
  await ok(p, ["link", "x", "base", "--type", "depends_on", "--why", "x reads base"]);
  await ok(p, ["add", "x:opt0", "--kind", "option", "--title", "Other", "--why_not", "slower"]);
  await ok(p, ["link", "x:opt0", "x", "--type", "alternative_to"]);
  await ok(p, ["kill", "x", "--revisit"]);
  await ok(p, ["status", "x", "decided"]);
  expect(await header(p, "x")).toContain("[decided]");
}, 30_000);

test("64.3 a ghost card obeys the same check through its held edges", async () => {
  const p = project();
  decided(p, "base", "Base");
  await ok(p, ["add", "g1", "--title", "G1", "--who", "you"]);
  await ok(p, ["link", "g1", "base", "--type", "depends_on", "--why", "g1 reads base"]);
  await ok(p, ["add", "g1:opt0", "--kind", "option", "--title", "Other", "--why_not", "slower"]);
  await ok(p, ["link", "g1:opt0", "g1", "--type", "alternative_to"]);
  await ok(p, ["kill", "g1", "--revisit"]);
  await ok(p, ["add", "g2", "--title", "G2", "--who", "you"]);
  await ok(p, ["add", "g2:opt0", "--kind", "option", "--title", "Other", "--why_not", "slower"]);
  await ok(p, ["link", "g2:opt0", "g2", "--type", "alternative_to"]);
  await ok(p, ["kill", "g2", "--revisit"]);

  const first = await p.werk(["status", "g1", "decided"]);
  expect(first.code).toBe(0);
  expect(await header(p, "g1")).toContain("[decided]");
  const before = lines(p);
  const second = await p.werk(["status", "g2", "decided"]);
  expect(second.code).not.toBe(0);
  expect(second.err).toContain("basis:");
  expect(printed(second.err).some((c) => c.startsWith("werk link g2") && c.includes("depends_on"))).toBe(true);
  expect(await header(p, "g2")).not.toContain("[decided]");
  expect(lines(p)).toEqual(before);
}, 30_000);

/** A decided card with who you, a depends_on basis, a rejected option and a kill criterion. */
function fullCard() {
  const p = project();
  decided(p, "base", "Base");
  seed(
    p,
    real("x", "X", { status: "decided", who: "you", body: "A long body that says a great many things." }),
    { type: "edge.added", payload: { from: "x", to: "base", type: "depends_on", why: "x reads base" } },
    real("x:opt0", "Other", { kind: "option", why_not: "slower" }),
    { type: "edge.added", payload: { from: "x:opt0", to: "x", type: "alternative_to" } },
    { type: "kill.added", payload: { id: "x", criterion: { form: "revisit" } } },
  );
  return p;
}

test("64.4 an amend that removes a required fact is refused and the decided card stays the same", async () => {
  const p = fullCard();
  const before = (await ok(p, ["show", "x"])).out;
  expect(before.split("\n")[0]).toContain("[decided]");
  const run = await p.werk(["unlink", "x", "base", "--type", "depends_on"]);
  expect(run.code).not.toBe(0);
  expect(run.err).toContain("basis");
  expect(printed(run.err).some((c) => c.startsWith("werk link x") && c.includes("depends_on"))).toBe(true);
  const after = (await ok(p, ["show", "x"])).out;
  expect(after.split("\n")[0]).toContain("[decided]");
  expect(after).toBe(before);
}, 30_000);

test("64.5 an amend that keeps every fact succeeds, and card text is not checked", async () => {
  const p = fullCard();
  await ok(p, [
    "propose",
    "x",
    "--ops",
    JSON.stringify([{ tag: "elaborated", old: "A long body that says a great many things.", new: "Short." }]),
  ]);
  const before = lines(p).length;
  const run = await p.werk(["accept", "x", "--actor", "you"]);
  expect(run.code).toBe(0);
  const shown = (await ok(p, ["show", "x"])).out;
  expect(shown.split("\n")[0]).toContain("[decided]");
  expect(shown).toContain("\nShort.\n");
  const types = events(p)
    .slice(before)
    .map((e) => e.type);
  expect(types).toContain("node.reopened");
  expect(types).toContain("node.decided");
}, 30_000);
