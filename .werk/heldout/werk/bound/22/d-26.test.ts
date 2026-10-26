import { afterEach, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupAll, type P, project } from "./cli.ts";
afterEach(cleanupAll);

const spec = (stories: number[]) =>
  `# Spec: checkout\n\n## User stories\n\n${stories.map((n) => `${n}. As a person, I want story ${n}.`).join("\n")}\n\n## Seams\n\nThe command line.\n`;

const ticket = (o: { title?: string; cites: string; blocked?: string; stories: string; build?: string; checks?: string }) =>
  `${o.title === undefined ? "" : `title: ${o.title}\n`}cites: ${o.cites}
blocked_by: ${o.blocked ?? ""}
stories: ${o.stories}
touches: checkout page

## What to build

${o.build ?? "A person pays and sees a receipt."}

## Acceptance criteria

- [ ] The receipt shows after payment.

## Checks

${o.checks ?? ""}
`;

function setup(cards: { decided: string[]; ghosts?: string[] }, stories: number[]): P {
  const p = project();
  p.card("root", "Root");
  p.card("checkout", "Checkout", { parent: "root" });
  for (const id of cards.decided) p.card(id, `Card ${id}`, { parent: "checkout" });
  for (const id of cards.ghosts ?? []) p.seed("node.proposed", { id, kind: "card", title: `Ghost ${id}`, parent: "checkout" }, "agent");
  for (const id of ["checkout", ...cards.decided]) p.seed("node.decided", { id });
  writeFileSync(join(p.dir, "spec.md"), spec(stories));
  mkdirSync(join(p.dir, "tickets"));
  return p;
}
const put = (p: P, files: Record<string, string>) => {
  for (const [n, t] of Object.entries(files)) writeFileSync(join(p.dir, "tickets", n), t);
};
const check = (p: P, ...args: string[]) => p.werk("ticket-check", "tickets", ...args);
const failureLines = (out: string) => out.split("\n").filter(Boolean).slice(0, -1);

test("26.1 valid hand-written tickets pass clean", () => {
  const p = setup({ decided: ["pay", "receipt"] }, [1, 2]);
  put(p, {
    "01-pay.md": ticket({ title: "A person can pay", cites: "checkout, pay", stories: "1", checks: "- `make test`" }),
    "02-receipt.md": ticket({ title: "A receipt shows", cites: "#receipt", blocked: "1", stories: "2" }),
  });
  const r = check(p, "--root", "checkout", "--spec", "spec.md");
  console.log(r.all);
  expect(failureLines(r.out)).toEqual([]);
  const last = r.out.trim().split("\n").at(-1) ?? "";
  expect(last).toMatch(/\b0 failures\b/);
  expect(r.code).toBe(0);
});

test("26.2 a file path and an oversized ticket are named with ticket and place", () => {
  const p = setup({ decided: ["pay", "receipt"] }, [1, 2]);
  const t1 = ticket({ title: "A person can pay", cites: "checkout, pay", stories: "1", checks: "- `make test`" });
  const t2 = ticket({ title: "A receipt shows", cites: "receipt", blocked: "1", stories: "2" });
  put(p, { "01-pay.md": t1, "02-receipt.md": t2 });
  expect(check(p, "--root", "checkout", "--spec", "spec.md").code).toBe(0);
  const lines = t1.split("\n");
  // file line 9 is the first text line of the What to build section
  expect(lines[6]).toBe("## What to build");
  lines[8] = "Change src/loop.ts so the payment retries, and the Makefile target too.";
  const t2big = t2.replace("sees a receipt.", `sees a receipt. ${"padding ".repeat(600)}`);
  expect(t2big.length).toBeGreaterThan(4000);
  put(p, { "01-pay.md": lines.join("\n"), "02-receipt.md": t2big });
  const r = check(p, "--root", "checkout", "--spec", "spec.md");
  console.log(r.all);
  const fails = failureLines(r.out);
  const pathLine = fails.find((l) => l.startsWith("01-pay.md") && l.includes("no-file-paths"));
  expect(pathLine).toBeDefined();
  expect(pathLine).toContain("src/loop.ts");
  expect(pathLine).toMatch(/line 9\b/);
  expect(fails.filter((l) => l.includes("Makefile"))).toEqual([]);
  expect(fails.find((l) => l.startsWith("02-receipt.md") && l.includes("size"))).toBeDefined();
  const last = r.out.trim().split("\n").at(-1) ?? "";
  expect(last).toMatch(/[1-9]\d* failures?/);
  expect(r.code).toBe(1);
});

test("26.3 set checks report uncited card, missing story, cycle, not the ghost", () => {
  const p = setup({ decided: ["pay", "receipt"], ghosts: ["ghosty"] }, [1, 2, 3]);
  put(p, {
    "01-a.md": ticket({ title: "One", cites: "checkout, pay", stories: "1", checks: "- `make test`" }),
    "02-b.md": ticket({ title: "Two", cites: "pay", blocked: "3", stories: "2" }),
    "03-c.md": ticket({ title: "Three", cites: "checkout", blocked: "2", stories: "1" }),
  });
  const r = check(p, "--root", "checkout", "--spec", "spec.md");
  console.log(r.all);
  const lines = r.all.split("\n");
  const cited = lines.filter((l) => l.startsWith("ticket set") && l.includes("cards-cited"));
  expect(cited.length).toBe(1);
  expect(cited[0]).toContain("receipt");
  const stories = lines.filter((l) => l.startsWith("ticket set") && l.includes("stories"));
  expect(stories.length).toBe(1);
  expect(stories[0]).toMatch(/story 3\b/);
  const cyc = lines.find((l) => l.includes("blocked_by") && l.includes("cycle"));
  expect(cyc).toBeDefined();
  expect(cyc).toContain("02-b.md");
  expect(cyc).toContain("03-c.md");
  expect(lines.filter((l) => l.includes("ghosty"))).toEqual([]);
  expect(r.code).toBe(1);
});

test("26.4 a ticket with no title fails alone and its cites do not count", () => {
  const p = setup({ decided: ["pay"] }, [1]);
  put(p, { "01-a.md": ticket({ cites: "checkout, pay", stories: "1", checks: "- `make test`" }) });
  const r = check(p, "--root", "checkout", "--spec", "spec.md");
  console.log(r.all);
  const lines = failureLines(r.out);
  const own = lines.filter((l) => l.startsWith("01-a.md"));
  expect(own.length).toBe(1);
  expect(own[0]).toContain("title");
  expect(lines.find((l) => l.startsWith("ticket set") && l.includes("#pay"))).toBeDefined();
  expect(lines.find((l) => l.startsWith("ticket set") && /story 1\b/.test(l))).toBeDefined();
  expect(r.code).toBe(1);
});

test("26.5 a malformed call never reads as a pass", () => {
  const p = setup({ decided: ["pay"] }, [1]);
  put(p, { "01-a.md": ticket({ title: "One", cites: "checkout, pay", stories: "1" }) });
  const a = check(p, "--root", "checkout", "--spec", "missing.md");
  console.log(a.all);
  expect(a.all).toMatch(/spec/);
  expect(a.all).toMatch(/missing\.md/);
  expect(a.code).toBe(2);
  writeFileSync(join(p.dir, "nostories.md"), "# Spec\n\n## Seams\n\n1. Something.\n");
  expect(check(p, "--root", "checkout", "--spec", "nostories.md").code).toBe(2);
  expect(check(p, "--root", "nope", "--spec", "spec.md").code).toBe(2);
  expect(check(p, "--spec", "spec.md").code).toBe(2);
});
