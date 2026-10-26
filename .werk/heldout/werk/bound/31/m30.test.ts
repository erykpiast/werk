import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { card, createProject, decided, ev, link, type Project, raw, werk } from "./support.ts";

let p: Project;
beforeEach(() => {
  p = createProject();
});
afterEach(() => p.dispose());

type Parts = { title?: string; cites: string; blockedBy?: string; stories: string; touches?: string | null; what?: string };

function ticket(o: Parts): string {
  const out = [`title: ${o.title ?? "A person can do a thing"}`, `cites: ${o.cites}`, `blocked_by: ${o.blockedBy ?? ""}`, `stories: ${o.stories}`];
  if (o.touches !== null) out.push(`touches: ${o.touches ?? "map view"}`);
  out.push("", "## What to build", "", o.what ?? "A person presses a button and the card changes.", "", "## Acceptance criteria", "", "- [ ] The card changes.", "", "## Checks", "", "- `make test`", "");
  return out.join("\n");
}

function setup(files: Record<string, string>, spec = "# Spec\n\n## User stories\n\n1. First story\n2. Second story\n\n## Other\n") {
  const dir = join(p.dir, "tickets");
  mkdirSync(dir, { recursive: true });
  for (const [n, t] of Object.entries(files)) writeFileSync(join(dir, n), t);
  writeFileSync(join(p.dir, "spec.md"), spec);
  return dir;
}

/** A root that is not decided, with decided cards under it. */
function tree(ids: string[]) {
  card(p, "root", "Root");
  for (const id of ids) {
    decided(p, id, `Card ${id}`);
    link(p, id, "root", "refines");
  }
}

const check = (...extra: string[]) => werk(p, "ticket-check", "tickets", "--root", "root", "--spec", "spec.md", ...extra);
const lines = (s: string) => s.split("\n").filter((l) => l.trim() !== "");

test("30.1 a folder of correct tickets passes", async () => {
  tree(["c1", "c2"]);
  setup({
    "01-first.md": ticket({ cites: "c1", stories: "1" }),
    "02-second.md": ticket({ cites: "c2", stories: "2", blockedBy: "1", touches: "board" }),
  });
  const r = await check();
  expect(r.code, `${r.stdout}\n${r.stderr}`).toBe(0);
  const out = lines(r.stdout);
  expect(out).toHaveLength(1);
  expect(out[0]).toBe("2 tickets, 0 own-check failures, 0 failures, 2 decided cards, 2 stories");
});

test("30.2 own-check failures name the ticket, check and field", async () => {
  tree(["c1", "c2"]);
  const filler = (n: number) => Array.from({ length: n }, (_, i) => `Line ${i} of text.`).join("\n");
  // The path sits on line 12 of the file.
  const t2 = ticket({ cites: "c2", stories: "2" });
  const l2 = t2.split("\n");
  expect(l2.length).toBeGreaterThan(14);
  l2[11] = "See src/app/main.ts for the old code.";
  setup({
    "01-first.md": ticket({ cites: "c1", stories: "1" }),
    "02-second.md": l2.join("\n"),
    "03-third.md": ticket({ cites: "c2", stories: "2", touches: null }),
  });
  void filler;
  const r = await check();
  expect(r.code).toBe(1);
  const out = lines(r.stdout);
  const second = out.find((l) => l.startsWith("02-second.md"));
  expect(second, r.stdout).toBeDefined();
  expect(second).toContain("no-file-paths");
  expect(second).toContain("src/app/main.ts");
  expect(second).toContain("line 12");
  const third = out.find((l) => l.startsWith("03-third.md"));
  expect(third, r.stdout).toBeDefined();
  expect(third).toContain("shape");
  expect(third).toContain("touches");
  expect(out.some((l) => l.startsWith("01-first.md"))).toBe(false);
  expect(out[out.length - 1]).toMatch(/^3 tickets, 2 own-check failures/);
});

test("30.3 an uncited decided card fails the set, a ghost does not count", async () => {
  card(p, "root", "Root");
  decided(p, "a", "Card a");
  link(p, "a", "root", "refines");
  decided(p, "b", "Card b");
  link(p, "b", "root", "refines");
  raw(p, { type: "node.proposed", id: "ghost", kind: "card", title: "Ghost card", status: "decided", parent: "root" });
  setup({
    "01-first.md": ticket({ cites: "root", stories: "1" }),
    "02-second.md": ticket({ cites: "a", stories: "2" }),
  });
  const r = await check();
  expect(r.code).toBe(1);
  const out = lines(r.stdout);
  const set = out.filter((l) => l.startsWith("ticket set"));
  expect(set).toHaveLength(1);
  expect(set[0]).toContain("b");
  expect(out.some((l) => l.includes("ghost"))).toBe(false);
  expect(out[out.length - 1]).toContain("2 decided cards");
});

test("30.4 a blocked_by cycle names only the tickets on it", async () => {
  tree(["c1", "c2"]);
  setup(
    {
      "01-one.md": ticket({ cites: "c1", stories: "1" }),
      "02-two.md": ticket({ cites: "c2", stories: "2", blockedBy: "3" }),
      "03-three.md": ticket({ cites: "c1", stories: "3", blockedBy: "2" }),
      "04-four.md": ticket({ cites: "c2", stories: "4", blockedBy: "3" }),
    },
    "## User stories\n\n1. a\n2. b\n3. c\n4. d\n",
  );
  const r = await check();
  expect(r.code).toBe(1);
  const out = lines(r.stdout);
  expect(out.some((l) => l.startsWith("02-two.md") && l.includes("blocked_by"))).toBe(true);
  expect(out.some((l) => l.startsWith("03-three.md") && l.includes("blocked_by"))).toBe(true);
  expect(out.some((l) => l.startsWith("01-one.md"))).toBe(false);
  expect(out.some((l) => l.startsWith("04-four.md"))).toBe(false);
});

test("30.5 a spec with no User stories heading is a malformed call", async () => {
  tree(["c1", "c2"]);
  setup(
    {
      "01-first.md": ticket({ cites: "c1", stories: "1" }),
      "02-second.md": ticket({ cites: "c2", stories: "2" }),
    },
    "# Spec\n\nNothing about stories here.\n",
  );
  const r = await check();
  expect(r.code).toBe(2);
  expect(r.stderr).toContain("User stories");
  expect(r.stdout.trim()).toBe("");
});
