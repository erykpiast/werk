import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { ticket } from "../../src/tickets/fixtures.ts";
import { werkHarness } from "./h.ts";

const { project, werk, must, decide } = werkHarness();

/** A root card that is open again, with decided cards under it. */
async function tree(children: string[]) {
  await decide("rt", { title: "Root" });
  for (const c of children) await decide(c, { parent: "rt" });
  await must("reopen", "rt", "--reason", "postponed");
}

function folder(files: Record<string, string>) {
  const dir = join(project().dir, "tickets");
  mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
}

function spec(text = "# Spec\n\n## User stories\n\n1. First story\n2. Second story\n") {
  const p = join(project().dir, "spec.md");
  writeFileSync(p, text);
  return p;
}

const check = (dir = "tickets", sp = "spec.md") =>
  werk("ticket-check", dir, "--root", "rt", "--spec", sp);
const last = (out: string) => out.trimEnd().split("\n").at(-1);

test("30.1 a folder of correct tickets passes", async () => {
  await tree(["c1", "c2"]);
  folder({
    "01-first.md": ticket({ cites: "c1", stories: "1" }),
    "02-second.md": ticket({ cites: "c2", stories: "2", blockedBy: "1" }),
  });
  spec();
  const r = await check();
  expect(r.stdout.trimEnd().split("\n")).toHaveLength(1);
  expect(last(r.stdout)).toBe("2 tickets, 0 own-check failures, 0 failures, 2 decided cards, 2 stories");
  expect(r.code).toBe(0);
});

test("30.2 own-check failures name the ticket, the check and the field", async () => {
  await tree(["c1", "c2"]);
  folder({
    "01-ok.md": ticket({ cites: "c1", stories: "1" }),
    "02-path.md": ticket({
      cites: "c2",
      stories: "2",
      what: "Line one.\nLine two.\nLine three.\nChange src/app/main.ts to do it.",
    }),
    "03-notouches.md": ticket({ cites: "c2", stories: "2", touches: null }),
  });
  spec();
  const r = await check();
  const lines = r.stdout.trimEnd().split("\n");
  expect(lines.some((l) => l.startsWith("02-path.md") && l.includes("no-file-paths") && l.includes("src/app/main.ts") && l.includes("line 12"))).toBe(true);
  expect(lines.some((l) => l.startsWith("03-notouches.md") && l.includes("shape") && l.includes("touches"))).toBe(true);
  expect(lines.some((l) => l.startsWith("01-ok.md"))).toBe(false);
  expect(last(r.stdout)).toMatch(/^3 tickets, 2 own-check failures/);
  expect(r.code).toBe(1);
});

test("30.3 an uncited decided card fails the set and a ghost does not count", async () => {
  await tree(["c1", "c2"]);
  appendFileSync(project().logPath, `${JSON.stringify({ type: "node.proposed", id: "ghost1", kind: "card", title: "Ghost", status: "decided", parent: "rt" })}\n`);
  folder({
    "01-a.md": ticket({ cites: "rt, c1", stories: "1" }),
    "02-b.md": ticket({ cites: "c1", stories: "2" }),
  });
  spec();
  const r = await check();
  const lines = r.stdout.trimEnd().split("\n");
  const setLines = lines.filter((l) => l.startsWith("ticket set"));
  expect(setLines.filter((l) => l.includes("c2"))).toHaveLength(1);
  expect(lines.some((l) => l.includes("ghost1"))).toBe(false);
  expect(last(r.stdout)).toMatch(/, 2 decided cards,/);
  expect(r.code).toBe(1);
});

test("30.4 a cycle in blocked_by names only the tickets on the cycle", async () => {
  await tree(["c1", "c2"]);
  folder({
    "01-a.md": ticket({ cites: "c1", stories: "1" }),
    "02-b.md": ticket({ cites: "c2", stories: "2", blockedBy: "3" }),
    "03-c.md": ticket({ cites: "c1", stories: "1", blockedBy: "2" }),
    "04-d.md": ticket({ cites: "c2", stories: "2", blockedBy: "3" }),
  });
  spec();
  const r = await check();
  const lines = r.stdout.trimEnd().split("\n");
  const blk = (f: string) => lines.some((l) => l.startsWith(f) && l.includes("blocked_by"));
  expect(blk("02-b.md")).toBe(true);
  expect(blk("03-c.md")).toBe(true);
  expect(lines.some((l) => l.startsWith("01-a.md"))).toBe(false);
  expect(lines.some((l) => l.startsWith("04-d.md"))).toBe(false);
  expect(r.code).toBe(1);
});

test("30.5 a spec with no User stories heading is a malformed call", async () => {
  await tree(["c1", "c2"]);
  folder({
    "01-a.md": ticket({ cites: "c1", stories: "1" }),
    "02-b.md": ticket({ cites: "c2", stories: "2" }),
  });
  spec("# Spec\n\n## Goals\n\n1. Something\n");
  const r = await check();
  expect(r.stderr).toMatch(/no "User stories" heading/);
  expect(r.stdout).toBe("");
  expect(r.code).toBe(2);
});
