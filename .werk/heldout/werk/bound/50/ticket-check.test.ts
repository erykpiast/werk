// Scenarios 26.x: werk ticket-check on a folder of hand-written tickets.
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decided, ok, type Project, project, real, seed } from "./helpers.ts";

const spec = (stories: number[]) =>
  `# Spec: checkout\n\n## User stories\n\n${stories.map((n) => `${n}. As a buyer, I want thing ${n}.`).join("\n")}\n\n## Seams\n\nThe command line.\n`;

type T = { title?: string; cites: string; blockedBy: string; stories: string; what?: string; checks?: string };

function ticket(t: T): string {
  return [
    ...(t.title === undefined ? [] : [`title: ${t.title}`]),
    `cites: ${t.cites}`,
    `blocked_by: ${t.blockedBy}`,
    `stories: ${t.stories}`,
    "touches: checkout flow, payment form",
    "",
    "## What to build",
    "",
    t.what ?? "A buyer pays for the cart in one step.",
    "",
    "## Acceptance criteria",
    "",
    "- [ ] The buyer sees a receipt after paying.",
    "",
    "## Checks",
    "",
    ...(t.checks === undefined ? [] : [t.checks]),
    "",
  ].join("\n");
}

function setup(cards: { id: string; ghost?: boolean }[], stories: number[], files: Record<string, string>): Project {
  const p = project();
  seed(p, [real("checkout", "Checkout"), decided("checkout")]);
  for (const card of cards) {
    if (card.ghost)
      seed(p, [
        {
          type: "node.proposed",
          actor: "agent",
          payload: { id: card.id, kind: "card", title: card.id, parent: "checkout" },
        },
      ]);
    else seed(p, [real(card.id, card.id, "checkout"), decided(card.id)]);
  }
  writeFileSync(join(p.dir, "spec.md"), spec(stories));
  mkdirSync(join(p.dir, "tickets"));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(p.dir, "tickets", name), text);
  return p;
}

const run = (p: Project, root = "checkout", specFile = "spec.md") =>
  p.werk(["ticket-check", "tickets", "--root", root, "--spec", specFile]);

const validFiles = () => ({
  "01-pay.md": ticket({
    title: "A buyer can pay",
    cites: "checkout, pay-card",
    blockedBy: "",
    stories: "1",
    checks: "- `make test`",
  }),
  "02-receipt.md": ticket({ title: "A buyer gets a receipt", cites: "#receipt-card", blockedBy: "1", stories: "2" }),
});

test("26.1 a folder of valid hand-written tickets gets a clean pass", async () => {
  const p = setup([{ id: "pay-card" }, { id: "receipt-card" }], [1, 2], validFiles());
  const result = await run(p);
  const out = result.out.trimEnd().split("\n");
  expect(out).toHaveLength(1);
  expect(out.at(-1)).toMatch(/\b0 failures\b/);
  expect(result.code).toBe(0);
});

test("26.2 a file path and an oversized ticket are each named with the ticket and place", async () => {
  const files = validFiles();
  const p = setup([{ id: "pay-card" }, { id: "receipt-card" }], [1, 2], files);
  expect((await run(p)).code).toBe(0);
  const edited = ticket({
    title: "A buyer can pay",
    cites: "checkout, pay-card",
    blockedBy: "",
    stories: "1",
    checks: "- `make test`",
    what: "The pay step lives in src/loop.ts, and the Makefile runs it.",
  });
  expect(edited.split("\n")[8]).toContain("src/loop.ts");
  writeFileSync(join(p.dir, "tickets", "01-pay.md"), edited);
  const padded = ticket({
    title: "A buyer gets a receipt",
    cites: "#receipt-card",
    blockedBy: "1",
    stories: "2",
    what: `A buyer gets a receipt. ${"The receipt lists every line. ".repeat(140)}`,
  });
  expect(padded.length).toBeGreaterThan(4000);
  writeFileSync(join(p.dir, "tickets", "02-receipt.md"), padded);

  const result = await run(p);
  const out = result.out.trimEnd().split("\n");
  const path = out.find((line) => line.startsWith("01-pay.md") && line.includes("no-file-paths"));
  expect(path).toBeDefined();
  expect(path).toContain("src/loop.ts");
  expect(path).toContain("line 9");
  expect(out.filter((line) => line.includes("Makefile"))).toHaveLength(0);
  expect(out.find((line) => line.startsWith("02-receipt.md") && line.includes("size"))).toBeDefined();
  expect(out.at(-1)).not.toMatch(/\b0 failures\b/);
  expect(out.at(-1)).toMatch(/failure/);
  expect(result.code).toBe(1);
});

test("26.3 set checks report an uncited card, a missing story and a blocker cycle, but not a ghost", async () => {
  const p = setup([{ id: "pay-card" }, { id: "refund-card" }, { id: "ghost-card", ghost: true }], [1, 2, 3], {
    "01-pay.md": ticket({ title: "Pay", cites: "checkout, pay-card", blockedBy: "", stories: "1" }),
    "02-receipt.md": ticket({ title: "Receipt", cites: "pay-card", blockedBy: "3", stories: "2" }),
    "03-email.md": ticket({ title: "Email", cites: "checkout", blockedBy: "2", stories: "1" }),
  });
  const result = await run(p);
  const out = result.out.trimEnd().split("\n");
  const cited = out.filter((line) => line.startsWith("ticket set") && line.includes("cards-cited"));
  expect(cited).toHaveLength(1);
  expect(cited[0]).toContain("refund-card");
  const stories = out.filter((line) => line.startsWith("ticket set") && line.includes("stories"));
  expect(stories).toHaveLength(1);
  expect(stories[0]).toMatch(/\b3\b/);
  const cycle = out.find((line) => line.includes("blocked_by") && line.includes("cycle"));
  expect(cycle).toContain("02-receipt.md");
  expect(cycle).toContain("03-email.md");
  expect(out.filter((line) => line.includes("ghost-card"))).toHaveLength(0);
  expect(result.code).toBe(1);
});

test("26.4 a ticket with no title fails alone, and its cites do not count for the set", async () => {
  const p = setup([{ id: "pay-card" }], [1], {
    "01-pay.md": ticket({ cites: "checkout, pay-card", blockedBy: "", stories: "1" }),
  });
  const result = await run(p);
  const out = result.out.trimEnd().split("\n");
  const own = out.filter((line) => line.startsWith("01-pay.md"));
  expect(own.some((line) => line.includes(": title:"))).toBe(true);
  expect(own.filter((line) => !line.includes(": title:"))).toEqual([]);
  expect(out.some((line) => line.startsWith("ticket set") && line.includes("pay-card"))).toBe(true);
  expect(out.some((line) => line.startsWith("ticket set") && line.includes("stories") && /\b1\b/.test(line))).toBe(
    true,
  );
  expect(result.code).toBe(1);
});

test("26.5 a malformed call never reads as a pass", async () => {
  const p = setup([{ id: "pay-card" }, { id: "receipt-card" }], [1, 2], validFiles());
  const missing = await run(p, "checkout", "no-such-spec.md");
  expect(`${missing.out}${missing.err}`).toMatch(/spec/i);
  expect(`${missing.out}${missing.err}`).toMatch(/no spec file|missing|not found|does not exist/i);
  expect(missing.code).toBe(2);
  writeFileSync(join(p.dir, "bad-spec.md"), "# Spec\n\n1. A story with no heading.\n");
  expect((await run(p, "checkout", "bad-spec.md")).code).toBe(2);
  expect((await run(p, "no-such-root")).code).toBe(2);
  expect((await p.werk(["ticket-check", "tickets", "--spec", "spec.md"])).code).toBe(2);
});

void ok;
