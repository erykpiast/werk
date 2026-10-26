// Held-out steps 11.1–11.5: werk show prints rollups, links and the proof sections.
import { expect, test } from "bun:test";
import { card, ok, seeded } from "./helpers.ts";

test("11.1 the rollup counts the card and its whole refines subtree", async () => {
  const p = seeded([
    card("root", "decided"),
    card("c1", "open", "root"),
    card("c2", "proto", "root"),
    card("g1", "decided", "c1"),
  ]);
  const out = (await ok(p, ["show", "root"])).out;
  const rollups = out.split("\n").filter((l) => l.startsWith("subtree:"));
  expect(rollups).toHaveLength(1);
  const line = rollups[0] as string;
  expect(line).toContain("4 cards");
  const n = (name: string) => Number(new RegExp(`(\\d+) ${name}`).exec(line)?.[1] ?? "NaN");
  expect(n("open")).toBe(1);
  expect(n("proto")).toBe(1);
  expect(n("decided")).toBe(2);
  expect(n("open") + n("proto") + n("decided")).toBe(4);
});

test("11.2 each incoming refines link shows the child's own rollup", async () => {
  const p = seeded([
    card("root", "decided"),
    card("child", "open", "root"),
    card("g1", "open", "child"),
    card("g2", "decided", "child"),
  ]);
  const out = (await ok(p, ["show", "root"])).out;
  const link = out.split("\n").find((l) => l.includes("<- refines") && l.includes("child"));
  expect(link).toBeDefined();
  expect(link).toContain("3 cards");
  expect(link).not.toContain("4 cards");
  expect(out.split("\n").find((l) => l.startsWith("subtree:"))).toContain("4 cards");
});

test("11.3 a card prints its options, excerpts and a proposed source with their words", async () => {
  const p = seeded([
    card("root", "decided"),
    card("base", "decided", "root"),
    card("c", "open", "root"),
    { type: "edge.added", payload: { from: "c", to: "base", type: "depends_on", why: "c reads the grid of base" } },
    {
      type: "node.added",
      payload: { id: "c:opt0", kind: "option", title: "Flat fee", why_not: "Big teams underpay", status: "open" },
    },
    { type: "edge.added", payload: { from: "c:opt0", to: "c", type: "alternative_to" } },
    { type: "change.accepted", payload: { id: "c:opt0" } },
    {
      type: "excerpt.quoted",
      actor: "agent",
      payload: {
        id: "c:say0",
        card: "c",
        title: "we keep one log per conversation",
        speaker: "person",
        said_at: "2026-10-01T10:00:00Z",
        conversation: "conv1",
        session: "sess1",
        message: 2,
        start: 0,
        end: 32,
      },
    },
  ]);
  await ok(p, ["add", "src1", "--kind", "source", "--title", "Benchmark notes", "--finding", "Writes are 3x faster"]);
  await ok(p, ["link", "c", "src1", "--type", "supported_by"]);
  const out = (await ok(p, ["show", "c"])).out;
  const ls = out.split("\n");
  const depIdx = ls.findIndex((l) => l.includes("-> depends_on") && l.includes("base"));
  expect(depIdx).toBeGreaterThan(-1);
  expect(ls[depIdx + 1]).toContain("c reads the grid of base");
  const lastLink = Math.max(...ls.map((l, i) => (/^\s+(->|<-) /.test(l) ? i : -1)));
  const opt = ls.indexOf("Options");
  expect(opt).toBeGreaterThan(lastLink);
  expect(out).toContain("Flat fee");
  expect(out).toContain("why not: Big teams underpay");
  const say = ls.indexOf("Say");
  expect(say).toBeGreaterThan(-1);
  expect(ls[say + 1]).toContain('person: "we keep one log per conversation"');
  const ev = ls.indexOf("Ev");
  expect(ev).toBeGreaterThan(-1);
  expect(ls[ev + 1]).toContain("Benchmark notes");
  expect(ls[ev + 1]).toContain("proposed");
  expect(ls[ev + 2]).toContain("Writes are 3x faster");
});

test("11.4 a card with no options prints no Options section", async () => {
  const p = seeded([
    card("root", "decided"),
    card("c", "open", "root"),
    {
      type: "excerpt.quoted",
      actor: "agent",
      payload: {
        id: "c:say0",
        card: "c",
        title: "ship it",
        speaker: "agent",
        said_at: "2026-10-01T10:00:00Z",
        conversation: "conv1",
        session: "sess1",
        message: 1,
        start: 0,
        end: 7,
      },
    },
  ]);
  await ok(p, ["add", "src1", "--kind", "source", "--title", "Notes", "--finding", "F"]);
  await ok(p, ["link", "c", "src1", "--type", "supported_by"]);
  const ls = (await ok(p, ["show", "c"])).out.split("\n");
  expect(ls).toContain("Say");
  expect(ls).toContain("Ev");
  expect(ls).not.toContain("Options");
});

test("11.5 show with no id prints the root card", async () => {
  const p = seeded([
    { type: "node.added", payload: { id: "root", kind: "card", title: "The Root Title", status: "decided" } },
    card("second", "open", "root"),
    card("g", "open", "second"),
  ]);
  const out = (await ok(p, ["show"])).out;
  expect(out).toContain("The Root Title");
  expect(out).toContain("subtree: 3 cards");
  const link = out.split("\n").find((l) => l.includes("<- refines") && l.includes("second"));
  expect(link).toContain("2 cards");
});
