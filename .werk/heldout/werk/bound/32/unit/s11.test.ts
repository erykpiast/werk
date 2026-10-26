import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { expect, test } from "bun:test";
import { werkHarness } from "./h.ts";

const { project, werk, must, decide, real } = werkHarness();

test("11.1 the rollup counts the card and its whole refines subtree", async () => {
  await decide("root1", { title: "Root one" });
  await decide("c1", { parent: "root1" });
  await must("add", "c2", "--title", "c2", "--parent", "root1", "--status", "proto");
  await must("accept", "c2", "--actor", "you");
  await decide("g1", { parent: "c1" });
  // c1 must be decided while g1 is added under it; reopening it afterwards leaves g1 decided.
  await must("reopen", "c1", "--reason", "postponed");
  const r = await werk("show", "root1");
  const rollups = r.stdout.split("\n").filter((l) => l.startsWith("rollup:"));
  expect(rollups).toHaveLength(1);
  expect(rollups[0]).toMatch(/4 cards/);
  expect(rollups[0]).toMatch(/1 open/);
  expect(rollups[0]).toMatch(/1 proto/);
  expect(rollups[0]).toMatch(/2 decided/);
});

test("11.2 each incoming refines link shows the child's own rollup", async () => {
  await decide("par");
  await decide("kid", { parent: "par" });
  await real("gk1", { parent: "kid" });
  await decide("gk2", { parent: "kid" });
  const r = await werk("show", "par");
  expect(r.stdout).toMatch(/rollup: 4 cards/);
  const link = r.stdout.split("\n").find((l) => l.includes("<- refines") && l.includes("kid"));
  expect(link).toBeDefined();
  expect(link).toMatch(/rollup: 3 cards/);
});

async function chat(project: () => { logPath: string }) {
  const dir = join(dirname(project().logPath), "chats");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "talk.jsonl"),
    `${JSON.stringify({ kind: "spoken", speaker: "ann", at: "2026-01-01T00:00:00Z", session: "s1", text: "Exactly these verbatim words here" })}\n`,
  );
}

test("11.3 a card prints options, excerpts and a proposed source with their words", async () => {
  await chat(project);
  await real("base", { title: "Base card" });
  await real("card", { title: "The card" });
  await must("link", "card", "base", "--type", "depends_on", "--why", "needs the base");
  await must("add", "card:opt0", "--kind", "option", "--title", "Option title", "--why", "Why not this");
  await must("accept", "card:opt0", "--actor", "you");
  await must("link", "card:opt0", "card", "--type", "alternative_to");
  await must("quote", "card", "talk", "verbatim words");
  await must("accept", "card:ex0", "--actor", "you");
  await must("add", "ev", "--kind", "source", "--title", "Source title", "--why", "The finding words");
  await must("link", "card", "ev", "--type", "supported_by");
  const out = (await werk("show", "card")).stdout;
  expect(out).toMatch(/depends_on\s+base[^\n]*\n\s+why: needs the base/);
  const iLink = out.indexOf("needs the base");
  const iOpt = out.indexOf("Options:");
  expect(iOpt).toBeGreaterThan(iLink);
  expect(out).toMatch(/Options:\n\s+card:opt0\s+Option title\n\s+why not: Why not this/);
  expect(out).toMatch(/Say:\n\s+ann: verbatim words/);
  const ev = out.split("Ev:")[1] ?? "";
  expect(ev).toContain("Source title");
  expect(ev).toContain("The finding words");
  expect(ev).toContain("proposed");
});

test("11.4 a card with no options prints no Options section", async () => {
  await chat(project);
  await real("card", { title: "The card" });
  await must("quote", "card", "talk", "verbatim words");
  await must("accept", "card:ex0", "--actor", "you");
  await must("add", "ev", "--kind", "source", "--title", "Source title");
  await must("accept", "ev", "--actor", "you");
  await must("link", "card", "ev", "--type", "supported_by");
  const out = (await werk("show", "card")).stdout;
  expect(out).toContain("Say:");
  expect(out).toContain("Ev:");
  expect(out).not.toContain("Options");
});

test("11.5 show with no id prints the root card", async () => {
  await real("top", { title: "Top title" });
  await real("sub", { title: "Sub title", parent: "top" });
  await real("subsub", { title: "Subsub", parent: "sub" });
  const out = (await werk("show")).stdout;
  expect(out).toContain("Top title");
  expect(out).toMatch(/rollup: 3 cards/);
  const link = out.split("\n").find((l) => l.includes("<- refines") && l.includes("sub"));
  expect(link).toBeDefined();
  expect(link).toMatch(/rollup: 2 cards/);
});
