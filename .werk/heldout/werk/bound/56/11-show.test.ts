import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { card, type Held, held } from "./helpers.ts";

/** The counts of a rollup text such as "4 cards, 1 open, 1 proto, 2 decided". */
function counts(text: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [, n, word] of text.matchAll(/(\d+) (cards?|open|proto|decided)/g)) {
    out[(word as string).replace(/^card$/, "cards")] = Number(n);
  }
  return out;
}

const rollupLine = (out: string) => out.split("\n").find((line) => line.startsWith("subtree:"));

test("11.1 the rollup counts the card and its whole refines subtree", async () => {
  const h = held();
  card(h, "root", "Root", {}, true);
  card(h, "child-open", "Child open", { parent: "root" });
  h.seed("node.added", { id: "child-proto", kind: "card", title: "Child proto", parent: "root", status: "proto" });
  card(h, "grandchild", "Grandchild", { parent: "child-open" }, true);

  const run = await h.w("show", "root");
  const rollups = run.out.split("\n").filter((line) => line.startsWith("subtree:"));
  expect(rollups.length).toBe(1);
  const c = counts(rollups[0] as string);
  expect(c.cards).toBe(4);
  expect(c.open).toBe(1);
  expect(c.proto).toBe(1);
  expect(c.decided).toBe(2);
  expect((c.open ?? 0) + (c.proto ?? 0) + (c.decided ?? 0)).toBe(c.cards as number);
});

test("11.2 each incoming refines link shows the child's own rollup", async () => {
  const h = held();
  card(h, "parent", "Parent");
  card(h, "child", "Child", { parent: "parent" });
  card(h, "gc-open", "Grandchild open", { parent: "child" });
  card(h, "gc-decided", "Grandchild decided", { parent: "child" }, true);

  const run = await h.w("show", "parent");
  const link = run.out.split("\n").find((line) => /<- refines\s+child\b/.test(line));
  expect(link).toBeDefined();
  expect(counts(link as string).cards).toBe(3);
  expect(counts(rollupLine(run.out) ?? "").cards).toBe(4);
});

async function proofCard(h: Held, withOption: boolean): Promise<void> {
  card(h, "basis", "Basis card");
  card(h, "subject", "Subject card");
  h.seed("edge.added", { from: "subject", to: "basis", type: "depends_on", why: "the subject reads the basis format" });
  if (withOption) {
    h.seed("node.added", {
      id: "subject:opt0",
      kind: "option",
      title: "Keep two formats",
      why_not: "two formats drift apart",
    });
    h.seed("edge.added", { from: "subject:opt0", to: "subject", type: "alternative_to" });
  }
  mkdirSync(join(h.dir, ".werk", "chats"), { recursive: true });
  const line = {
    speaker: "person",
    at: "2026-01-02T10:00:00Z",
    session: "s-1",
    kind: "spoken",
    text: "one format for every reader",
  };
  writeFileSync(join(h.dir, ".werk", "chats", "design.jsonl"), `${JSON.stringify(line)}\n`);
  expect((await h.w("quote", "subject", "design", "one format for every reader")).code).toBe(0);
  expect((await h.w("accept", "subject:ex0", "--actor", "you")).code).toBe(0);
  const add = await h.w(
    "add",
    "src-format-study",
    "--kind",
    "source",
    "--title",
    "Format study",
    "--url",
    "https://example.invalid/study",
    "--finding",
    "readers break on a second format",
  );
  expect(add.code).toBe(0);
  expect((await h.w("link", "subject", "src-format-study", "--type", "supported_by")).code).toBe(0);
}

test("11.3 a card prints its options, excerpts and a proposed source with their words", async () => {
  const h = held();
  await proofCard(h, true);
  const out = (await h.w("show", "subject")).out;
  const lines = out.split("\n");

  const dep = lines.findIndex((line) => /-> depends_on\s+basis/.test(line));
  expect(dep).toBeGreaterThanOrEqual(0);
  expect(out).toContain("the subject reads the basis format");

  const lastLink = lines.findLastIndex((line) => /^\s+(->|<-) /.test(line));
  const options = lines.indexOf("Options");
  expect(options).toBeGreaterThan(lastLink);
  expect(out).toContain("Keep two formats");
  expect(out).toContain("two formats drift apart");

  const say = lines.indexOf("Say");
  expect(say).toBeGreaterThan(0);
  const sayLine = lines.slice(say + 1).find((line) => line.includes("one format for every reader"));
  expect(sayLine).toContain("person");
  expect(sayLine).toContain('"one format for every reader"');

  const ev = lines.indexOf("Ev");
  expect(ev).toBeGreaterThan(0);
  const evText = lines.slice(ev + 1).join("\n");
  expect(evText).toContain("Format study");
  expect(evText).toContain("readers break on a second format");
  const sourceLine = lines.slice(ev + 1).find((line) => line.includes("Format study"));
  expect(sourceLine).toContain("proposed");
});

test("11.4 a card with no options prints no Options section", async () => {
  const h = held();
  await proofCard(h, false);
  const lines = (await h.w("show", "subject")).out.split("\n");
  expect(lines).toContain("Say");
  expect(lines).toContain("Ev");
  expect(lines).not.toContain("Options");
});

test("11.5 show with no id prints the root card", async () => {
  const h = held();
  card(h, "root", "The root card");
  card(h, "second", "Second card", { parent: "root" });
  card(h, "third", "Third card", { parent: "second" });

  const run = await h.w("show");
  expect(run.code).toBe(0);
  expect(run.out).toContain("The root card");
  expect(rollupLine(run.out)).toBeDefined();
  const link = run.out.split("\n").find((line) => /<- refines\s+second\b/.test(line));
  expect(link).toBeDefined();
  expect(counts(link as string).cards).toBe(2);
});
