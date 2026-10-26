// Steps 11.1 to 11.5: the card text of `werk show`, with its rollup and its sections.
import { describe, expect, test } from "bun:test";
import { addCard, decidedCard, ok, useWerk } from "./support.ts";

const { werk } = useWerk();

const cardsLine = (text: string, n: number) =>
  text.split("\n").some((l) => new RegExp(`\\b${n} cards?\\b`).test(l));

describe("show", () => {
  test("11.1 the rollup counts the card and its whole refines subtree", async () => {
    await decidedCard(werk, "root");
    await addCard(werk, "open-child", { parent: "root" });
    await addCard(werk, "proto-child", { parent: "root", status: "proto" });
    await decidedCard(werk, "grand", "open-child");

    const shown = (await werk("show", "root")).stdout;
    const rollup = shown.split("\n").filter((l) => /\b4 cards?\b/.test(l));
    expect(rollup).toHaveLength(1);
    expect(rollup[0]).toMatch(/\b1 open\b/);
    expect(rollup[0]).toMatch(/\b1 proto\b/);
    expect(rollup[0]).toMatch(/\b2 decided\b/);
  });

  test("11.2 each incoming refines link shows the child's own rollup", async () => {
    await addCard(werk, "parent");
    await addCard(werk, "child", { parent: "parent" });
    await addCard(werk, "g-open", { parent: "child" });
    await decidedCard(werk, "g-done", "child");

    const shown = (await werk("show", "parent")).stdout;
    const link = shown
      .split("\n")
      .find((l) => l.includes("<-") && l.includes("child"));
    expect(link).toBeDefined();
    expect(link).toMatch(/\b3 cards?\b/);
    expect(cardsLine(shown.split("\n").filter((l) => l !== link).join("\n"), 4)).toBe(true);
  });

  test("11.3 a card prints its options, excerpts and a proposed source with their words", async () => {
    await addCard(werk, "base");
    await addCard(werk, "card");
    await ok(werk, "link", "card", "base", "--type", "depends_on", "--why", "stated reason");
    await ok(werk, "add", "card:opt0", "--kind", "option", "--title", "Option title", "--why", "option why-not");
    await ok(werk, "link", "card:opt0", "card", "--type", "alternative_to");
    // An excerpt carries a speaker and verbatim words. The command line has no way to add one.
    await ok(werk, "add", "said", "--kind", "excerpt", "--title", "exact words");
    await ok(werk, "add", "src", "--kind", "source", "--title", "Source title", "--why", "the finding");
    await ok(werk, "link", "card", "src", "--type", "supported_by");

    const shown = (await werk("show", "card")).stdout;
    expect(shown).toContain("stated reason");
    expect(shown).toMatch(/Options/);
    expect(shown).toContain("Option title");
    expect(shown).toContain("option why-not");
    expect(shown).toMatch(/Say/);
    expect(shown).toMatch(/Ev/);
    expect(shown).toContain("Source title");
    expect(shown).toContain("the finding");
    expect(shown).toContain("proposed");
  });

  test("11.4 a card with no options prints no Options section", async () => {
    await addCard(werk, "card");
    await ok(werk, "add", "said", "--kind", "excerpt", "--title", "exact words");
    await ok(werk, "add", "src", "--kind", "source", "--title", "Source title", "--why", "the finding");
    await ok(werk, "link", "card", "src", "--type", "supported_by");
    const shown = (await werk("show", "card")).stdout;
    expect(shown).toMatch(/Say/);
    expect(shown).toMatch(/Ev/);
    expect(shown).not.toMatch(/Options/);
  });

  test("11.5 show with no id prints the root card", async () => {
    await addCard(werk, "root");
    await addCard(werk, "second", { parent: "root" });
    const result = await werk("show");
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Title of root");
    expect(cardsLine(result.stdout, 2)).toBe(true);
    const link = result.stdout.split("\n").find((l) => l.includes("<-") && l.includes("second"));
    expect(link).toBeDefined();
    expect(link).toMatch(/\b1 cards?\b/);
  });
});
