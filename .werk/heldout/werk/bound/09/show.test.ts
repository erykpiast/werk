import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  appendRaw,
  createProject,
  decide,
  decideThenAttach,
  must,
  type Project,
  real,
  werk,
} from "./support.ts";

let p: Project;
beforeEach(() => {
  p = createProject();
});
afterEach(() => p.dispose());

const show = async (...args: string[]) => {
  const r = await werk(p, "show", ...args);
  expect(r.stderr).toBe("");
  expect(r.code).toBe(0);
  return r.stdout.split("\n");
};
const rollupLines = (out: string[]) => out.filter((l) => /\d+ cards?\b/.test(l));

test("11.1 the rollup counts the card and its whole refines subtree", async () => {
  await decide(p, "root", { title: "Root" });
  await real(p, "child-open", { parent: "root" });
  await real(p, "child-proto", { parent: "root", status: "proto" });
  // The grandchild is decided before it is attached, because its parent is open.
  await decideThenAttach(p, "grand", "child-open");

  const out = await show("root");
  const rolls = rollupLines(out);
  expect(rolls).toHaveLength(1);
  expect(rolls[0]).toMatch(/\b4 cards\b/);
  expect(rolls[0]).toMatch(/\b1 open\b/);
  expect(rolls[0]).toMatch(/\b1 proto\b/);
  expect(rolls[0]).toMatch(/\b2 decided\b/);
});

test("11.2 each incoming refines link shows the child's own rollup", async () => {
  await real(p, "parent", { title: "Parent" });
  await real(p, "child", { title: "Child", parent: "parent" });
  await real(p, "gc-open", { parent: "child" });
  await decideThenAttach(p, "gc-decided", "child");

  const out = await show("parent");
  const link = out.find((l) => l.includes("<-") && l.includes("child"));
  expect(link).toBeDefined();
  expect(link).toMatch(/\b3 cards\b/);
  const own = out.filter((l) => !l.includes("<-") && /\b4 cards\b/.test(l));
  expect(own).toHaveLength(1);
});

test("11.3 a card prints its options, excerpts and a proposed source with their words", async () => {
  await decide(p, "base", { title: "Base card" });
  await real(p, "card", { title: "The card" });
  await must(p, "link", "card", "base", "--type", "depends_on", "--why", "needs the base");
  await real(p, "card:opt0", { title: "Use a file", why: "A file loses writes" });
  // (the option links to the card below)
  await must(p, "link", "card:opt0", "card", "--type", "alternative_to");
  // No verb adds an excerpt with a speaker, so the log is written directly.
  appendRaw(p, {
    type: "node.proposed",
    id: "said",
    kind: "excerpt",
    title: "Dana",
    body: "We never lose a write.",
    speaker: "Dana",
    status: "open",
  });
  await must(p, "link", "card", "said", "--type", "supported_by");
  await must(p, "accept", "said", "--actor", "you");
  await must(p, "add", "src", "--kind", "source", "--title", "Journal paper", "--body", "Journals are safe");
  await must(p, "link", "card", "src", "--type", "supported_by");

  const text = (await show("card")).join("\n");
  expect(text).toMatch(/depends_on\s+base/);
  expect(text).toContain("needs the base");
  const at = (s: string) => text.indexOf(s);
  expect(at("Options")).toBeGreaterThan(at("depends_on"));
  expect(text).toMatch(/Options[\s\S]*Use a file[\s\S]*A file loses writes/);
  expect(text).toMatch(/Say[\s\S]*Dana[\s\S]*We never lose a write\./);
  expect(text).toMatch(/Ev[\s\S]*Journal paper[\s\S]*Journals are safe/);
  expect(text).toMatch(/Journal paper[\s\S]*proposed/);
});

test("11.4 a card with no options prints no Options section", async () => {
  await real(p, "card", { title: "The card" });
  appendRaw(p, {
    type: "node.proposed",
    id: "said",
    kind: "excerpt",
    title: "Dana",
    body: "A spoken sentence.",
    speaker: "Dana",
    status: "open",
  });
  await must(p, "link", "card", "said", "--type", "supported_by");
  await must(p, "accept", "said", "--actor", "you");
  await must(p, "add", "src", "--kind", "source", "--title", "A source");
  await must(p, "link", "card", "src", "--type", "supported_by");

  const text = (await show("card")).join("\n");
  expect(text).toMatch(/^Say\b/m);
  expect(text).toMatch(/^Ev\b/m);
  expect(text).not.toMatch(/^Options\b/m);
});

test("11.5 show with no id prints the root card", async () => {
  await decide(p, "root", { title: "The root card" });
  await real(p, "second", { title: "Second card", parent: "root" });

  const out = await show();
  const text = out.join("\n");
  expect(text).toContain("The root card");
  expect(rollupLines(out).length).toBeGreaterThan(0);
  const link = out.find((l) => l.includes("<-") && l.includes("second"));
  expect(link).toBeDefined();
  expect(link).toMatch(/\b1 card\b/);
});
