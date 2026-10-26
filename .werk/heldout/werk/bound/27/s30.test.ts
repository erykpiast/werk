import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ticket } from "../src/tickets/fixtures.ts";
import { createProject, decidedEvents, ghost, openEvents, type Project, seed, werk } from "./support.ts";

let p: Project;
beforeEach(() => {
  p = createProject();
});
afterEach(() => p.dispose());

const SPEC = "# Spec\n\n## User stories\n\n1. As a person I do one.\n2. As a person I do two.\n\n## Other\n";
const folder = (files: Record<string, string>, spec = SPEC) => {
  const dir = join(p.dir, "tickets");
  mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  writeFileSync(join(p.dir, "spec.md"), spec);
};
const check = () => werk(p, "ticket-check", "tickets", "--root", "root", "--spec", "spec.md");
const lines = (s: string) => s.split("\n").filter(Boolean);

test("30.1 a folder of correct tickets passes", async () => {
  seed(p, decidedEvents("root"), decidedEvents("a", { parent: "root" }), decidedEvents("b", { parent: "root" }));
  folder({
    "01-a.md": ticket({ cites: "a", stories: "1" }),
    "02-b.md": ticket({ cites: "b", stories: "2", blockedBy: "1", title: "A second thing" }),
  });
  const r = await check();
  expect(r.stderr).toBe("");
  expect(lines(r.stdout)).toEqual(["2 tickets, 0 own-check failures, 0 failures, 2 decided cards, 2 stories"]);
  expect(r.code).toBe(0);
});

test("30.2 own-check failures name the ticket, the check and the field", async () => {
  seed(p, decidedEvents("root"), decidedEvents("a", { parent: "root" }));
  const bad = ticket({ cites: "a", stories: "2" }).split("\n");
  bad[11] = "See src/foo/bar.ts for it.";
  folder({
    "01-a.md": ticket({ cites: "a", stories: "1" }),
    "02-b.md": bad.join("\n"),
    "03-c.md": ticket({ cites: "a", stories: "2", touches: null }),
  });
  const r = await check();
  const out = lines(r.stdout);
  expect(out.some((l) => l.startsWith("02-b.md") && /file-paths/.test(l) && l.includes("src/foo/bar.ts") && l.includes("line 12"))).toBe(true);
  expect(out.some((l) => l.startsWith("03-c.md") && /shape/.test(l) && l.includes("touches"))).toBe(true);
  expect(out.some((l) => l.startsWith("01-a.md"))).toBe(false);
  expect(out.at(-1)).toMatch(/^3 tickets, 2 own-check failures/);
  expect(r.code).toBe(1);
});

test("30.3 an uncited decided card fails the set, a ghost does not count", async () => {
  seed(p, decidedEvents("root"), decidedEvents("a", { parent: "root" }), decidedEvents("b", { parent: "root" }), ghost("g", { parent: "root", status: "decided" }));
  folder({
    "01-a.md": ticket({ cites: "root, a", stories: "1" }),
    "02-b.md": ticket({ cites: "root", stories: "2", title: "Another" }),
  });
  const r = await check();
  const out = lines(r.stdout);
  const setLines = out.filter((l) => l.startsWith("ticket set"));
  expect(setLines).toHaveLength(1);
  expect(setLines[0]).toContain("b");
  expect(out.some((l) => /\bg\b/.test(l))).toBe(false);
  expect(out.at(-1)).toContain("2 decided cards");
  expect(r.code).toBe(1);
});

test("30.4 a cycle in blocked_by names only the tickets on the cycle", async () => {
  seed(p, decidedEvents("root"), decidedEvents("a", { parent: "root" }), decidedEvents("b", { parent: "root" }), decidedEvents("c", { parent: "root" }), decidedEvents("d", { parent: "root" }));
  folder(
    {
      "01-a.md": ticket({ cites: "a", stories: "1" }),
      "02-b.md": ticket({ cites: "b", stories: "2", blockedBy: "3", title: "Two" }),
      "03-c.md": ticket({ cites: "c", stories: "1", blockedBy: "2", title: "Three" }),
      "04-d.md": ticket({ cites: "d", stories: "2", blockedBy: "3", title: "Four" }),
    },
  );
  const r = await check();
  const out = lines(r.stdout);
  const fail = (n: string) => out.some((l) => l.startsWith(n) && l.includes("blocked_by"));
  expect(fail("02")).toBe(true);
  expect(fail("03")).toBe(true);
  expect(out.some((l) => l.startsWith("01") || l.startsWith("04"))).toBe(false);
  expect(r.code).toBe(1);
});

test("30.5 a spec with no User stories heading is a malformed call", async () => {
  seed(p, decidedEvents("root"), decidedEvents("a", { parent: "root" }));
  folder({ "01-a.md": ticket({ cites: "a", stories: "1" }) }, "# Spec\n\nNo stories here.\n");
  const r = await check();
  expect(r.stderr + r.stdout).toMatch(/User stories/);
  expect(r.stdout).toBe("");
  expect(r.code).toBe(2);
});
