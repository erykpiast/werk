// Held-out steps 11.x: werk show with rollups, links and proof sections.
import { expect, test } from "bun:test";
import { card, chat, project } from "./helpers.ts";

const rollupLine = (out: string) => out.split("\n").find((line) => line.startsWith("subtree:")) as string;

function counts(line: string): Record<string, number> {
  const found: Record<string, number> = {};
  for (const [, n, word] of line.matchAll(/(\d+) (cards?|open|proto|decided)/g)) found[word as string] = Number(n);
  return found;
}

test("11.1 the rollup counts the card and its whole refines subtree", async () => {
  const p = project();
  p.seed(
    card("root", "Root", { status: "decided" }),
    card("child-open", "Open child", { parent: "root" }),
    card("child-proto", "Proto child", { parent: "root", status: "proto" }),
    card("grandchild", "Grandchild", { parent: "child-open", status: "decided" }),
  );
  const out = await p.ok("show", "root");
  const lines = out.split("\n").filter((line) => line.startsWith("subtree:"));
  expect(lines).toHaveLength(1);
  const c = counts(lines[0] as string);
  expect(c.cards).toBe(4);
  expect(c).toMatchObject({ open: 1, proto: 1, decided: 2 });
  expect((c.open ?? 0) + (c.proto ?? 0) + (c.decided ?? 0)).toBe(c.cards as number);
});

test("11.2 each incoming refines link shows the child's own rollup", async () => {
  const p = project();
  p.seed(
    card("parent", "Parent"),
    card("child", "Child", { parent: "parent" }),
    card("g-open", "Grandchild open", { parent: "child" }),
    card("g-decided", "Grandchild decided", { parent: "child", status: "decided" }),
  );
  const out = await p.ok("show", "parent");
  const link = out.split("\n").find((line) => /<- refines\s+child\s/.test(line)) as string;
  expect(link).toBeDefined();
  expect(link).toMatch(/\(3 cards\b/);
  expect(counts(rollupLine(out)).cards).toBe(4);
});

test("11.3 a card prints its options, excerpts and a proposed source with their words", async () => {
  const p = project();
  p.seed(
    card("root", "Root"),
    card("basis", "Basis card", { parent: "root" }),
    card("subject", "Subject card", { parent: "root" }),
  );
  await p.ok("link", "subject", "basis", "--type", "depends_on", "--why", "the subject reads the basis format");
  p.seed(
    {
      type: "node.added",
      payload: { id: "subject:opt0", kind: "option", title: "Use XML", why_not: "XML is verbose" },
    },
    { type: "edge.added", payload: { from: "subject:opt0", to: "subject", type: "alternative_to" } },
  );
  chat(p, "talk", [{ kind: "spoken", speaker: "person", text: "keep the log append only" }]);
  await p.ok("quote", "subject", "talk", "keep the log append only");
  await p.ok(
    "add",
    "src-paper",
    "--kind",
    "source",
    "--title",
    "Event sourcing paper",
    "--finding",
    "Logs replay well",
  );
  await p.ok("link", "subject", "src-paper", "--type", "supported_by");

  const out = await p.ok("show", "subject");
  const lines = out.split("\n");
  const dep = lines.findIndex((line) => /-> depends_on\s+basis/.test(line));
  expect(dep).toBeGreaterThan(-1);
  expect(lines[dep + 1]).toContain("the subject reads the basis format");
  const lastLink = Math.max(...lines.map((line, i) => (/^\s+(->|<-) /.test(line) ? i : -1)));
  const options = lines.indexOf("Options");
  expect(options).toBeGreaterThan(lastLink);
  const optionText = lines.slice(options).join("\n");
  expect(optionText).toContain("Use XML");
  expect(optionText).toContain("XML is verbose");
  const say = lines.indexOf("Say");
  expect(say).toBeGreaterThan(-1);
  expect(lines[say + 1]).toContain("person");
  expect(lines[say + 1]).toContain("keep the log append only");
  const ev = lines.indexOf("Ev");
  expect(ev).toBeGreaterThan(-1);
  const evText = lines.slice(ev).join("\n");
  expect(evText).toContain("Event sourcing paper");
  expect(evText).toContain("Logs replay well");
  expect(lines[ev + 1]).toContain("proposed");
});

test("11.4 a card with no options prints no Options section", async () => {
  const p = project();
  p.seed(card("root", "Root"), card("subject", "Subject card", { parent: "root" }));
  chat(p, "talk", [{ kind: "spoken", speaker: "agent", text: "one source is enough" }]);
  await p.ok("quote", "subject", "talk", "one source is enough");
  await p.ok("add", "src-a", "--kind", "source", "--title", "A source", "--finding", "It holds");
  await p.ok("link", "subject", "src-a", "--type", "supported_by");
  const lines = (await p.ok("show", "subject")).split("\n");
  expect(lines).toContain("Say");
  expect(lines).toContain("Ev");
  expect(lines).not.toContain("Options");
});

test("11.5 show with no id prints the root card", async () => {
  const p = project();
  p.seed(card("root", "The root card"), card("second", "Second card", { parent: "root" }));
  const run = await p.werk(["show"]);
  expect(run.code).toBe(0);
  expect(run.out).toContain("The root card");
  expect(run.out).toMatch(/^subtree: 2 cards/m);
  expect(run.out).toMatch(/<- refines\s+second\s+Second card\s+\(1 card/);
});

