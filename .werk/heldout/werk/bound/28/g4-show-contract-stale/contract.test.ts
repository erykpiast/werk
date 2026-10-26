import { expect, test } from "bun:test";
import { card, ev, freshProject, lines, ok, printedCommands, type Project } from "./helpers.ts";

function openRoot(): Project {
  const p = freshProject();
  card(p, "root", { title: "Root" });
  card(p, "base", { parent: "root", title: "Base", status: "decided", who: "me" });
  return p;
}

const statusEvents = (p: Project, id: string, from: number) =>
  lines(p)
    .slice(from)
    .map((l) => JSON.parse(l))
    .filter((e) => e.payload?.id === id && /^node\.(decided|reopened)$/.test(e.type));

/** Fill the placeholders an agent fills when it runs a printed command. */
function fill(cmd: string[]): string[] {
  return cmd.map((w) =>
    w === "you|me|prototype" ? "you" : w === "<card>" ? "base" : w.replace(/<what \w+ takes from <card>>/, "reads Base").replace(/<[^<>]+>/g, "filled in"),
  );
}

test("64.1 a card that lacks a kill criterion stays open; the printed command fixes it", async () => {
  const p = openRoot();
  card(p, "q", { parent: "root", title: "Queue", who: "you" });
  ev(p, "edge.added", { from: "q", to: "base", type: "depends_on", why: "Queue reads Base" });
  ev(p, "node.added", { id: "q:opt0", kind: "option", title: "A stack", why_not: "loses order" });
  ev(p, "edge.added", { from: "q:opt0", to: "q", type: "alternative_to" });
  const before = lines(p).length;
  const run = await p.werk(["status", "q", "decided"]);
  expect(run.code).not.toBe(0);
  expect(run.err).toContain("kill criterion");
  const cmds = printedCommands(run.err);
  const killCmd = cmds.find((c) => c[1] === "kill" && c[2] === "q" && c.includes("--revisit"));
  expect(killCmd).toEqual(["werk", "kill", "q", "--revisit"]);
  expect((await ok(p, ["show", "q"])).out).toStartWith("card q  [open]");
  expect(statusEvents(p, "q", before)).toHaveLength(0);
  await ok(p, (killCmd as string[]).slice(1));
  await ok(p, ["status", "q", "decided"]);
  expect((await ok(p, ["show", "q"])).out).toStartWith("card q  [decided]");
}, 30_000);

test("64.2 a card that lacks several facts reports each with its own command", async () => {
  const p = openRoot();
  card(p, "q", { parent: "root", title: "Queue", body: "Jobs wait in a queue." });
  const run = await p.werk(["status", "q", "decided"]);
  console.log(run.err);
  expect(run.code).not.toBe(0);
  for (const fact of ["who:", "basis:", "option:", "kill criterion:"]) expect(run.err).toContain(`  ${fact}`);
  expect((await ok(p, ["show", "q"])).out).toStartWith("card q  [open]");
  // Run the first printed fix of each fact, plus its "then:" line.
  const blocks = run.err.split(/\n {2}(?=\S)/).slice(1);
  expect(blocks).toHaveLength(4);
  for (const block of blocks) {
    const cmds = block.split("\n").slice(1).map((l) => l.trim());
    const first = cmds.filter((l, i) => i === 0 || l.startsWith("then: "));
    for (const line of first) {
      const [cmd] = printedCommands(line);
      expect(cmd).toBeDefined();
      await ok(p, fill(cmd as string[]).slice(1));
    }
  }
  await ok(p, ["status", "q", "decided"]);
  expect((await ok(p, ["show", "q"])).out).toStartWith("card q  [decided]");
}, 60_000);

test("64.3 a ghost card obeys the same check through its held edges", async () => {
  const p = openRoot();
  await ok(p, ["add", "g1", "--title", "G1", "--parent", "root", "--who", "you"]);
  await ok(p, ["link", "g1", "base", "--type", "depends_on", "--why", "G1 reads Base"]);
  await ok(p, ["add", "g1:opt0", "--kind", "option", "--title", "Other", "--why_not", "Slower"]);
  await ok(p, ["link", "g1:opt0", "g1", "--type", "alternative_to"]);
  await ok(p, ["kill", "g1", "--revisit"]);
  await ok(p, ["add", "g2", "--title", "G2", "--parent", "root", "--who", "me"]);
  await ok(p, ["kill", "g2", "--revisit"]);
  const r1 = await p.werk(["status", "g1", "decided"]);
  expect(r1.code).toBe(0);
  expect((await ok(p, ["show", "g1"])).out).toStartWith("card g1  [decided]");
  const r2 = await p.werk(["status", "g2", "decided"]);
  console.log(r2.err);
  expect(r2.code).not.toBe(0);
  expect(r2.err).toContain("basis: no decided card is a basis of #g2");
  expect(r2.err).toContain('werk link g2 <card> --type depends_on --why "<what g2 takes from <card>>"');
  expect((await ok(p, ["show", "g2"])).out).not.toContain("[decided]");
}, 30_000);

function decidedQ(): Project {
  const p = openRoot();
  card(p, "q", { parent: "root", title: "Queue", body: "Jobs wait in a queue. They run in order of arrival.", who: "you" });
  ev(p, "edge.added", { from: "q", to: "base", type: "depends_on", why: "Queue reads Base" });
  ev(p, "node.added", { id: "q:opt0", kind: "option", title: "A stack", why_not: "loses order" });
  ev(p, "edge.added", { from: "q:opt0", to: "q", type: "alternative_to" });
  ev(p, "kill.added", { id: "q", criterion: { form: "revisit" } });
  ev(p, "node.decided", { id: "q" });
  return p;
}

test("64.4 an amend that removes a required fact is refused", async () => {
  const p = decidedQ();
  const shown = (await ok(p, ["show", "q"])).out;
  expect(shown).toStartWith("card q  [decided]");
  const run = await p.werk(["unlink", "q", "base", "--type", "depends_on"]);
  expect(run.code).not.toBe(0);
  expect(run.err).toContain("basis: no decided card is a basis of #q");
  expect(run.err).toContain('werk link q <card> --type depends_on --why "<what q takes from <card>>"');
  expect((await ok(p, ["show", "q"])).out).toBe(shown);
}, 30_000);

test("64.5 an amend that keeps every fact succeeds, and card text is not checked", async () => {
  const p = decidedQ();
  const before = lines(p).length;
  const ops = [{ tag: "elaborated", old: "Jobs wait in a queue. They run in order of arrival.", new: "Jobs queue." }];
  const prop = await p.werk(["propose", "q", "--ops", JSON.stringify(ops)]);
  expect(prop.code).toBe(0);
  const acc = await p.werk(["accept", "q", "--actor", "you"]);
  console.log(prop, acc);
  expect(acc.code).toBe(0);
  const shown = (await ok(p, ["show", "q"])).out;
  expect(shown).toStartWith("card q  [decided]");
  expect(shown).toContain("\nJobs queue.\n");
  const types = statusEvents(p, "q", before).map((e) => e.type);
  expect(types).toEqual(["node.reopened", "node.decided"]);
}, 30_000);
