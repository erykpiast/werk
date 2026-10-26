import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mk } from "./lib.ts";

const SPEC = (n: number) =>
  `# Spec\n\n## User stories\n\n${Array.from({ length: n }, (_, i) => `${i + 1}. As a person, I want thing ${i + 1}.`).join("\n")}\n\n## Seams\n\nNone.\n`;

const ticket = (o: { title?: string | null; cites: string; blocked?: string; stories: string; checks?: string[]; extra?: string }) =>
  [
    ...(o.title === null ? [] : [`title: ${o.title ?? "A ticket"}`]),
    `cites: ${o.cites}`,
    `blocked_by: ${o.blocked ?? ""}`,
    `stories: ${o.stories}`,
    "touches: map view",
    "",
    "## What to build",
    "",
    `A person opens a card and sees the result.${o.extra ?? ""}`,
    "",
    "## Acceptance criteria",
    "",
    "- [ ] The card shows the result.",
    "",
    "## Checks",
    "",
    ...(o.checks ?? []).map((c) => `- \`${c}\``),
    "",
  ].join("\n");

function setup(opts: { ghost?: boolean; cards?: string[]; stories?: number } = {}) {
  const h = mk();
  h.card("top");
  for (const id of opts.cards ?? ["a", "b"]) h.card(id, { status: "decided", parent: "top" });
  if (opts.ghost) h.seed("node.proposed", { id: "g", kind: "card", title: "Ghost", parent: "top" }, "agent");
  if (opts.ghost) h.seed("node.decided", { id: "g" });
  writeFileSync(join(h.dir, "spec.md"), SPEC(opts.stories ?? 2));
  mkdirSync(join(h.dir, "tickets"));
  const put = (name: string, text: string) => writeFileSync(join(h.dir, "tickets", name), text);
  const run = (...x: string[]) => h.w("ticket-check", "tickets", "--root", "top", "--spec", "spec.md", ...x);
  return { h, put, run };
}

test("26.1 valid tickets pass cleanly", async () => {
  const { put, run } = setup();
  put("01-first.md", ticket({ cites: "top, a", stories: "1", checks: ["make test"] }));
  put("02-second.md", ticket({ cites: "#b", stories: "2", blocked: "1" }));
  const r = await run();
  console.log(r.out, r.err);
  expect(r.code).toBe(0);
  const lines = r.out.trim().split("\n");
  expect(lines.length).toBe(1);
  expect(lines[0]).toMatch(/0 failures/);
  expect(r.out).not.toMatch(/fail:|FAIL/);
});

test("26.2 file path and oversize ticket named", async () => {
  const { put, run } = setup();
  put("01-first.md", ticket({ cites: "top, a", stories: "1", checks: ["make test"], extra: " It edits src/loop.ts and Makefile." }));
  put("02-second.md", ticket({ cites: "#b", stories: "2", blocked: "1", extra: ` ${"padding ".repeat(600)}` }));
  const r = await run();
  console.log(r.out, r.err);
  expect(r.code).toBe(1);
  const l1 = r.out.split("\n").find((l) => l.startsWith("01-first.md"));
  expect(l1).toBeDefined();
  expect(l1).toMatch(/file.?path/i);
  expect(l1).toContain("src/loop.ts");
  expect(l1).toMatch(/9/);
  expect(r.out).not.toContain("Makefile");
  const l2 = r.out.split("\n").find((l) => l.startsWith("02-second.md"));
  expect(l2).toBeDefined();
  expect(l2).toMatch(/size/i);
  expect(r.out.split("\n").at(-2)).toMatch(/[1-9]\d* (own-check )?failures?|[1-9]/);
});

test("26.3 set checks: uncited card, missing story, cycle, not ghost", async () => {
  const { put, run } = setup({ ghost: true, stories: 3 });
  put("01-one.md", ticket({ cites: "top, a", stories: "1" }));
  put("02-two.md", ticket({ cites: "top", stories: "2", blocked: "3" }));
  put("03-three.md", ticket({ cites: "a", stories: "2", blocked: "2" }));
  const r = await run();
  console.log(r.out, r.err);
  expect(r.code).toBe(1);
  const sets = r.out.split("\n").filter((l) => l.startsWith("ticket set"));
  const cited = sets.filter((l) => /cite/i.test(l) && /\bb\b/.test(l));
  expect(cited.length).toBe(1);
  const story = sets.filter((l) => /stor/i.test(l) && /3/.test(l));
  expect(story.length).toBeGreaterThanOrEqual(1);
  expect(r.out).toMatch(/blocked_by[\s\S]*02[\s\S]*03|blocked_by[\s\S]*03[\s\S]*02/);
  expect(r.out).not.toMatch(/\bg\b/);
});

test("26.4 ticket without title fails alone", async () => {
  const h = mk();
  h.card("top");
  h.card("a", { status: "decided", parent: "top" });
  writeFileSync(join(h.dir, "spec.md"), SPEC(1));
  mkdirSync(join(h.dir, "tickets"));
  writeFileSync(join(h.dir, "tickets", "01-x.md"), ticket({ title: null, cites: "a", stories: "1" }));
  const r = await h.w("ticket-check", "tickets", "--root", "top", "--spec", "spec.md");
  console.log(r.out, r.err);
  expect(r.code).toBe(1);
  const own = r.out.split("\n").filter((l) => l.startsWith("01-x.md"));
  expect(own.length).toBe(1);
  expect(own[0]).toMatch(/title/i);
  expect(own[0]).not.toMatch(/shape|size/i);
  const sets = r.out.split("\n").filter((l) => l.startsWith("ticket set"));
  expect(sets.some((l) => /\ba\b/.test(l))).toBe(true);
  expect(sets.some((l) => /stor/i.test(l) && /1/.test(l))).toBe(true);
});

test("26.5 malformed calls exit 2", async () => {
  const { h, put } = setup();
  put("01-first.md", ticket({ cites: "top, a", stories: "1" }));
  const base = ["ticket-check", "tickets"];
  const a = await h.w(...base, "--root", "top", "--spec", "nope.md");
  expect(a.code).toBe(2);
  expect(a.err + a.out).toMatch(/spec/i);
  expect(a.err + a.out).toMatch(/no spec file|missing|not exist/i);
  writeFileSync(join(h.dir, "nohead.md"), "# Spec\n\nnothing\n");
  expect((await h.w(...base, "--root", "top", "--spec", "nohead.md")).code).toBe(2);
  expect((await h.w(...base, "--root", "ghostly", "--spec", "spec.md")).code).toBe(2);
  expect((await h.w(...base, "--spec", "spec.md")).code).toBe(2);
});
