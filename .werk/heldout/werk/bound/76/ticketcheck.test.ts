import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { card, seed, w, withRoot, type Project } from "./h.ts";

const spec = (n: number) =>
  `# Spec\n\n## User stories\n\n${Array.from({ length: n }, (_, i) => `${i + 1}. As a person, I want story ${i + 1}.`).join("\n")}\n\n## Seams\n\nNone.\n`;

const ticket = (title: string | undefined, cites: string, blocked: string, stories: string, checks = "- `make test`", extra = "") =>
  `${title === undefined ? "" : `title: ${title}\n`}cites: ${cites}\nblocked_by: ${blocked}\nstories: ${stories}\ntouches: map view\n\n## What to build\n\nA person opens a card and presses reopen.${extra}\n\n## Acceptance criteria\n\n- [ ] The card shows as open.\n\n## Checks\n\n${checks}\n`;

function setup(opts: { decided?: string[]; ghost?: boolean; stories?: number; tickets: Record<string, string> }): Project {
  const p = withRoot();
  seed(p, [card("top", "Top", { status: "decided", parent: "root" })]);
  for (const id of opts.decided ?? []) seed(p, [card(id, id.toUpperCase(), { status: "decided", parent: "top" })]);
  if (opts.ghost) seed(p, [{ type: "node.proposed", payload: { id: "ghosty", kind: "card", title: "Ghost", parent: "top", status: "decided" } }]);
  writeFileSync(join(p.dir, "spec.md"), spec(opts.stories ?? 2));
  mkdirSync(join(p.dir, "tickets"), { recursive: true });
  for (const [n, t] of Object.entries(opts.tickets)) writeFileSync(join(p.dir, "tickets", n), t);
  return p;
}
const check = (p: Project, ...extra: string[]) => p.werk(["ticket-check", "tickets", "--root", "top", "--spec", "spec.md", ...extra]);

test("26.1 valid tickets pass", async () => {
  const p = setup({
    decided: ["one", "two"],
    tickets: {
      "01-a.md": ticket("First", "top, one", "", "1", "- `make test`"),
      "02-b.md": ticket("Second", "#two", "1", "2", ""),
    },
  });
  const r = await check(p);
  expect(r.code).toBe(0);
  const ls = r.out.split("\n").filter(Boolean);
  expect(ls.length).toBe(1);
  expect(ls[0]).toMatch(/0 failures/);
});

test("26.2 file path and oversized ticket", async () => {
  const good = {
    "01-a.md": ticket("First", "top, one", "", "1"),
    "02-b.md": ticket("Second", "two", "1", "2"),
  };
  const p = setup({ decided: ["one", "two"], tickets: good });
  expect((await check(p)).code).toBe(0);
  const lines = good["01-a.md"].split("\n");
  const idx = lines.findIndex((l) => l.startsWith("A person"));
  expect(idx + 1).toBe(9); // line 9 of the file is the What to build text
  lines[idx] = "Edit src/loop.ts and the Makefile so the reopen runs.";
  writeFileSync(join(p.dir, "tickets", "01-a.md"), lines.join("\n"));
  writeFileSync(join(p.dir, "tickets", "02-b.md"), ticket("Second", "two", "1", "2", "- `make test`", ` ${"pad ".repeat(1100)}`));
  const r = await check(p);
  const out = r.out.split("\n");
  expect(out.some((l) => l.startsWith("01-a.md: no-file-paths") && l.includes("src/loop.ts") && l.includes("line 9"))).toBe(true);
  expect(out.some((l) => l.includes("Makefile") && l.includes("failure") === false && l.startsWith("01-a.md"))).toBe(false);
  expect(out.filter((l) => l.includes("Makefile"))).toEqual([]);
  expect(out.some((l) => l.startsWith("02-b.md: size"))).toBe(true);
  expect(out.at(-2)).toMatch(/failures/);
  expect(r.code).toBe(1);
});

test("26.3 set checks: uncited card, missing story, cycle; not the ghost", async () => {
  const p = setup({
    decided: ["one", "two"],
    ghost: true,
    stories: 3,
    tickets: {
      "01-a.md": ticket("First", "top, one", "", "1"),
      "02-b.md": ticket("Second", "top, one", "3", "2"),
      "03-c.md": ticket("Third", "top, one", "2", "2"),
    },
  });
  const r = await check(p);
  const out = r.out.split("\n");
  expect(out.filter((l) => l.startsWith("ticket set: cards-cited") && l.includes("#two")).length).toBe(1);
  expect(out.filter((l) => l.startsWith("ticket set: stories") && l.includes("story 3")).length).toBe(1);
  expect(out.some((l) => l.includes("blocked_by") && l.includes("02-b.md") && l.includes("03-c.md"))).toBe(true);
  expect(r.out).not.toContain("ghosty");
  expect(r.code).toBe(1);
});

test("26.4 a ticket with no title fails alone; its cites do not count for the set", async () => {
  const p = setup({ decided: ["one"], stories: 1, tickets: { "01-a.md": ticket(undefined, "top, one", "", "1") } });
  const r = await check(p);
  const out = r.out.split("\n");
  expect(out.some((l) => l.startsWith("01-a.md:") && l.includes("title"))).toBe(true);
  const own = out.filter((l) => l.startsWith("01-a.md:"));
  expect(own.length).toBe(1);
  expect(out.some((l) => l.startsWith("ticket set:") && l.includes("cards-cited") && l.includes("#one"))).toBe(true);
  expect(out.some((l) => l.startsWith("ticket set:") && l.includes("stories") && l.includes("story 1"))).toBe(true);
  expect(r.code).toBe(1);
});

test("26.5 malformed calls exit 2", async () => {
  const p = setup({ decided: ["one"], stories: 1, tickets: { "01-a.md": ticket("T", "top, one", "", "1") } });
  const a = await p.werk(["ticket-check", "tickets", "--root", "top", "--spec", "missing.md"]);
  expect(a.code).toBe(2);
  expect(a.err).toMatch(/spec/);
  writeFileSync(join(p.dir, "nospec.md"), "# Spec\n\n1. A line.\n");
  expect((await p.werk(["ticket-check", "tickets", "--root", "top", "--spec", "nospec.md"])).code).toBe(2);
  expect((await p.werk(["ticket-check", "tickets", "--root", "nope", "--spec", "spec.md"])).code).toBe(2);
  expect((await p.werk(["ticket-check", "tickets", "--spec", "spec.md"])).code).toBe(2);
  void w;
});
