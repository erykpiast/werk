// Binder: steps 64.1 to 64.5. "Shows on the map" is read from the first line of `werk show`.
import { expect, test } from "bun:test";
import { card, dep, head, kill, lines, ok, seeded } from "./f-helpers.ts";

/** Splits a printed command into words, with double-quoted words kept whole. */
function words(line: string): string[] {
  return [...line.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => (m[1] ?? m[2]) as string);
}

/** Runs one printed `werk ...` line, after the person's filling of each <placeholder>. */
async function runPrinted(p: Parameters<typeof ok>[0], line: string, fill: (w: string) => string) {
  const w = words(line.trim().replace(/^(or|then):\s*/, ""));
  expect(w[0]).toBe("werk");
  return ok(p, w.slice(1).map(fill));
}

const base = [card("base", { status: "decided", who: "me", no_basis: "top" }), kill("base")];

test("64.1 a card that lacks a kill criterion stays open, and the printed command fixes it", async () => {
  const p = seeded([
    ...base,
    card("x", { status: "open", who: "you", body: "Body." }),
    dep("x", "base"),
    { type: "node.added", payload: { id: "x:opt0", kind: "option", title: "Other", why_not: "Slower" } },
    { type: "edge.added", payload: { from: "x:opt0", to: "x", type: "alternative_to" } },
  ]);
  const before = lines(p);
  const run = await p.werk(["status", "x", "decided"]);
  expect(run.code).not.toBe(0);
  const out = run.out + run.err;
  expect(out).toContain("kill criterion");
  expect(out).not.toContain("  who:");
  expect(out).not.toContain("  basis:");
  expect(out).not.toContain("  option:");
  const printed = out.split("\n").find((l) => l.includes("werk kill x --revisit"));
  expect(printed).toBeDefined();
  expect(await head(p, "x")).toContain("[open]");
  expect(lines(p)).toEqual(before);
  await runPrinted(p, printed as string, (w) => w);
  await ok(p, ["status", "x", "decided"]);
  expect(await head(p, "x")).toContain("[decided]");
}, 60_000);

test("64.2 a card that lacks several facts reports each missing fact with its own command", async () => {
  const p = seeded([...base, card("x", { status: "open", body: "Only words." })]);
  const run = await p.werk(["status", "x", "decided"]);
  expect(run.code).not.toBe(0);
  const out = run.out + run.err;
  for (const fact of ["  who:", "  basis:", "  option:", "  kill criterion:"]) expect(out).toContain(fact);
  const fixes = out
    .split("\n")
    .filter((l) => /^\s+((then|or): )?werk /.test(l))
    .map((l) => l.trim());
  expect(fixes.some((l) => l.startsWith("werk edit x --who"))).toBe(true);
  expect(fixes.some((l) => l.startsWith("werk link x <card> --type depends_on"))).toBe(true);
  expect(fixes.some((l) => l.startsWith("werk add x:opt0 --kind option"))).toBe(true);
  expect(fixes).toContain("or: werk kill x --revisit");
  expect(await head(p, "x")).toContain("[open]");
  const fill = (w: string) =>
    w === "you|me|prototype"
      ? "you"
      : w === "<card>"
        ? "base"
        : w.startsWith("<")
          ? "x reads the base"
          : w;
  // The first form of each fix, in turn; the kill fix is the revisit form, which needs no value.
  for (const fix of fixes) {
    if (fix.startsWith("or:") && fix !== "or: werk kill x --revisit") continue;
    if (fix.startsWith("werk kill x --metric")) continue;
    await runPrinted(p, fix, fill);
  }
  await ok(p, ["status", "x", "decided"]);
  expect(await head(p, "x")).toContain("[decided]");
}, 60_000);

test("64.3 a ghost card obeys the same check through its held edges", async () => {
  const p = seeded(base);
  await ok(p, ["add", "g1", "--title", "G1", "--who", "you"]);
  await ok(p, ["link", "g1", "base", "--type", "depends_on", "--why", "g1 reads base"]);
  await ok(p, ["add", "g1:opt0", "--kind", "option", "--title", "Other", "--why_not", "Slower"]);
  await ok(p, ["link", "g1:opt0", "g1", "--type", "alternative_to"]);
  await ok(p, ["kill", "g1", "--revisit"]);
  await ok(p, ["add", "g2", "--title", "G2", "--who", "me"]);
  await ok(p, ["kill", "g2", "--revisit"]);
  expect((await p.werk(["status", "g1", "decided"])).code).toBe(0);
  expect(await head(p, "g1")).toContain("[decided]");
  const run = await p.werk(["status", "g2", "decided"]);
  expect(run.code).not.toBe(0);
  const out = run.out + run.err;
  expect(out).toContain("  basis:");
  expect(out).toContain("werk link g2 <card> --type depends_on");
  expect(await head(p, "g2")).not.toContain("[decided]");
}, 60_000);

const decidedX = [
  ...base,
  card("x", { status: "decided", who: "you", body: "First block.\n\nSecond block." }),
  dep("x", "base"),
  { type: "node.added", payload: { id: "x:opt0", kind: "option", title: "Other", why_not: "Slower" } },
  { type: "edge.added", payload: { from: "x:opt0", to: "x", type: "alternative_to" } },
  kill("x"),
];

test("64.4 an amend that removes a required fact is refused and the decided card stays the same", async () => {
  const p = seeded(decidedX);
  const shown = (await ok(p, ["show", "x"])).out;
  const before = lines(p);
  // The amend that takes away the depends_on edge is an unlink of that edge.
  const run = await p.werk(["unlink", "x", "base", "--type", "depends_on"]);
  expect(run.code).not.toBe(0);
  const out = run.out + run.err;
  expect(out).toContain("basis");
  expect(out).toContain("werk link x <card> --type depends_on");
  expect(lines(p)).toEqual(before);
  expect(await head(p, "x")).toContain("[decided]");
  expect((await ok(p, ["show", "x"])).out).toBe(shown);
}, 60_000);

test("64.5 an amend that keeps every fact succeeds, and card text is not checked", async () => {
  const p = seeded(decidedX);
  await ok(p, [
    "propose",
    "x",
    "--ops",
    JSON.stringify([
      { tag: "elaborated", old: "First block.", new: "Short." },
      { tag: "removed", old: "Second block." },
    ]),
  ]);
  const at = lines(p).length;
  const run = await p.werk(["accept", "x", "--actor", "you"]);
  expect(run.code).toBe(0);
  const show = (await ok(p, ["show", "x"])).out;
  expect(show.split("\n")[0]).toContain("[decided]");
  expect(show).toContain("Short.");
  expect(show).not.toContain("Second block.");
  const types = lines(p)
    .slice(at)
    .map((l) => JSON.parse(l).type);
  expect(types).toContain("node.reopened");
  expect(types).toContain("node.decided");
}, 60_000);
