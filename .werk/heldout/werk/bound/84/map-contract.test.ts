import { expect, test } from "bun:test";
import { card, decidedCard, type Ev, lines, link, ok, type Project, seed, withMap } from "./map-helpers.ts";

const T = 120_000;
const base = (): Project => withMap([card("root", "Root"), ...decidedCard("base", "Base", "root")]);
const opt = (id: string): Ev[] => [
  ["node.added", { id: `${id}:opt0`, kind: "option", title: "Other", why_not: "Slower" }],
  link(`${id}:opt0`, id, "alternative_to"),
];
/** The printed command lines of one fact: indented `werk` lines that start with the verb. */
const printed = (err: string, verb: string) =>
  err
    .split("\n")
    .map((l) => l.trim().replace(/^or: /, ""))
    .filter((l) => l.startsWith(`werk ${verb} `));

test("64.1 missing kill criterion keeps card open; printed command fixes it", async () => {
  const p = base();
  seed(p, [card("q", "Queue", "root", { who: "you" }), link("q", "base", "depends_on", "reads base"), ...opt("q")]);
  const before = lines(p);
  const r = await p.werk(["status", "q", "decided"]);
  expect(r.code).not.toBe(0);
  expect(r.err).toContain("kill criterion");
  expect(r.err).not.toContain("who:");
  const cmds = printed(r.err, "kill").filter((l) => !l.includes("<"));
  expect(cmds.length).toBeGreaterThan(0);
  expect(lines(p)).toEqual(before);
  expect((await ok(p, ["show", "q"])).out).toStartWith("card q  [open]");
  await ok(p, cmds[0]!.split(" ").slice(1));
  await ok(p, ["status", "q", "decided"]);
  expect((await ok(p, ["show", "q"])).out).toStartWith("card q  [decided]");
}, T);

test("64.2 several missing facts each with a command", async () => {
  const p = base();
  seed(p, [card("q", "Queue", "root", { body: "Jobs wait." })]);
  const before = lines(p);
  const r = await p.werk(["status", "q", "decided"]);
  expect(r.code).not.toBe(0);
  for (const s of ["who:", "basis:", "option:", "kill criterion:"]) expect(r.err).toContain(s);
  for (const v of ["edit", "link", "add", "kill"]) expect(printed(r.err, v).length).toBeGreaterThan(0);
  expect(lines(p)).toEqual(before);
  expect((await ok(p, ["show", "q"])).out).toStartWith("card q  [open]");
  // Each printed command has placeholders; fill them with concrete values.
  await ok(p, ["edit", "q", "--who", "you"]);
  await ok(p, ["link", "q", "base", "--type", "depends_on", "--why", "reads base"]);
  await ok(p, ["add", "q:opt0", "--kind", "option", "--title", "Other", "--why_not", "Slower"]);
  await ok(p, ["link", "q:opt0", "q", "--type", "alternative_to"]);
  await ok(p, ["kill", "q", "--revisit"]);
  await ok(p, ["status", "q", "decided"]);
  expect((await ok(p, ["show", "q"])).out).toStartWith("card q  [decided]");
}, T);

test("64.3 ghost obeys the check through held edges", async () => {
  const p = base();
  await ok(p, ["add", "g1", "--title", "Ghost one", "--parent", "root", "--who", "you"]);
  await ok(p, ["link", "g1", "base", "--type", "depends_on", "--why", "reads base"]);
  await ok(p, ["add", "g1:opt0", "--kind", "option", "--title", "Other", "--why_not", "Slower"]);
  await ok(p, ["link", "g1:opt0", "g1", "--type", "alternative_to"]);
  await ok(p, ["kill", "g1", "--revisit"]);
  await ok(p, ["add", "g2", "--title", "Ghost two", "--parent", "root", "--who", "you"]);
  await ok(p, ["add", "g2:opt0", "--kind", "option", "--title", "Other2", "--why_not", "Slower"]);
  await ok(p, ["link", "g2:opt0", "g2", "--type", "alternative_to"]);
  await ok(p, ["kill", "g2", "--revisit"]);
  const r1 = await p.werk(["status", "g1", "decided"]);
  expect(r1.code).toBe(0);
  expect((await ok(p, ["show", "g1"])).out).toStartWith("card g1  [decided]");
  const r2 = await p.werk(["status", "g2", "decided"]);
  expect(r2.code).not.toBe(0);
  expect(r2.err).toContain("basis");
  expect(printed(r2.err, "link").length).toBeGreaterThan(0);
  expect((await ok(p, ["show", "g2"])).out).toStartWith("card g2  [open]");
}, T);

function decidedQ(): Project {
  const p = withMap([card("root", "Root"), ...decidedCard("base", "Base", "root")]);
  seed(p, [
    card("q", "Queue", "root", { body: "Jobs wait in a queue.", who: "you" }),
    link("q", "base", "depends_on", "reads base"),
    ...opt("q"),
    ["kill.added", { id: "q", criterion: { form: "revisit" } }],
    ["node.decided", { id: "q" }],
  ]);
  return p;
}

test("64.4 amend that drops a required fact is refused", async () => {
  const p = decidedQ();
  const before = lines(p);
  const shown = (await ok(p, ["show", "q"])).out;
  const r = await p.werk(["unlink", "q", "base", "--type", "depends_on"]);
  expect(r.code).not.toBe(0);
  expect(r.err).toContain("basis");
  expect(printed(r.err, "link").length).toBeGreaterThan(0);
  expect(lines(p)).toEqual(before);
  expect((await ok(p, ["show", "q"])).out).toBe(shown);
  expect(shown).toStartWith("card q  [decided]");
}, T);

test("64.5 amend that keeps every fact succeeds", async () => {
  const p = decidedQ();
  const b = lines(p).length;
  const ops = [{ tag: "elaborated", old: "Jobs wait in a queue.", new: "Jobs queue." }];
  await ok(p, ["propose", "q", "--ops", JSON.stringify(ops)]);
  await ok(p, ["accept", "q", "--actor", "you"]);
  const s = (await ok(p, ["show", "q"])).out;
  expect(s).toStartWith("card q  [decided]");
  expect(s).toContain("Jobs queue.");
  const types = lines(p).slice(b).map((l) => JSON.parse(l).type);
  expect(types).toContain("node.reopened");
  expect(types).toContain("node.decided");
}, T);
