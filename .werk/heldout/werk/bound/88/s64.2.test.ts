import { expect, test } from "bun:test";
import { freshProject } from "../src/test/project.ts";
import { card, decided, lines, ok, seed, words } from "./util.ts";

// The printed fix lines hold placeholders. The test fills each "<...>" with a value, "you|me|prototype" with you,
// and "<card>" with base; it runs the first line of each fact plus its "then:" line, never an "or:" line.
test("64.2 several missing facts are each reported with a command, and the commands fix them", async () => {
  const p = freshProject();
  seed(p, [...decided("base"), card("x", { body: "Some body text" })]);
  const before = lines(p);
  const run = await p.werk(["status", "x", "decided"]);
  expect(run.code).not.toBe(0);
  for (const fact of ["who:", "basis:", "option:", "kill criterion:"]) expect(run.err).toContain(`  ${fact}`);
  expect(run.err).toContain("werk edit x --who");
  expect(run.err).toContain("werk link x <card> --type depends_on");
  expect(run.err).toContain("werk add x:opt0 --kind option");
  expect(run.err).toContain("werk kill x --metric");
  expect((await ok(p, ["show", "x"])).out).toMatch(/^card x {2}\[open\]/);
  expect(lines(p)).toEqual(before);
  const fixes: string[] = [];
  let take = false;
  for (const raw of run.err.split("\n").slice(1)) {
    if (/^ {2}\S/.test(raw)) { take = true; continue; }
    const l = raw.trim();
    if (l.startsWith("or:")) continue;
    if (take && l.startsWith("werk ")) { fixes.push(l); take = false; }
    else if (l.startsWith("then: werk ")) fixes.push(l.slice(6));
  }
  expect(fixes).toHaveLength(5);
  for (const fix of fixes) {
    const args = words(fix).slice(1).map((a) => (a === "you|me|prototype" ? "you" : a === "<card>" ? "base" : a.startsWith("<") ? "filled value" : a));
    await ok(p, args);
  }
  await ok(p, ["status", "x", "decided"]);
  expect((await ok(p, ["show", "x"])).out).toMatch(/^card x {2}\[decided\]/);
}, 60000);
