import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ticket } from "../src/tickets/fixtures.ts";
import { type World, decided, open, world } from "./support.ts";

let w: World;
beforeEach(() => {
  w = world();
});
afterEach(() => w.project.dispose());

const specText = (n: number) =>
  `# Spec\n\n## User stories\n\n${Array.from({ length: n }, (_, i) => `${i + 1}. As a person I do thing ${i + 1}.`).join("\n")}\n\n## Other\n`;
const put = (files: Record<string, string>, spec = specText(2)) => {
  const dir = join(w.project.dir, "tickets");
  mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  writeFileSync(join(w.project.dir, "spec.md"), spec);
};
const check = () => w.werk("ticket-check", "tickets", "--root", "root", "--spec", "spec.md");
const under = (id: string) => ({ type: "edge.added", from: id, to: "root", link: "refines", why: "" });
const cards = (...extra: unknown[]) =>
  w.seed(open("root", { title: "Root" }), decided("c1"), decided("c2"), under("c1"), under("c2"), ...extra);

test("30.1 a folder of correct tickets passes", async () => {
  cards();
  put({
    "01-first.md": ticket({ cites: "c1", stories: "1" }),
    "02-second.md": ticket({ cites: "c2", stories: "2", blockedBy: "1" }),
  });
  const r = await check();
  expect(r.code, r.stdout + r.stderr).toBe(0);
  const lines = r.stdout.trim().split("\n");
  expect(lines).toHaveLength(1);
  expect(lines[0]).toBe("2 tickets, 0 own-check failures, 0 failures, 2 decided cards, 2 stories");
});

test("30.2 own-check failures name the ticket, the check and the field", async () => {
  cards();
  const body = ticket({
    cites: "c2",
    stories: "2",
    what: "one\ntwo\nthree\nsrc/foo/bar.ts is the file",
  });
  put({
    "01-first.md": ticket({ cites: "c1", stories: "1" }),
    "02-second.md": body,
    "03-third.md": ticket({ cites: "c1", stories: "1", touches: null }),
  });
  expect(body.split("\n")[11]).toContain("src/foo/bar.ts");
  const r = await check();
  expect(r.code).toBe(1);
  const lines = r.stdout.trim().split("\n");
  expect(lines.find((l) => l.startsWith("02-second.md")) ?? "").toMatch(/no-file-paths.*src\/foo\/bar\.ts.*line 12/);
  expect(lines.find((l) => l.startsWith("03-third.md")) ?? "").toMatch(/shape.*touches/);
  expect(lines.some((l) => l.startsWith("01-first.md"))).toBe(false);
  expect(lines[lines.length - 1]).toMatch(/^3 tickets, 2 own-check failures/);
});

test("30.3 an uncited decided card fails the set and a ghost does not count", async () => {
  w.seed(
    open("root", { title: "Root" }),
    decided("c1"),
    decided("c2"),
    decided("c3").filter((e: any) => e.type !== "node.accepted"),
    under("c1"),
    under("c2"),
    under("c3"),
  );
  // c3 is a ghost; c2 is the uncited real card
  put({
    "01-first.md": ticket({ cites: "root, c1", stories: "1" }),
    "02-second.md": ticket({ cites: "root, c1", stories: "2" }),
  });
  const r = await check();
  expect(r.code).toBe(1);
  const lines = r.stdout.trim().split("\n");
  const set = lines.filter((l) => l.startsWith("ticket set"));
  expect(set).toHaveLength(1);
  expect(set[0]).toContain("c2");
  expect(r.stdout).not.toContain("c3");
  expect(lines[lines.length - 1]).toMatch(/, 2 decided cards/);
});

test("30.4 a cycle in blocked_by names only the tickets on the cycle", async () => {
  w.seed(open("root", { title: "Root" }), decided("c1"), under("c1"));
  const t = (n: number, blockedBy = "") => ticket({ cites: "c1", stories: String(n), blockedBy });
  put(
    { "01-a.md": t(1), "02-b.md": t(2, "3"), "03-c.md": t(3, "2"), "04-d.md": t(4, "3") },
    specText(4),
  );
  const r = await check();
  expect(r.code).toBe(1);
  const lines = r.stdout.trim().split("\n");
  expect(lines.some((l) => l.startsWith("02-b.md") && l.includes("blocked_by"))).toBe(true);
  expect(lines.some((l) => l.startsWith("03-c.md") && l.includes("blocked_by"))).toBe(true);
  expect(lines.some((l) => l.startsWith("01-a.md"))).toBe(false);
  expect(lines.some((l) => l.startsWith("04-d.md"))).toBe(false);
});

test("30.5 a spec with no User stories heading is a malformed call", async () => {
  cards();
  put({ "01-first.md": ticket({ cites: "c1", stories: "1" }) }, "# Spec\n\nNo stories here.\n");
  const r = await check();
  expect(r.code).toBe(2);
  expect(r.stderr).toMatch(/User stories/);
  expect(r.stdout.trim()).toBe("");
});
