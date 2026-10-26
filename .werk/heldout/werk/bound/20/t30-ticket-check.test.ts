import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { useProject } from "../src/test-env/project.ts";
import { decided, decidedGhost, real, seed, werk } from "./helpers.ts";

const project = useProject();

/** A decided card cannot stand under an open one, so the root is decided first and reopened last. */
function reopenRoot(p: ReturnType<typeof project>) {
  seed(p, {
    type: "node.reopened",
    id: "root",
    reason: "rejected",
    at: "2026-10-10T09:00:00.000Z",
  });
}

type Parts = Record<string, string | null>;

/** A ticket in the fixed format. A part set to null is left out. */
function ticket(parts: Parts = {}): string {
  const p: Parts = {
    title: "A person can reopen a card",
    cites: "card-a",
    blockedBy: "",
    stories: "1",
    touches: "map view, decision log",
    what: "A person presses reopen and the card goes back to open.",
    acceptance: "- [ ] A reopened card shows as open.",
    checks: "- `make test`",
    ...parts,
  };
  const out: string[] = [];
  if (p.title !== null) out.push(`title: ${p.title}`);
  if (p.cites !== null) out.push(`cites: ${p.cites}`);
  if (p.blockedBy !== null) out.push(`blocked_by: ${p.blockedBy}`);
  if (p.stories !== null) out.push(`stories: ${p.stories}`);
  if (p.touches !== null) out.push(`touches: ${p.touches}`);
  if (p.what !== null) out.push("", "## What to build", "", p.what as string);
  if (p.acceptance !== null)
    out.push("", "## Acceptance criteria", "", p.acceptance as string);
  if (p.checks !== null) out.push("", "## Checks", "", p.checks as string);
  return `${out.join("\n")}\n`;
}

function setup(
  p: ReturnType<typeof project>,
  files: Record<string, string>,
  spec = "# Spec\n\n## User stories\n\n1. As a person, I reopen a card.\n2. As a person, I see it open.\n3. Third.\n4. Fourth.\n\n## Other\n\ntext\n",
) {
  const folder = join(p.dir, "tickets");
  mkdirSync(folder, { recursive: true });
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(join(folder, name), text);
  }
  writeFileSync(join(p.dir, "spec.md"), spec);
}

const check = (p: ReturnType<typeof project>) =>
  werk(p, "ticket-check", "tickets", "--root", "root", "--spec", "spec.md");

test("30.1 a folder of correct tickets passes", async () => {
  const p = project();
  seed(
    p,
    decided("root", { title: "Root" }),
    decided("card-a", { title: "Card A", parent: "root" }),
    decided("card-b", { title: "Card B", parent: "root" }),
  );
  reopenRoot(p);
  setup(
    p,
    {
      "1-first.md": ticket({ cites: "card-a", stories: "1" }),
      "2-second.md": ticket({ cites: "card-b", stories: "2", blockedBy: "1" }),
    },
    "# Spec\n\n## User stories\n\n1. One.\n2. Two.\n",
  );
  const r = await check(p);
  const out = r.stdout.trim().split("\n");
  expect(r.stderr).toBe("");
  expect(out.length).toBe(1);
  expect(out[0]).toMatch(/\b2 tickets\b/);
  expect(out[0]).toMatch(/\b0 own-check failures\b/);
  expect(out[0]).toMatch(/\b0 failures\b/);
  expect(out[0]).toMatch(/\b2 decided cards\b/);
  expect(out[0]).toMatch(/\b2 stories\b/);
  expect(r.code).toBe(0);
});

test("30.2 own-check failures name the ticket, the check and the field", async () => {
  const p = project();
  seed(
    p,
    decided("root", { title: "Root" }),
    decided("card-a", { title: "Card A", parent: "root" }),
  );
  reopenRoot(p);
  setup(p, {
    "1-first.md": ticket({ cites: "card-a", stories: "1" }),
    "2-second.md": ticket({
      cites: "card-a",
      stories: "2",
      what: "One.\nTwo.\nThree.\nSee src/map/fold.ts for the rule.",
    }),
    "3-third.md": ticket({ cites: "card-a", stories: "3", touches: null }),
  });
  const r = await check(p);
  const out = r.stdout.trim().split("\n");
  const second = out.filter((l) => l.startsWith("2-second.md"));
  expect(second.length).toBeGreaterThan(0);
  expect(second.join("\n")).toContain("no-file-paths");
  expect(second.join("\n")).toContain("src/map/fold.ts");
  expect(second.join("\n")).toMatch(/line 12\b/);
  const third = out.filter((l) => l.startsWith("3-third.md"));
  expect(third.join("\n")).toContain("shape");
  expect(third.join("\n")).toContain("touches");
  expect(out.some((l) => l.startsWith("1-first.md"))).toBe(false);
  const last = out[out.length - 1] as string;
  expect(last).toMatch(/\b3 tickets\b/);
  expect(last).toMatch(/\b2 own-check failures\b/);
  expect(r.code).toBe(1);
});

test("30.3 an uncited decided card fails the set, and a ghost does not count", async () => {
  const p = project();
  seed(
    p,
    decided("root", { title: "Root" }),
    decided("card-a", { title: "Card A", parent: "root" }),
    decided("card-b", { title: "Card B", parent: "root" }),
    decidedGhost("card-ghost", { title: "Card Ghost", parent: "root" }),
  );
  reopenRoot(p);
  setup(
    p,
    {
      "1-first.md": ticket({ cites: "root, card-a", stories: "1" }),
      "2-second.md": ticket({ cites: "card-a", stories: "2" }),
    },
    "# Spec\n\n## User stories\n\n1. One.\n2. Two.\n",
  );
  const r = await check(p);
  const out = r.stdout.trim().split("\n");
  const set = out.filter((l) => l.startsWith("ticket set"));
  expect(set.length).toBe(1);
  expect(set[0]).toContain("card-b");
  expect(r.stdout).not.toContain("card-ghost");
  expect(out[out.length - 1]).toMatch(/\b2 decided cards\b/);
  expect(r.code).toBe(1);
});

test("30.4 a cycle in blocked_by names only the tickets on the cycle", async () => {
  const p = project();
  seed(
    p,
    decided("root", { title: "Root" }),
    decided("card-a", { title: "A", parent: "root" }),
    decided("card-b", { title: "B", parent: "root" }),
    decided("card-c", { title: "C", parent: "root" }),
    decided("card-d", { title: "D", parent: "root" }),
  );
  reopenRoot(p);
  setup(p, {
    "1-one.md": ticket({ cites: "card-a", stories: "1" }),
    "2-two.md": ticket({ cites: "card-b", stories: "2", blockedBy: "3" }),
    "3-three.md": ticket({ cites: "card-c", stories: "3", blockedBy: "2" }),
    "4-four.md": ticket({ cites: "card-d", stories: "4", blockedBy: "3" }),
  });
  const r = await check(p);
  const out = r.stdout.trim().split("\n");
  expect(out.some((l) => l.startsWith("2-two.md") && l.includes("blocked_by"))).toBe(true);
  expect(out.some((l) => l.startsWith("3-three.md") && l.includes("blocked_by"))).toBe(true);
  expect(out.some((l) => l.startsWith("1-one.md"))).toBe(false);
  expect(out.some((l) => l.startsWith("4-four.md"))).toBe(false);
  expect(r.code).toBe(1);
});

test("30.5 a spec with no User stories heading is a malformed call", async () => {
  const p = project();
  seed(p, decided("root", { title: "Root" }), decided("card-a", { parent: "root" }));
  setup(p, { "1-one.md": ticket({ cites: "card-a" }) }, "# Spec\n\n## Goals\n\n1. Nothing.\n");
  const r = await check(p);
  expect(r.stderr + r.stdout).toMatch(/no "?User stories"? heading/i);
  expect(r.stdout.trim()).toBe("");
  expect(r.code).toBe(2);
});
