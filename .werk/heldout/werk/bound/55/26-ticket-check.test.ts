// Scenarios 26.x: ticket-check on a folder of hand-written tickets.
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { card, decided, type Project, type Seed, withMap } from "./helpers.ts";

const spec = (n: number) => `# Spec: checkout

## User stories

${Array.from({ length: n }, (_, i) => `${i + 1}. As a shopper, I want thing ${i + 1}.`).join("\n")}

## Seams

The command line.
`;

type T = { title?: string; cites: string; blocked?: string; stories: string; build?: string; checks?: string; pad?: number };
const ticket = (t: T) => `${t.title === undefined ? "" : `title: ${t.title}\n`}cites: ${t.cites}
blocked_by: ${t.blocked ?? ""}
stories: ${t.stories}
touches: cart page, order log

## What to build

${t.build ?? "A shopper puts an item in the cart and sees the total."}${t.pad ? `\n\n${"The total updates when the shopper changes a count. ".repeat(t.pad)}` : ""}

## Acceptance criteria

- [ ] The cart shows the total.

## Checks

${t.checks ?? ""}
`;

function setup(seeds: Seed[], stories: number, files: Record<string, string>): Project {
  const p = withMap(seeds);
  writeFileSync(join(p.dir, "spec.md"), spec(stories));
  mkdirSync(join(p.dir, "tickets"));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(p.dir, "tickets", name), text);
  return p;
}
const check = (p: Project, ...args: string[]) => p.werk(["ticket-check", "tickets", ...args]);
const base: Seed[] = [card("shop", "Shop"), card("cart", "Cart", "shop"), decided("cart"), card("pay", "Pay", "shop"), decided("pay")];
const lastLine = (out: string) => out.trimEnd().split("\n").at(-1) as string;

test("26.1 a folder of valid hand-written tickets gets a clean pass", async () => {
  const p = setup(base, 2, {
    "01-cart.md": ticket({ title: "A shopper sees the cart total", cites: "shop, cart", stories: "1", checks: "- `make test`" }),
    "02-pay.md": ticket({ title: "A shopper pays for the cart", cites: "#pay", blocked: "1", stories: "2" }),
  });
  const run = await check(p, "--root", "shop", "--spec", "spec.md");
  const rows = run.out.trimEnd().split("\n");
  expect(rows).toHaveLength(1);
  expect(lastLine(run.out)).toMatch(/\b0 failures\b/);
  expect(run.code).toBe(0);
});

test("26.2 an agent finds a file path and an oversized ticket", async () => {
  const one = ticket({ title: "A shopper sees the cart total", cites: "shop, cart", stories: "1", checks: "- `make test`" }).split("\n");
  // File line 9 is in the What to build section.
  expect(one[6]).toBe("## What to build");
  one[8] = "Change `src/loop.ts` so the cart total shows. Also update the Makefile target.";
  const p = setup(base, 2, {
    "01-cart.md": one.join("\n"),
    "02-pay.md": ticket({ title: "A shopper pays for the cart", cites: "#pay", blocked: "1", stories: "2", pad: 90 }),
  });
  const run = await check(p, "--root", "shop", "--spec", "spec.md");
  const rows = run.out.trimEnd().split("\n");
  const pathLine = rows.find((l) => l.startsWith("01-cart.md") && l.includes("src/loop.ts"));
  expect(pathLine).toBeDefined();
  expect(pathLine).toMatch(/no-file-paths|file path/);
  expect(pathLine).toMatch(/\b9\b/);
  expect(rows.filter((l) => l.includes("Makefile"))).toEqual([]);
  const size = rows.find((l) => l.startsWith("02-pay.md") && /size/.test(l));
  expect(size).toBeDefined();
  expect(lastLine(run.out)).toMatch(/[1-9]\d* failures/);
  expect(run.code).toBe(1);
});

test("26.3 the set checks report an uncited card, a missing story and a blocker cycle, but not a ghost", async () => {
  const p = setup(
    [...base, ["node.proposed", { id: "ghost-card", kind: "card", title: "Ghost", parent: "shop" }]],
    3,
    {
      "01-cart.md": ticket({ title: "A shopper sees the cart total", cites: "cart", stories: "1" }),
      "02-pay-a.md": ticket({ title: "A shopper pays part one", cites: "cart", blocked: "3", stories: "2" }),
      "03-pay-b.md": ticket({ title: "A shopper pays part two", cites: "cart", blocked: "2", stories: "2" }),
    },
  );
  const run = await check(p, "--root", "shop", "--spec", "spec.md");
  const rows = run.out.trimEnd().split("\n");
  const cited = rows.filter((l) => l.startsWith("ticket set") && l.includes("pay") && /cite/.test(l));
  expect(cited).toHaveLength(1);
  const story = rows.filter((l) => l.startsWith("ticket set") && /stor/.test(l) && /\b3\b/.test(l));
  expect(story).toHaveLength(1);
  const cycle = rows.find((l) => l.includes("blocked_by") && /cycle/.test(l));
  expect(cycle).toBeDefined();
  expect(cycle).toMatch(/2/);
  expect(cycle).toMatch(/3/);
  expect(rows.filter((l) => l.includes("ghost-card"))).toEqual([]);
  expect(run.code).toBe(1);
});

test("26.4 a ticket with no title fails alone, and its cites do not count for the set", async () => {
  const p = setup([card("shop", "Shop"), card("cart", "Cart", "shop"), decided("cart")], 1, {
    "01-cart.md": ticket({ cites: "cart", stories: "1" }),
  });
  const run = await check(p, "--root", "shop", "--spec", "spec.md");
  const rows = run.out.trimEnd().split("\n");
  const own = rows.filter((l) => l.startsWith("01-cart.md"));
  expect(own).toHaveLength(1);
  expect(own[0]).toMatch(/title/);
  const set = rows.filter((l) => l.startsWith("ticket set"));
  expect(set.some((l) => l.includes("cart"))).toBe(true);
  expect(set.some((l) => /stor/.test(l) && /\b1\b/.test(l))).toBe(true);
  expect(run.code).toBe(1);
});

test("26.5 a malformed call never reads as a pass", async () => {
  const p = setup(base, 2, {
    "01-cart.md": ticket({ title: "A shopper sees the cart total", cites: "shop, cart", stories: "1" }),
    "02-pay.md": ticket({ title: "A shopper pays for the cart", cites: "pay", blocked: "1", stories: "2" }),
  });
  writeFileSync(join(p.dir, "nostories.md"), "# Spec\n\n## Seams\n\nNone.\n");
  const missing = await check(p, "--root", "shop", "--spec", "absent.md");
  expect(missing.err + missing.out).toMatch(/spec/);
  expect(missing.err + missing.out).toContain("absent.md");
  expect(missing.code).toBe(2);
  expect((await check(p, "--root", "shop", "--spec", "nostories.md")).code).toBe(2);
  expect((await check(p, "--root", "nope", "--spec", "spec.md")).code).toBe(2);
  expect((await check(p, "--spec", "spec.md")).code).toBe(2);
});
