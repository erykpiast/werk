import { expect, test } from "bun:test";
import { card, chat, decided, ok, project, seed } from "./helpers.ts";

test("11.1 the rollup counts the card and its whole refines subtree", async () => {
  const p = project();
  seed(p, [
    card("root", "Root"),
    card("child-a", "Child A", { parent: "root" }),
    card("child-b", "Child B", { parent: "root", status: "proto" }),
    card("grand", "Grandchild", { parent: "child-a" }),
    decided("root"),
    decided("grand"),
  ]);
  const out = (await ok(p, ["show", "root"])).out;
  const rollups = out.split("\n").filter((l) => l.startsWith("subtree:"));
  expect(rollups.length).toBe(1);
  const line = rollups[0] as string;
  expect(line).toMatch(/\b4 cards\b/);
  expect(line).toMatch(/\b1 open\b/);
  expect(line).toMatch(/\b1 proto\b/);
  expect(line).toMatch(/\b2 decided\b/);
  const n = (re: RegExp) => Number(re.exec(line)?.[1] ?? 0);
  expect(n(/(\d+) open/) + n(/(\d+) proto/) + n(/(\d+) decided/)).toBe(n(/(\d+) cards?/));
});

test("11.2 each incoming refines link shows the child's own rollup", async () => {
  const p = project();
  seed(p, [
    card("parent", "Parent"),
    card("child", "Child", { parent: "parent" }),
    card("g-open", "Grand open", { parent: "child" }),
    card("g-done", "Grand decided", { parent: "child" }),
    decided("g-done"),
  ]);
  const out = (await ok(p, ["show", "parent"])).out;
  const link = out.split("\n").find((l) => /<- refines\s+child\b/.test(l));
  expect(link).toBeDefined();
  expect(link).toMatch(/\(3 cards/);
  expect(out.split("\n").find((l) => l.startsWith("subtree:"))).toMatch(/\b4 cards\b/);
});

test("11.3 a card prints its options, excerpts and a proposed source with their words", async () => {
  const p = project();
  seed(p, [card("root", "Root"), card("basis", "Basis", { parent: "root" }), card("main", "Main card", { parent: "root" })]);
  chat(p, "talk", [{ speaker: "person", at: "2026-01-02T10:00:00Z", session: "sess-1", kind: "spoken", text: "we keep every event forever" }]);
  await ok(p, ["link", "main", "basis", "--type", "depends_on", "--why", "takes the event shape"]);
  await ok(p, ["add", "main:opt0", "--kind", "option", "--title", "Rewrite the log", "--why_not", "loses history"]);
  await ok(p, ["accept", "main:opt0", "--actor", "you"]);
  await ok(p, ["link", "main:opt0", "main", "--type", "alternative_to"]);
  await ok(p, ["quote", "main", "talk", "every event forever"]);
  await ok(p, ["accept", "main:ex0", "--actor", "you"]);
  await ok(p, ["add", "src-log", "--kind", "source", "--title", "Event sourcing paper", "--finding", "logs never shrink"]);
  await ok(p, ["link", "main", "src-log", "--type", "supported_by"]);
  const out = (await ok(p, ["show", "main"])).out;
  const ls = out.split("\n");
  const dep = ls.findIndex((l) => /-> depends_on\s+basis/.test(l));
  expect(dep).toBeGreaterThanOrEqual(0);
  expect(ls[dep + 1]).toContain("why: takes the event shape");
  const opt = ls.indexOf("Options");
  const lastLink = Math.max(...ls.map((l, i) => (/^\s+(->|<-)/.test(l) ? i : -1)));
  expect(opt).toBeGreaterThan(lastLink);
  const optBlock = ls.slice(opt).join("\n");
  expect(optBlock).toContain("Rewrite the log");
  expect(optBlock).toContain("loses history");
  const say = ls.indexOf("Say");
  expect(say).toBeGreaterThan(0);
  expect(ls[say + 1]).toContain("person");
  expect(ls[say + 1]).toContain('"every event forever"');
  const ev = ls.indexOf("Ev");
  expect(ev).toBeGreaterThan(0);
  const evBlock = ls.slice(ev).join("\n");
  expect(evBlock).toContain("Event sourcing paper");
  expect(evBlock).toContain("logs never shrink");
  expect(ls[ev + 1]).toContain("proposed");
});

test("11.4 a card with no options prints no Options section", async () => {
  const p = project();
  seed(p, [
    card("root", "Root"),
    card("main", "Main card", { parent: "root" }),
    { type: "node.added", payload: { id: "src-a", kind: "source", title: "A source", finding: "it holds" } },
    { type: "edge.added", payload: { from: "main", to: "src-a", type: "supported_by" } },
  ]);
  chat(p, "talk", [{ speaker: "agent", at: "t1", session: "s1", kind: "spoken", text: "this is the quoted line" }]);
  await ok(p, ["quote", "main", "talk", "the quoted line"]);
  const ls = (await ok(p, ["show", "main"])).out.split("\n");
  expect(ls).toContain("Say");
  expect(ls).toContain("Ev");
  expect(ls).not.toContain("Options");
});

test("11.5 show with no id prints the root card", async () => {
  const p = project();
  seed(p, [card("root", "The root card"), card("second", "Second card", { parent: "root" })]);
  const run = await p.werk(["show"]);
  expect(run.code).toBe(0);
  expect(run.out).toContain("The root card");
  expect(run.out).toMatch(/^subtree: 2 cards/m);
  expect(run.out).toMatch(/<- refines\s+second  Second card  \(1 card/);
});
