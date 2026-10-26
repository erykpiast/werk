// werk/06: an excerpt for a card stages as a ghost until the person's ✓.
import { expect, test } from "bun:test";
import { card, useWerk } from "./support.ts";

const w = useWerk();

/** An agent adds an excerpt that supports the card, through the command line. */
async function addExcerpt() {
  const added = await w.run("add", "quote1", "--kind", "excerpt", "--title", "Ana: we pay per seat", "--body", "we pay per seat");
  const linked = await w.run("link", "pricing", "quote1", "--type", "supported_by", "--why", "she said it");
  return { added, linked };
}

test("06.1 a new excerpt stages as a ghost and waits for the ✓", async () => {
  w.seed(...card("pricing", { status: "decided", title: "Pricing", why: "we charge per seat" }));
  const before = (await w.run("show", "pricing")).stdout;
  const { added, linked } = await addExcerpt();
  expect(added.stderr).toBe("");
  expect(added.code).toBe(0);
  expect(added.stdout.trim()).toBe("proposed");
  expect(linked.code).toBe(0);
  const shown = (await w.run("show", "quote1")).stdout;
  expect(shown).toContain("proposed");
  const parent = (await w.run("show", "pricing")).stdout;
  expect(parent).toMatch(/supported_by\s+quote1.*\[(proposed|held)\]/);
  expect(parent).toContain("[decided]");
  expect(parent.split("\n").slice(0, 3)).toEqual(before.split("\n").slice(0, 3));
});

test("06.2 an accepted excerpt stops being a ghost and its link goes live", async () => {
  w.seed(...card("pricing", { status: "decided", title: "Pricing", why: "we charge per seat" }));
  const { added, linked } = await addExcerpt();
  expect(added.code).toBe(0);
  expect(linked.code).toBe(0);
  const accepted = await w.run("accept", "quote1", "--actor", "you");
  expect(accepted.code).toBe(0);
  const shown = (await w.run("show", "quote1")).stdout;
  expect(shown).not.toContain("proposed");
  const parent = (await w.run("show", "pricing")).stdout;
  expect(parent).toMatch(/supported_by\s+quote1/);
  expect(parent).not.toMatch(/quote1.*\[(proposed|held)\]/);
});
