import { appendFileSync } from "node:fs";
import { expect, setDefaultTimeout, test } from "bun:test";
import { createProject, decide, makeWerk, real } from "./support.ts";

setDefaultTimeout(120000);

async function withW<T>(body: (w: ReturnType<typeof makeWerk>, p: ReturnType<typeof createProject>) => Promise<T>) {
  const p = createProject();
  try {
    return await body(makeWerk(p), p);
  } finally {
    await p.dispose();
  }
}

test("11.1 rollup counts the card and its refines subtree", () =>
  withW(async (w) => {
    await real(w, "root", "Root");
    await decide(w, "root");
    await real(w, "c1", "Child one", { parent: "root" });
    await real(w, "c2", "Child two", { parent: "root", status: "proto" });
    await decide(w, "c1");
    await real(w, "g1", "Grandchild", { parent: "c1" });
    await decide(w, "g1");
    expect((await w("reopen", "c1", "--reason", "invalidated", "--why", "x")).code).toBe(0);
    const r = await w("show", "root");
    expect(r.code).toBe(0);
    const rollupLines = r.stdout.split("\n").filter((l) => /\b4 cards\b/.test(l));
    expect(rollupLines.length).toBe(1);
    expect(rollupLines[0]).toMatch(/1 open/);
    expect(rollupLines[0]).toMatch(/1 proto/);
    expect(rollupLines[0]).toMatch(/2 decided/);
  }));

test("11.2 each incoming refines link shows the child's own rollup", () =>
  withW(async (w) => {
    await real(w, "parent", "Parent");
    await decide(w, "parent");
    await real(w, "child", "Child", { parent: "parent" });
    await decide(w, "child");
    await real(w, "g1", "Grand one", { parent: "child" });
    await real(w, "g2", "Grand two", { parent: "child" });
    await decide(w, "g2");
    expect((await w("reopen", "child", "--reason", "invalidated", "--why", "x")).code).toBe(0);
    const r = await w("show", "parent");
    expect(r.code).toBe(0);
    const lines = r.stdout.split("\n");
    const link = lines.findIndex((l) => /<-\s+refines\s+child/.test(l));
    expect(link).toBeGreaterThan(-1);
    expect(`${lines[link]}\n${lines[link + 1] ?? ""}`).toMatch(/\b3 cards\b/);
    expect(r.stdout).toMatch(/\b4 cards\b/);
  }));

test("11.3 a card prints options, excerpts and a proposed source with their words", () =>
  withW(async (w, p) => {
    await real(w, "dep", "Dependency");
    await real(w, "card", "The card");
    expect((await w("link", "card", "dep", "--type", "depends_on", "--why", "it needs the dep")).code).toBe(0);
    expect((await w("add", "card:opt0", "--kind", "option", "--title", "Option title", "--why", "Option why-not words")).code).toBe(0);
    expect((await w("link", "card:opt0", "card", "--type", "alternative_to")).code).toBe(0);
    expect((await w("accept", "card:opt0", "--actor", "you")).code).toBe(0);
    appendFileSync(p.logPath, `${JSON.stringify({ type: "node.proposed", id: "ex1", kind: "excerpt", title: "Ana", speaker: "Ana", body: "We keep it exactly like this", status: "open" })}\n`);
    appendFileSync(p.logPath, `${JSON.stringify({ type: "node.accepted", id: "ex1", actor: "you" })}\n`);
    expect((await w("link", "card", "ex1", "--type", "supported_by", "--why", "said so")).code).toBe(0);
    expect((await w("add", "src1", "--kind", "source", "--title", "Source title", "--why", "Source finding words")).code).toBe(0);
    expect((await w("link", "card", "src1", "--type", "supported_by", "--why", "w")).code).toBe(0);
    const r = await w("show", "card");
    expect(r.code).toBe(0);
    const out = r.stdout;
    expect(out).toContain("it needs the dep");
    expect(out).toMatch(/^Options/m);
    expect(out).toContain("Option title");
    expect(out).toContain("Option why-not words");
    expect(out).toMatch(/^Say/m);
    expect(out).toContain("Ana");
    expect(out).toContain("We keep it exactly like this");
    expect(out).toMatch(/^Ev/m);
    expect(out).toContain("Source title");
    expect(out).toContain("Source finding words");
    expect(out).toMatch(/Source title[\s\S]*proposed/);
    expect(out.indexOf("Options")).toBeGreaterThan(out.indexOf("depends_on"));
  }));

test("11.4 a card with no options prints no Options section", () =>
  withW(async (w, p) => {
    await real(w, "card", "The card");
    appendFileSync(p.logPath, `${JSON.stringify({ type: "node.proposed", id: "ex1", kind: "excerpt", title: "Ana", speaker: "Ana", body: "Words", status: "open" })}\n`);
    appendFileSync(p.logPath, `${JSON.stringify({ type: "node.accepted", id: "ex1", actor: "you" })}\n`);
    expect((await w("link", "card", "ex1", "--type", "supported_by", "--why", "w")).code).toBe(0);
    expect((await w("add", "src1", "--kind", "source", "--title", "Src", "--why", "Finding")).code).toBe(0);
    expect((await w("accept", "src1", "--actor", "you")).code).toBe(0);
    expect((await w("link", "card", "src1", "--type", "supported_by", "--why", "w")).code).toBe(0);
    const r = await w("show", "card");
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/^Say/m);
    expect(r.stdout).toMatch(/^Ev/m);
    expect(r.stdout).not.toMatch(/^Options/m);
  }));

test("11.5 show with no id prints the root card", () =>
  withW(async (w) => {
    await real(w, "root", "The root title");
    await real(w, "second", "Second card", { parent: "root" });
    const r = await w("show");
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("The root title");
    expect(r.stdout).toMatch(/\b2 cards\b/);
    expect(r.stdout).toMatch(/<-\s+refines\s+second/);
  }));
