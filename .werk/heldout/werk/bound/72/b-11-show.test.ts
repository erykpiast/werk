import { expect, test } from "bun:test";
import { decided, type P, project } from "./b-helpers.ts";

const rollupLine = (out: string) => out.split("\n").find((l) => l.startsWith("subtree:")) ?? "";

function excerpt(p: P, card: string, id: string, speaker: string, words: string): void {
  p.seed(
    "excerpt.quoted",
    {
      card,
      id,
      title: words,
      conversation: "design",
      session: "sess-1",
      message: 2,
      start: 0,
      end: words.length,
      speaker,
      said_at: "2026-10-01T10:00:00.000Z",
    },
    "agent",
  );
}

test("11.1 the rollup counts the card and its whole refines subtree", async () => {
  const p = project();
  decided(p, "root", { title: "Root card" });
  p.card("kid-open", { title: "Open child", parent: "root" });
  p.card("kid-proto", { title: "Proto child", parent: "root", status: "proto" });
  decided(p, "grand", { title: "Grandchild", parent: "kid-open" });
  const out = await p.must(["show", "root"]);
  const lines = out.split("\n").filter((l) => l.startsWith("subtree:"));
  expect(lines).toHaveLength(1);
  const line = lines[0] as string;
  expect(line).toContain("4 cards");
  expect(line).toContain("1 open");
  expect(line).toContain("1 proto");
  expect(line).toContain("2 decided");
  const n = (re: RegExp) => Number(re.exec(line)?.[1] ?? Number.NaN);
  expect(n(/(\d+) open/) + n(/(\d+) proto/) + n(/(\d+) decided/)).toBe(n(/(\d+) cards/));
});

test("11.2 each incoming refines link shows the child's own rollup", async () => {
  const p = project();
  decided(p, "parent", { title: "Parent card" });
  p.card("child", { title: "Child card", parent: "parent" });
  p.card("g-open", { title: "Grand open", parent: "child" });
  decided(p, "g-dec", { title: "Grand decided", parent: "child" });
  const out = await p.must(["show", "parent"]);
  const link = out.split("\n").find((l) => l.includes("<- refines") && l.includes("child")) ?? "";
  expect(link).toContain("Child card");
  expect(link).toContain("3 cards");
  expect(link).not.toContain("4 cards");
  expect(rollupLine(out)).toContain("4 cards");
});

test("11.3 a card prints its options, excerpts and a proposed source with their words", async () => {
  const p = project();
  decided(p, "base", { title: "Base card" });
  p.card("subject", { title: "Subject card" });
  p.seed("edge.added", { from: "subject", to: "base", type: "depends_on", why: "it reuses the base log" });
  p.card("subject:opt0", { kind: "option", title: "Use a database", why_not: "too heavy for one file" });
  p.seed("edge.added", { from: "subject:opt0", to: "subject", type: "alternative_to" });
  excerpt(p, "subject", "subject-ex", "user", "keep one log per project");
  const add = await p.werk([
    "add",
    "bench",
    "--kind",
    "source",
    "--title",
    "Bench notes",
    "--finding",
    "writes take 2ms",
  ]);
  expect(add.code).toBe(0);
  await p.must(["link", "subject", "bench", "--type", "supported_by"]);
  const out = await p.must(["show", "subject"]);
  const ls = out.split("\n");
  const dep = ls.findIndex((l) => l.includes("depends_on") && l.includes("base"));
  expect(dep).toBeGreaterThanOrEqual(0);
  expect(out).toContain("it reuses the base log");
  const opts = ls.indexOf("Options");
  expect(opts).toBeGreaterThan(dep);
  const after = (i: number) => ls.slice(i).join("\n");
  expect(after(opts)).toContain("Use a database");
  expect(after(opts)).toContain("too heavy for one file");
  const say = ls.indexOf("Say");
  expect(say).toBeGreaterThan(dep);
  expect(after(say)).toContain("user");
  expect(after(say)).toContain("keep one log per project");
  const ev = ls.indexOf("Ev");
  expect(ev).toBeGreaterThan(dep);
  const evText = after(ev);
  expect(evText).toContain("Bench notes");
  expect(evText).toContain("writes take 2ms");
  const srcLine = ls.slice(ev).find((l) => l.includes("Bench notes")) ?? "";
  expect(srcLine).toContain("proposed");
});

test("11.4 a card with no options prints no Options section", async () => {
  const p = project();
  p.card("subject", { title: "Subject card" });
  excerpt(p, "subject", "subject-ex", "assistant", "one log is enough");
  p.card("src", { kind: "source", title: "A source", finding: "found it" });
  p.seed("edge.added", { from: "subject", to: "src", type: "supported_by" });
  const ls = (await p.must(["show", "subject"])).split("\n");
  expect(ls).toContain("Say");
  expect(ls).toContain("Ev");
  expect(ls).not.toContain("Options");
});

test("11.5 show with no id prints the root card", async () => {
  const p = project();
  p.card("root", { title: "The root card" });
  p.card("second", { title: "Second card", parent: "root" });
  const out = await p.must(["show"]);
  expect(out).toContain("The root card");
  expect(rollupLine(out)).toContain("2 cards");
  const link = out.split("\n").find((l) => l.includes("<- refines") && l.includes("second")) ?? "";
  expect(link).toContain("Second card");
  expect(link).toContain("1 card");
});
