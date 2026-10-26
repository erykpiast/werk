import { expect, test } from "bun:test";
import { useProject } from "../src/test-env/project.ts";
import { decided, edge, real, seed, werk } from "./helpers.ts";

const project = useProject();

/** A link row of the show output with the lines under it that are indented deeper. */
function block(text: string, startsWith: RegExp): string {
  const all = text.split("\n");
  const at = all.findIndex((l) => startsWith.test(l));
  if (at === -1) return "";
  const out = [all[at] as string];
  for (let i = at + 1; i < all.length; i++) {
    const l = all[i] as string;
    if (/^ {4,}\S/.test(l)) out.push(l);
    else break;
  }
  return out.join("\n");
}

test("11.1 the rollup counts the card and its whole refines subtree", async () => {
  const p = project();
  seed(
    p,
    decided("root", { title: "Root card" }),
    decided("kid-open", { title: "Open kid", parent: "root" }),
    real("kid-proto", { title: "Proto kid", parent: "root", status: "proto" }),
    decided("grandkid", { title: "Grandkid", parent: "kid-open" }),
    // A decided card cannot stand under an open one, so the child is reopened last.
    { type: "node.reopened", id: "kid-open", reason: "rejected", at: "2026-10-10T09:00:00.000Z" },
  );
  const r = await werk(p, "show", "root");
  expect(r.code).toBe(0);
  const rollup = r.stdout.split("\n").filter((l) => /\b4 cards\b/.test(l));
  expect(rollup.length).toBe(1);
  expect(rollup[0]).toMatch(/\b1 open\b/);
  expect(rollup[0]).toMatch(/\b1 proto\b/);
  expect(rollup[0]).toMatch(/\b2 decided\b/);
});

test("11.2 each incoming refines link shows the child's own rollup", async () => {
  const p = project();
  seed(
    p,
    decided("parent", { title: "Parent card" }),
    decided("child", { title: "Child card", parent: "parent" }),
    real("g-open", { title: "Open grandchild", parent: "child" }),
    decided("g-decided", { title: "Decided grandchild", parent: "child" }),
    // A decided card cannot stand under an open one, so the child is reopened last.
    { type: "node.reopened", id: "child", reason: "rejected", at: "2026-10-10T09:00:00.000Z" },
  );
  const r = await werk(p, "show", "parent");
  expect(r.code).toBe(0);
  const link = block(r.stdout, /^\s*<- refines\s+child\b/);
  expect(link).not.toBe("");
  expect(link).toMatch(/\b3 cards\b/);
  expect(link).not.toMatch(/\b4 cards\b/);
  const own = r.stdout
    .split("\n")
    .filter((l) => !/^\s*<-/.test(l) && /\b4 cards\b/.test(l));
  expect(own.length).toBe(1);
});

test("11.3 a card prints its options, excerpts and a proposed source with their words", async () => {
  const p = project();
  seed(
    p,
    real("other", { title: "Other card" }),
    real("main", { title: "Main card" }),
    edge("main", "other", "depends_on", "main needs the other card to hold"),
    real("main:opt0", {
      kind: "option",
      title: "Build it ourselves",
      why: "too slow to ship",
    }),
    edge("main:opt0", "main", "alternative_to", "the other way"),
    real("quote", {
      kind: "excerpt",
      title: "Maria",
      body: "We never promise a date to a customer.",
    }),
    edge("main", "quote", "supported_by", "she said it"),
    ghost0("src", "Pricing study", "Seat pricing wins in every segment."),
    edge("main", "src", "supported_by", "the study backs it"),
  );
  const r = await werk(p, "show", "main");
  expect(r.code).toBe(0);
  const out = r.stdout;
  const dep = out.indexOf("main needs the other card to hold");
  expect(dep).toBeGreaterThan(-1);
  const options = out.search(/^\s*Options\b/m);
  expect(options).toBeGreaterThan(dep);
  const optText = out.slice(options);
  expect(optText).toContain("Build it ourselves");
  expect(optText).toContain("too slow to ship");
  const say = out.search(/^\s*Say\b/m);
  expect(say).toBeGreaterThan(-1);
  expect(out.slice(say)).toContain("Maria");
  expect(out.slice(say)).toContain("We never promise a date to a customer.");
  const ev = out.search(/^\s*Ev\b/m);
  expect(ev).toBeGreaterThan(-1);
  const evText = out.slice(ev);
  expect(evText).toContain("Pricing study");
  expect(evText).toContain("Seat pricing wins in every segment.");
  expect(evText).toMatch(/proposed/);
});

test("11.4 a card with no options prints no Options section", async () => {
  const p = project();
  seed(
    p,
    real("main", { title: "Main card" }),
    real("quote", { kind: "excerpt", title: "Maria", body: "Said so." }),
    edge("main", "quote", "supported_by", "she said it"),
    real("src", { kind: "source", title: "A study", body: "It holds." }),
    edge("main", "src", "supported_by", "the study backs it"),
  );
  const r = await werk(p, "show", "main");
  expect(r.code).toBe(0);
  expect(r.stdout).toMatch(/^\s*Say\b/m);
  expect(r.stdout).toMatch(/^\s*Ev\b/m);
  expect(r.stdout).not.toMatch(/^\s*Options\b/m);
});

test("11.5 show with no id prints the root card", async () => {
  const p = project();
  seed(
    p,
    real("the-root", { title: "The root title" }),
    real("second", { title: "Second card", parent: "the-root" }),
  );
  const r = await werk(p, "show");
  expect(r.code).toBe(0);
  expect(r.stdout).toContain("The root title");
  expect(r.stdout).toMatch(/\b2 cards\b/);
  const link = block(r.stdout, /^\s*<- refines\s+second\b/);
  expect(link).not.toBe("");
  expect(link).toMatch(/\b1 cards?\b/);
});

function ghost0(id: string, title: string, body: string) {
  return {
    type: "node.proposed",
    id,
    kind: "source",
    title,
    body,
    status: "open",
  };
}
