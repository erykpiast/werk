// Scenarios 11.x: show prints rollups, links, options, excerpts and sources.
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { card, decided, link, ok, withMap } from "./helpers.ts";

function rollupNumbers(line: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [, n, word] of line.matchAll(/(\d+) (cards?|open|proto|decided)/g)) out[(word as string).replace(/s$/, "")] = Number(n);
  return out;
}

test("11.1 the rollup counts the card and its whole refines subtree", async () => {
  const p = withMap([
    card("root", "Root"),
    card("child-open", "Child open", "root"),
    card("child-proto", "Child proto", "root", { status: "proto" }),
    card("grandchild", "Grandchild", "child-open"),
    decided("grandchild"),
    decided("root"),
  ]);
  const out = (await ok(p, ["show", "root"])).out;
  const rollups = out.split("\n").filter((l) => l.startsWith("subtree:"));
  expect(rollups).toHaveLength(1);
  const n = rollupNumbers(rollups[0] as string);
  expect(n.card).toBe(4);
  expect(n.open).toBe(1);
  expect(n.proto).toBe(1);
  expect(n.decided).toBe(2);
  expect((n.open ?? 0) + (n.proto ?? 0) + (n.decided ?? 0)).toBe(n.card as number);
});

test("11.2 each incoming refines link shows the child's own rollup", async () => {
  const p = withMap([
    card("parent", "Parent"),
    card("child", "Child", "parent"),
    card("gc-open", "Grandchild open", "child"),
    card("gc-decided", "Grandchild decided", "child"),
    decided("gc-decided"),
  ]);
  const out = (await ok(p, ["show", "parent"])).out;
  const line = out.split("\n").find((l) => /<- refines\s+child\s/.test(l));
  expect(line).toBeDefined();
  expect(rollupNumbers(line as string).card).toBe(3);
  const own = out.split("\n").find((l) => l.startsWith("subtree:"));
  expect(rollupNumbers(own as string).card).toBe(4);
});

function cardWithEvidence(withOption: boolean) {
  const p = withMap([
    card("root", "Root"),
    card("basis", "Basis card", "root"),
    card("subject", "Subject card", "root"),
    link("subject", "basis", "depends_on", "Subject reuses the basis format"),
    ...(withOption
      ? ([
          ["node.added", { id: "subject:opt0", kind: "option", title: "A second format", why_not: "Two formats drift apart" }],
          link("subject:opt0", "subject", "alternative_to"),
        ] as const)
      : []),
  ] as never);
  mkdirSync(join(p.dir, ".werk", "chats"));
  writeFileSync(
    join(p.dir, ".werk", "chats", "talk.jsonl"),
    `${JSON.stringify({ speaker: "person", at: "2026-01-02T10:00:00Z", session: "s-1", kind: "spoken", text: "keep one format for every file" })}\n`,
  );
  return p;
}

test("11.3 a card prints its options, excerpts and a proposed source with their words", async () => {
  const p = cardWithEvidence(true);
  await ok(p, ["quote", "subject", "talk", "keep one format for every file"]);
  await ok(p, ["add", "src-bench", "--kind", "source", "--title", "Format benchmark", "--url", "https://example.com/b", "--finding", "One format halves the bugs"]);
  await ok(p, ["link", "subject", "src-bench", "--type", "supported_by"]);
  const out = (await ok(p, ["show", "subject"])).out;
  const rows = out.split("\n");
  const dep = rows.findIndex((l) => /-> depends_on\s+basis/.test(l));
  expect(dep).toBeGreaterThan(-1);
  expect(out).toContain("why: Subject reuses the basis format");
  const lastLink = rows.reduce((last, l, i) => (/^\s+(->|<-) /.test(l) ? i : last), -1);
  const options = rows.indexOf("Options");
  const say = rows.indexOf("Say");
  const ev = rows.indexOf("Ev");
  expect(options).toBeGreaterThan(lastLink);
  const optBlock = rows.slice(options, say).join("\n");
  expect(optBlock).toContain("A second format");
  expect(optBlock).toContain("Two formats drift apart");
  expect(say).toBeGreaterThan(-1);
  const sayBlock = rows.slice(say, ev).join("\n");
  expect(sayBlock).toContain("person");
  expect(sayBlock).toContain('"keep one format for every file"');
  expect(ev).toBeGreaterThan(-1);
  const evBlock = rows.slice(ev).join("\n");
  expect(evBlock).toContain("Format benchmark");
  expect(evBlock).toContain("One format halves the bugs");
  expect(evBlock).toContain("proposed");
});

test("11.4 a card with no options prints no Options section", async () => {
  const p = cardWithEvidence(false);
  await ok(p, ["quote", "subject", "talk", "keep one format for every file"]);
  await ok(p, ["add", "src-bench", "--kind", "source", "--title", "Format benchmark", "--url", "https://example.com/b", "--finding", "One format halves the bugs"]);
  await ok(p, ["link", "subject", "src-bench", "--type", "supported_by"]);
  const rows = (await ok(p, ["show", "subject"])).out.split("\n");
  expect(rows).toContain("Say");
  expect(rows).toContain("Ev");
  expect(rows).not.toContain("Options");
});

test("11.5 show with no id prints the root card", async () => {
  const p = withMap([card("root", "The root card"), card("second", "Second card", "root")]);
  const run = await p.werk(["show"]);
  expect(run.code).toBe(0);
  expect(run.out).toContain("The root card");
  expect(run.out).toMatch(/^subtree: 2 cards/m);
  expect(run.out).toMatch(/<- refines\s+second\s+Second card\s+\(1 card/);
});
