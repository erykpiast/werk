import { expect, test } from "bun:test";
import { argsOf, card, decided, lines, link, ok, withMap } from "./cli-b-helpers.ts";

const statusOf = async (p: Parameters<typeof ok>[0], id: string) =>
  ((await ok(p, ["show", id])).out.split("\n")[0] ?? "").match(/\[(\w+)\]/)?.[1];

test("64.1", async () => {
  const p = withMap([
    card("root", "Root"),
    ...decided("base", "Base", { parent: "root" }),
    card("x", "The card", { parent: "root", who: "you" }),
    link("x", "base", "depends_on", "x reads base"),
    ["node.added", { id: "x:opt0", kind: "option", title: "Other", why_not: "Slower" }],
    link("x:opt0", "x", "alternative_to"),
  ]);
  const before = lines(p);
  const run = await p.werk(["status", "x", "decided"]);
  console.log(run.err);
  expect(run.code).not.toBe(0);
  expect(run.err).toContain("kill criterion");
  expect(run.err).not.toMatch(/^ {2}(who|basis|option):/m);
  expect(await statusOf(p, "x")).toBe("open");
  expect(lines(p)).toEqual(before);
  const printed = run.err.split("\n").map((l) => l.trim().replace(/^or: /, "")).find((l) => l === "werk kill x --revisit");
  expect(printed).toBeDefined();
  await ok(p, argsOf(printed as string));
  expect((await ok(p, ["status", "x", "decided"])).out).toBe("x: decided\n");
  expect(await statusOf(p, "x")).toBe("decided");
});

test("64.2", async () => {
  const p = withMap([...decided("base", "Base"), card("x", "The card", { body: "Some body text." })]);
  const run = await p.werk(["status", "x", "decided"]);
  console.log(run.err);
  expect(run.code).not.toBe(0);
  for (const fact of ["who:", "basis:", "option:", "kill criterion:"]) expect(run.err).toContain(`  ${fact}`);
  expect(run.err).toContain("werk edit x --who");
  expect(run.err).toContain("werk link x <card> --type depends_on");
  expect(run.err).toContain("werk add x:opt0 --kind option");
  expect(run.err).toContain("werk link x:opt0 x --type alternative_to");
  expect(run.err).toContain("werk kill x --revisit");
  expect(await statusOf(p, "x")).toBe("open");
  // Run each printed command, with its placeholders filled in.
  const fixes = [
    "werk edit x --who you",
    'werk link x base --type depends_on --why "x reads base"',
    'werk add x:opt0 --kind option --title "Other" --why_not "Slower"',
    "werk link x:opt0 x --type alternative_to",
    "werk kill x --revisit",
  ];
  for (const fix of fixes) await ok(p, argsOf(fix));
  await ok(p, ["status", "x", "decided"]);
  expect(await statusOf(p, "x")).toBe("decided");
});

test("64.3", async () => {
  const p = withMap([card("root", "Root"), ...decided("base", "Base", { parent: "root" })]);
  await ok(p, ["add", "g1", "--title", "Ghost one", "--who", "you"]);
  await ok(p, ["link", "g1", "base", "--type", "depends_on", "--why", "g1 reads base"]);
  await ok(p, ["add", "g1:opt0", "--kind", "option", "--title", "Other", "--why_not", "Slower"]);
  await ok(p, ["link", "g1:opt0", "g1", "--type", "alternative_to"]);
  await ok(p, ["kill", "g1", "--revisit"]);
  await ok(p, ["add", "g2", "--title", "Ghost two", "--who", "me"]);
  await ok(p, ["kill", "g2", "--revisit"]);
  const first = await p.werk(["status", "g1", "decided"]);
  console.log(first);
  expect(first.code).toBe(0);
  expect(await statusOf(p, "g1")).toBe("decided");
  const second = await p.werk(["status", "g2", "decided"]);
  console.log(second.err);
  expect(second.code).not.toBe(0);
  expect(second.err).toContain("  basis:");
  expect(second.err).toContain("werk link g2 <card> --type depends_on");
  expect(await statusOf(p, "g2")).not.toBe("decided");
});

const decidedX = () =>
  withMap([
    card("root", "Root"),
    ...decided("base", "Base", { parent: "root" }),
    [
      "node.added",
      { id: "x", kind: "card", title: "The card", status: "decided", who: "you", parent: "root", body: "A long first paragraph of the body.\n\nA second paragraph." },
    ],
    link("x", "base", "depends_on", "x reads base"),
    ["node.added", { id: "x:opt0", kind: "option", title: "Other", why_not: "Slower" }],
    link("x:opt0", "x", "alternative_to"),
    ["kill.added", { id: "x", criterion: { form: "revisit" } }],
  ]);

test("64.4", async () => {
  const p = decidedX();
  const shown = (await ok(p, ["show", "x"])).out;
  const before = lines(p);
  // A proposal cannot express the removal of an edge; the removal of the depends_on edge of a
  // decided card is the unlink, which is the change that drops it.
  const run = await p.werk(["unlink", "x", "base", "--type", "depends_on"]);
  console.log(run);
  expect(run.code).not.toBe(0);
  expect(run.err).toContain("basis");
  expect(run.err).toContain("werk link x <card> --type depends_on");
  expect(await statusOf(p, "x")).toBe("decided");
  expect((await ok(p, ["show", "x"])).out).toBe(shown);
  expect(lines(p)).toEqual(before);
});

test("64.5", async () => {
  const p = decidedX();
  const ops = [
    { tag: "elaborated", old: "A long first paragraph of the body.", new: "Short." },
    { tag: "removed", old: "A second paragraph." },
  ];
  await ok(p, ["propose", "x", "--ops", JSON.stringify(ops)]);
  const at = lines(p).length;
  const run = await p.werk(["accept", "x", "--actor", "you"]);
  console.log(run);
  expect(run.code).toBe(0);
  const out = (await ok(p, ["show", "x"])).out;
  console.log(out);
  expect(await statusOf(p, "x")).toBe("decided");
  expect(out).toContain("\nShort.\n");
  expect(out).not.toContain("second paragraph");
  const written = lines(p).slice(at).map((l) => JSON.parse(l));
  expect(written.map((e) => [e.type, e.payload.id])).toEqual([
    ["node.reopened", "x"],
    ["change.accepted", "x"],
    ["node.decided", "x"],
  ]);
});
