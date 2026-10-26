import { afterEach, beforeEach, expect, test } from "bun:test";
import { appendFileSync } from "node:fs";
import { createProject, type Project } from "../src/test-env/project.ts";
import { decide, must, realCard, werk } from "./helpers.ts";

let p: Project;
beforeEach(() => {
  p = createProject();
});
afterEach(() => p.dispose());

const rollupLine = (text: string) =>
  text.split("\n").find((l) => /rollup/i.test(l) || /\bcards?\b/.test(l) && /\bopen\b/.test(l));

/** Raw log lines for what the command line cannot write: an excerpt with a speaker and words. */
function rawEvent(event: Record<string, unknown>) {
  appendFileSync(p.logPath, `${JSON.stringify(event)}\n`);
}

test("11.1 the rollup counts the card and its whole refines subtree", async () => {
  await realCard(p, "root");
  await decide(p, "root");
  await realCard(p, "child-open", "root");
  await must(p, "add", "child-proto", "--title", "proto", "--status", "proto", "--parent", "root");
  await must(p, "accept", "child-proto", "--actor", "you");
  // The grandchild is decided first, then refines the open child: a decided card needs a decided parent otherwise.
  await realCard(p, "grand");
  await decide(p, "grand");
  await must(p, "link", "grand", "child-open", "--type", "refines", "--why", "w");

  const out = (await werk(p, "show", "root")).stdout;
  const line = rollupLine(out);
  expect(line).toBeDefined();
  expect(line).toMatch(/\b4\b/);
  expect(line).toMatch(/1 open/);
  expect(line).toMatch(/1 proto/);
  expect(line).toMatch(/2 decided/);
  expect(out.split("\n").filter((l) => /rollup/i.test(l))).toHaveLength(1);
});

test("11.2 each incoming refines link shows the child's own rollup", async () => {
  await realCard(p, "parent");
  await realCard(p, "child", "parent");
  await realCard(p, "g-open", "child");
  await realCard(p, "g-dec");
  await decide(p, "g-dec");
  await must(p, "link", "g-dec", "child", "--type", "refines", "--why", "w");

  const out = (await werk(p, "show", "parent")).stdout;
  const link = out.split("\n").find((l) => /<- refines\s+child/.test(l));
  expect(link).toBeDefined();
  const around = out.split("\n").slice(out.split("\n").indexOf(link as string), out.split("\n").indexOf(link as string) + 3).join("\n");
  expect(around).toMatch(/\b3\b/);
  expect(around).toMatch(/1 open/);
  expect(around).toMatch(/1 decided/);
  const own = out.split("\n").filter((l) => /rollup/i.test(l) || /\b4\b/.test(l));
  expect(own.join("\n")).toMatch(/\b4\b/);
});

test("11.3 a card prints its options, excerpts and a proposed source with their words", async () => {
  await realCard(p, "base");
  await decide(p, "base");
  await realCard(p, "card");
  await must(p, "link", "card", "base", "--type", "depends_on", "--why", "needs the base");
  await must(p, "add", "card:opt0", "--kind", "option", "--title", "Use polling", "--why", "too slow");
  await must(p, "link", "card:opt0", "card", "--type", "alternative_to");
  rawEvent({ type: "node.proposed", id: "ex1", kind: "excerpt", title: "quote", speaker: "Ada", words: "ship it on friday", status: "open" });
  await must(p, "add", "src1", "--kind", "source", "--title", "RFC 9000", "--why", "QUIC is the finding");
  await must(p, "link", "card", "ex1", "--type", "supported_by");
  await must(p, "link", "card", "src1", "--type", "supported_by");

  const out = (await werk(p, "show", "card")).stdout;
  expect(out).toContain("needs the base");
  const links = out.indexOf("depends_on");
  const options = out.indexOf("Options");
  expect(options).toBeGreaterThan(links);
  expect(out).toContain("Use polling");
  expect(out).toContain("too slow");
  expect(out).toMatch(/Say/);
  expect(out).toContain("Ada");
  expect(out).toContain("ship it on friday");
  expect(out).toMatch(/Ev/);
  expect(out).toContain("RFC 9000");
  expect(out).toContain("QUIC is the finding");
  const evLine = out.split("\n").find((l) => l.includes("RFC 9000"));
  expect(evLine).toContain("proposed");
});

test("11.4 a card with no options prints no Options section", async () => {
  await realCard(p, "card");
  rawEvent({ type: "node.proposed", id: "ex1", kind: "excerpt", title: "quote", speaker: "Ada", words: "ship it", status: "open" });
  await must(p, "add", "src1", "--kind", "source", "--title", "RFC 9000", "--why", "finding");
  await must(p, "link", "card", "ex1", "--type", "supported_by");
  await must(p, "link", "card", "src1", "--type", "supported_by");
  const out = (await werk(p, "show", "card")).stdout;
  expect(out).toMatch(/Say/);
  expect(out).toMatch(/Ev/);
  expect(out).not.toContain("Options");
});

test("11.5 show with no id prints the root card", async () => {
  await realCard(p, "root", undefined, "The Root");
  await realCard(p, "second", "root");
  const r = await werk(p, "show");
  expect(r.code).toBe(0);
  expect(r.stdout).toContain("The Root");
  expect(r.stdout).toMatch(/rollup|\b2\b.*cards?/i);
  expect(r.stdout).toMatch(/<- refines\s+second/);
});
