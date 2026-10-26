import { afterEach, beforeEach, expect, test } from "bun:test";
import { createProject, type Project } from "../src/test-env/project.ts";
import { chat, decided, edge, ghost, put, real, werk } from "./support.ts";

let p: Project;
beforeEach(() => {
  p = createProject();
});
afterEach(() => p.dispose());

test("11.1 rollup counts card and refines subtree", async () => {
  put(
    p,
    decided("root", "Root"),
    decided("c1", "Child one", { parent: "root" }),
    real("c2", "Child two", { parent: "root", status: "proto" }),
    decided("gc", "Grandchild", { parent: "c1" }),
    { type: "node.reopened", id: "c1", reason: "invalidated", at: "2026-10-10T09:00:00.000Z" },
  );
  const r = await werk(p, "show", "root");
  expect(r.code).toBe(0);
  const roll = r.stdout.split("\n").filter((l) => l.startsWith("rollup:"));
  expect(roll).toHaveLength(1);
  expect(roll[0]).toContain("4 cards");
  expect(roll[0]).toContain("1 open");
  expect(roll[0]).toContain("1 proto");
  expect(roll[0]).toContain("2 decided");
});

test("11.2 incoming refines link shows child's own rollup", async () => {
  put(
    p,
    decided("parent", "Parent"),
    decided("child", "Child", { parent: "parent" }),
    real("g1", "Grand one", { parent: "child" }),
    decided("g2", "Grand two", { parent: "child" }),
    { type: "node.reopened", id: "child", reason: "invalidated", at: "2026-10-10T09:00:00.000Z" },
  );
  const r = await werk(p, "show", "parent");
  const out = r.stdout;
  expect(out).toMatch(/<- refines\s+child/);
  const linkLine = out.split("\n").find((l) => l.includes("<- refines") && l.includes("child"))!;
  expect(linkLine).toContain("3 cards");
  expect(out.split("\n").find((l) => l.startsWith("rollup:"))).toContain("4 cards");
});

test("11.3 card prints options, excerpt and proposed source", async () => {
  put(
    p,
    decided("base", "Base"),
    real("card", "The card"),
    edge("card", "base", "depends_on", "needs the base"),
    { type: "node.proposed", id: "opt", kind: "option", title: "Other way", why: "too slow", status: "open" },
    { type: "node.accepted", id: "opt", actor: "you" },
    edge("opt", "card", "alternative_to"),
  );
  chat(p, "talk", { speaker: "person", at: "10:02", session: "s1", kind: "spoken", text: "we want exactly this" });
  expect((await werk(p, "quote", "card", "talk", "exactly this")).code).toBe(0);
  const accepted = await werk(p, "accept", "card:ex0", "--actor", "you");
  expect(accepted.code).toBe(0);
  put(
    p,
    { type: "node.proposed", id: "src", kind: "source", title: "The paper", why: "it says so", status: "open" },
    edge("card", "src", "supported_by"),
  );
  const out = (await werk(p, "show", "card")).stdout;
  expect(out).toMatch(/-> depends_on\s+base/);
  expect(out).toContain("needs the base");
  expect(out.indexOf("Options:")).toBeGreaterThan(out.indexOf("depends_on"));
  expect(out).toContain("Other way");
  expect(out).toContain("why not: too slow");
  expect(out).toContain("Say:");
  expect(out).toContain("person: exactly this");
  expect(out).toContain("Ev:");
  const ev = out.slice(out.indexOf("Ev:"));
  expect(ev).toContain("The paper");
  expect(ev).toContain("it says so");
  expect(ev).toContain("proposed");
});

test("11.4 no options means no Options section", async () => {
  put(p, real("card", "The card"));
  chat(p, "talk", { speaker: "person", at: "10:02", session: "s1", kind: "spoken", text: "said words" });
  await werk(p, "quote", "card", "talk", "said words");
  put(
    p,
    { type: "node.proposed", id: "src", kind: "source", title: "S", why: "f", status: "open" },
    edge("card", "src", "supported_by"),
  );
  const out = (await werk(p, "show", "card")).stdout;
  expect(out).toContain("Say:");
  expect(out).toContain("Ev:");
  expect(out).not.toContain("Options:");
});

test("11.5 show with no id prints the root card", async () => {
  put(p, decided("root", "Root card"), real("second", "Second", { parent: "root" }));
  const r = await werk(p, "show");
  expect(r.code).toBe(0);
  expect(r.stdout).toContain("Root card");
  expect(r.stdout).toContain("rollup:");
  expect(r.stdout).toMatch(/<- refines\s+second.*rollup: 1 cards/);
});

test("06.1 a new excerpt stages as ghost and waits", async () => {
  put(p, decided("card", "The card"));
  chat(p, "talk", { speaker: "person", at: "10:02", session: "s1", kind: "spoken", text: "we want exactly this" });
  const before = (await werk(p, "show", "card")).stdout;
  const r = await werk(p, "quote", "card", "talk", "exactly this");
  expect(r.code).toBe(0);
  expect(r.stdout).toContain("proposed");
  expect(r.stdout).not.toContain("added");
  const ex = (await werk(p, "show", "card:ex0")).stdout;
  expect(ex).toContain("proposed");
  // map shape over the read API: the link is held
  const card = (await werk(p, "show", "card")).stdout;
  expect(card).toContain("Say:");
  expect(card).toMatch(/exactly this\s+proposed/);
  // card keeps status and words
  const strip = (s: string) => s.split("\n").slice(0, 3).join("\n");
  expect(strip(card)).toBe(strip(before));
  expect(card).toContain("[decided]");
});

test("06.2 an accepted excerpt stops being a ghost and its link goes live", async () => {
  put(p, decided("card", "The card"));
  chat(p, "talk", { speaker: "person", at: "10:02", session: "s1", kind: "spoken", text: "we want exactly this" });
  await werk(p, "quote", "card", "talk", "exactly this");
  const acc = await werk(p, "accept", "card:ex0", "--actor", "you");
  expect(acc.code).toBe(0);
  const ex = (await werk(p, "show", "card:ex0")).stdout;
  expect(ex.split("\n")[0]).not.toContain("proposed");
  const card = (await werk(p, "show", "card")).stdout;
  expect(card).toContain("Say:");
  expect(card).toContain("person: exactly this");
  expect(card).not.toMatch(/exactly this\s+proposed/);
  // the link is live: no held edge in the map
  const events = p.events() as { type: string }[];
  expect(events.filter((e) => e.type === "node.accepted" && (e as any).id === "card:ex0")).toHaveLength(1);
  expect(events.some((e) => e.type === "edge.added" && (e as any).from === "card")).toBe(false);
});
