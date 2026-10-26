// Held-out steps 26.x: `werk ticket-check` on a folder of hand-written tickets.
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decided, type P, project, real, type Seed } from "./helpers.ts";

const spec = (n: number) =>
  `# Spec: billing\n\n## User stories\n\n${Array.from({ length: n }, (_, i) => `${i + 1}. As a person, I want thing ${i + 1}.`).join("\n")}\n\n## Seams\n\nThe command line.\n`;

type T = { title?: string; cites: string; blockedBy: string; stories: string; what?: string; checks?: string };
const ticket = ({ title, cites, blockedBy, stories, what, checks }: T) =>
  `${title === undefined ? "" : `title: ${title}\n`}cites: ${cites}
blocked_by: ${blockedBy}
stories: ${stories}
touches: invoice view, decision log

## What to build

${what ?? "A person opens an invoice and sees its lines."}

## Acceptance criteria

- [ ] The invoice shows every line.

## Checks
${checks ?? ""}`;

function setup(seeds: Seed[], stories: number, files: Record<string, string>): P {
  const p = project();
  p.seed(seeds);
  writeFileSync(join(p.dir, "spec.md"), spec(stories));
  mkdirSync(join(p.dir, "tickets"));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(p.dir, "tickets", name), text);
  return p;
}

const run = (p: P, ...args: string[]) => p.w("ticket-check", "tickets", ...args);
const lines = (out: string) => out.split("\n").filter((l) => l !== "");

const twoDecided: Seed[] = [
  real("billing", "Billing"),
  real("invoice", "Invoice", "billing"),
  real("refund", "Refund", "billing"),
  decided("billing"),
  decided("invoice"),
  decided("refund"),
];

const valid = {
  "01-invoice.md": ticket({ title: "A person sees an invoice", cites: "billing, invoice", blockedBy: "", stories: "1", checks: "\n- `make test`\n" }),
  "02-refund.md": ticket({ title: "A person refunds an invoice", cites: "#refund", blockedBy: "1", stories: "2", checks: "\n" }),
};

test("26.1", async () => {
  const p = setup(twoDecided, 2, valid);
  const r = await run(p, "--root", "billing", "--spec", "spec.md");
  const out = lines(r.out);
  expect(out.slice(0, -1)).toEqual([]);
  expect(out.at(-1)).toMatch(/\b0 failures\b/);
  expect(r.code).toBe(0);
});

test("26.2", async () => {
  const what = "Read the invoice queue in src/loop.ts and keep the Makefile target.";
  const files = {
    "01-invoice.md": ticket({ title: "A person sees an invoice", cites: "billing, invoice", blockedBy: "", stories: "1", what, checks: "\n- `make test`\n" }),
    "02-refund.md": ticket({
      title: "A person refunds an invoice",
      cites: "#refund",
      blockedBy: "1",
      stories: "2",
      what: `A person refunds an invoice. ${"word ".repeat(820)}`,
      checks: "\n",
    }),
  };
  // The path sits on line 9 of the first ticket, inside its What to build section.
  expect(files["01-invoice.md"].split("\n")[8]).toContain("src/loop.ts");
  expect(files["02-refund.md"].length).toBeGreaterThan(4000);
  const p = setup(twoDecided, 2, files);
  const r = await run(p, "--root", "billing", "--spec", "spec.md");
  const out = lines(r.out);
  const pathLine = out.find((l) => l.startsWith("01-invoice.md") && l.includes("no-file-paths"));
  expect(pathLine).toBeDefined();
  expect(pathLine).toContain("src/loop.ts");
  expect(pathLine).toMatch(/line 9\b/);
  expect(out.slice(0, -1).some((l) => l.includes("Makefile"))).toBe(false);
  expect(out.some((l) => l.startsWith("02-refund.md") && l.includes("size"))).toBe(true);
  expect(out.at(-1)).toMatch(/[1-9]\d* failures?/);
  expect(r.code).toBe(1);
});

test("26.3", async () => {
  const seeds: Seed[] = [
    ...twoDecided,
    { type: "node.proposed", actor: "agent", payload: { id: "credit-note", kind: "card", title: "Credit note", parent: "billing" } },
  ];
  const files = {
    "01-invoice.md": ticket({ title: "A person sees an invoice", cites: "billing, invoice", blockedBy: "", stories: "1", checks: "\n" }),
    "02-total.md": ticket({ title: "A person sees the total", cites: "invoice", blockedBy: "3", stories: "2", checks: "\n" }),
    "03-tax.md": ticket({ title: "A person sees the tax", cites: "invoice", blockedBy: "2", stories: "2", checks: "\n" }),
  };
  const p = setup(seeds, 3, files);
  const r = await run(p, "--root", "billing", "--spec", "spec.md");
  const out = lines(r.out);
  const cited = out.filter((l) => l.startsWith("ticket set") && l.includes("cards-cited"));
  expect(cited).toHaveLength(1);
  expect(cited[0]).toContain("refund");
  const story = out.filter((l) => l.startsWith("ticket set") && l.includes("stories"));
  expect(story).toHaveLength(1);
  expect(story[0]).toContain("3");
  const cycle = out.find((l) => l.includes("blocked_by") && l.includes("cycle"));
  expect(cycle).toBeDefined();
  expect(cycle).toContain("02-total.md");
  expect(cycle).toContain("03-tax.md");
  expect(out.some((l) => l.includes("credit-note"))).toBe(false);
  expect(r.code).toBe(1);
});

test("26.4", async () => {
  const seeds: Seed[] = [real("billing", "Billing"), real("invoice", "Invoice", "billing"), decided("invoice")];
  const files = { "01-invoice.md": ticket({ cites: "invoice", blockedBy: "", stories: "1", checks: "\n" }) };
  const p = setup(seeds, 1, files);
  const r = await run(p, "--root", "billing", "--spec", "spec.md");
  const out = lines(r.out);
  const own = out.filter((l) => l.startsWith("01-invoice.md"));
  expect(own).toHaveLength(1);
  expect(own[0]).toContain("title");
  expect(out.some((l) => l.startsWith("ticket set") && l.includes("invoice"))).toBe(true);
  expect(out.some((l) => l.startsWith("ticket set") && l.includes("stories") && l.includes("1"))).toBe(true);
  expect(r.code).toBe(1);
});

test("26.5", async () => {
  const p = setup(twoDecided, 2, valid);
  writeFileSync(join(p.dir, "nospec.md"), "# Spec\n\n## Seams\n\nNone.\n");
  const missing = await run(p, "--root", "billing", "--spec", "absent.md");
  expect(`${missing.out}${missing.err}`).toMatch(/spec/i);
  expect(`${missing.out}${missing.err}`).toContain("absent.md");
  expect(missing.code).toBe(2);
  expect((await run(p, "--root", "billing", "--spec", "nospec.md")).code).toBe(2);
  expect((await run(p, "--root", "no-such-card", "--spec", "spec.md")).code).toBe(2);
  expect((await run(p, "--spec", "spec.md")).code).toBe(2);
});
