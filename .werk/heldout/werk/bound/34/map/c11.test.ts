import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decidedCard, harness, link, proposed, real, writeLog, YOU } from "./util.ts";

const { project, werk } = harness();
const SLOW = 60_000;
const rollups = (s: string) => s.split("\n").filter((l) => l.startsWith("rollup:"));

test("11.1 the rollup counts the card and its whole refines subtree", async () => {
  writeLog(project(),
    decidedCard("root"),
    real("a", { parent: "root" }),
    real("b", { parent: "root", status: "proto" }),
    decidedCard("c"), link("c", "a", "refines"));
  const out = (await werk("show", "root")).stdout;
  expect(rollups(out)).toEqual(["rollup: 4 cards: 1 open, 1 proto, 2 decided"]);
}, SLOW);

test("11.2 each incoming refines link shows the child's own rollup", async () => {
  writeLog(project(),
    real("parent"), real("child", { parent: "parent" }),
    real("g1", { parent: "child" }), decidedCard("g2"), link("g2", "child", "refines"));
  const out = (await werk("show", "parent")).stdout;
  expect(out).toContain("rollup: 4 cards:");
  const row = out.split("\n").find((l) => /<-\s+refines\s+child/.test(l)) ?? "";
  expect(row).toContain("rollup: 3 cards: 2 open, 0 proto, 1 decided");
  // the child's row is an incoming refines link, and carries 3 cards
  expect(row).not.toContain("4 cards");
}, SLOW);

function chat() {
  const dir = join(project().dir, ".werk", "chats");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "talk.jsonl"), JSON.stringify({ speaker: "person", at: "10:02", session: "s1", kind: "spoken", text: "exactly these words" }) + "\n");
}

test("11.3 options, excerpts and a proposed source print with their words", async () => {
  writeLog(project(),
    real("other"), real("card"), link("card", "other", "depends_on"),
    real("opt", { kind: "option", title: "Option title", why: "Because it is slow" }), link("opt", "card", "alternative_to"),
    proposed("src", { kind: "source", title: "Source title", why: "The finding text" }), link("card", "src", "supported_by"));
  chat();
  expect((await werk("quote", "card", "talk", "exactly these words")).code).toBe(0);
  expect((await werk("accept", "card:ex0", ...YOU)).code).toBe(0);
  const out = (await werk("show", "card")).stdout;
  const dep = out.indexOf("-> depends_on");
  expect(dep).toBeGreaterThan(-1);
  expect(out).toContain("why: card takes other");
  const opts = out.indexOf("Options:");
  expect(opts).toBeGreaterThan(dep);
  expect(out.slice(opts)).toContain("Option title");
  expect(out.slice(opts)).toContain("why not: Because it is slow");
  expect(out).toMatch(/Say:\n\s+person: exactly these words/);
  const ev = out.slice(out.indexOf("Ev:"));
  expect(ev).toContain("Source title");
  expect(ev).toContain("finding: The finding text");
  expect(ev).toContain("proposed");
}, SLOW);

test("11.4 a card with no options prints no Options section", async () => {
  writeLog(project(), real("card"), real("src", { kind: "source", title: "Src", why: "f" }), link("card", "src", "supported_by"));
  chat();
  await werk("quote", "card", "talk", "exactly these words");
  await werk("accept", "card:ex0", ...YOU);
  const out = (await werk("show", "card")).stdout;
  expect(out).toContain("Say:");
  expect(out).toContain("Ev:");
  expect(out).not.toContain("Options");
}, SLOW);

test("11.5 show with no id prints the root card", async () => {
  writeLog(project(), real("root", { title: "The root" }), real("second", { parent: "root", title: "Second" }));
  const out = (await werk("show")).stdout;
  expect(out).toContain("The root");
  expect(out).toContain("rollup: 2 cards");
  const row = out.split("\n").find((l) => /<-\s+refines\s+second/.test(l)) ?? "";
  expect(row).toContain("rollup: 1 cards");
}, SLOW);
