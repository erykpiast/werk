// Held-out steps 26.1-26.5: werk ticket-check on a folder of tickets.
import { expect, test } from "bun:test";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../src/test/project.ts";

function seed(p: Project, type: string, payload: object): void {
  const log = join(p.dir, ".werk", "log.jsonl");
  const n = readFileSync(log, "utf8").split("\n").filter(Boolean).length;
  appendFileSync(log, `${JSON.stringify({ seq: n + 1, at: "t", actor: "you", type, payload })}\n`);
}

function decided(p: Project, id: string, parent?: string): void {
  seed(p, "node.added", { id, kind: "card", title: `Card ${id}`, ...(parent ? { parent } : {}) });
  seed(p, "node.decided", { id });
}

type T = { title?: string; cites: string; blocked?: string; stories: string; what?: string; checks?: string; pad?: number };
function ticket(t: T): string {
  return [
    ...(t.title === undefined ? [] : [`title: ${t.title}`]),
    `cites: ${t.cites}`,
    `blocked_by: ${t.blocked ?? ""}`,
    `stories: ${t.stories}`,
    "touches: loop",
    "",
    "## What to build",
    "",
    t.what ?? "Build the thing that the cited cards decide.",
    "",
    "## Acceptance criteria",
    "",
    "- [ ] The thing works.",
    "",
    "## Checks",
    "",
    t.checks ?? "",
    ...(t.pad ? ["", "x".repeat(t.pad)] : []),
    "",
  ].join("\n");
}

function spec(p: Project, stories: number[], heading = "## User stories"): string {
  const file = join(p.dir, "spec.md");
  writeFileSync(file, ["# Spec", "", heading, "", ...stories.map((s) => `${s}. As a person I can do ${s}.`), ""].join("\n"));
  return file;
}

function folder(p: Project, files: Record<string, string>): string {
  const dir = join(p.dir, "tickets");
  mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
}

const failureLines = (out: string) => out.split("\n").filter((l) => l !== "" && !/^\d+ tickets?, /.test(l));
const countLine = (out: string) => out.trim().split("\n").at(-1) ?? "";

test("26.1 valid hand-written tickets pass clean", async () => {
  const p = freshProject();
  seed(p, "node.added", { id: "root", kind: "card", title: "Root" });
  seed(p, "node.decided", { id: "root" });
  decided(p, "alpha", "root");
  decided(p, "beta", "root");
  const s = spec(p, [1, 2]);
  const dir = folder(p, {
    "01-first.md": ticket({ title: "First", cites: "root, alpha", stories: "1", checks: "- `make test`" }),
    "02-second.md": ticket({ title: "Second", cites: "#beta", blocked: "1", stories: "2", checks: "" }),
  });
  const r = await p.werk(["ticket-check", dir, "--root", "root", "--spec", s]);
  console.log(r);
  expect(failureLines(r.out)).toEqual([]);
  expect(countLine(r.out)).toMatch(/\b0 failures\b/);
  expect(r.code).toBe(0);
});

test("26.2 file path and oversized ticket are named", async () => {
  const p = freshProject();
  seed(p, "node.added", { id: "root", kind: "card", title: "Root" });
  decided(p, "alpha", "root");
  decided(p, "beta", "root");
  const s = spec(p, [1, 2]);
  const good1 = ticket({ title: "First", cites: "alpha", stories: "1", checks: "- `make test`" });
  const good2 = ticket({ title: "Second", cites: "beta", blocked: "1", stories: "2" });
  const dir = folder(p, { "01-first.md": good1, "02-second.md": good2 });
  const before = await p.werk(["ticket-check", dir, "--root", "root", "--spec", s]);
  expect(before.code).toBe(0);

  // Line 9 of the file is the text line of What to build (title..touches=1-5, blank, heading 7, blank 8).
  const edited = good1.replace(
    "Build the thing that the cited cards decide.",
    "Change src/loop.ts so the loop retries, and update the Makefile.",
  );
  expect(edited.split("\n")[8]).toContain("src/loop.ts");
  writeFileSync(join(dir, "01-first.md"), edited);
  writeFileSync(join(dir, "02-second.md"), ticket({ title: "Second", cites: "beta", blocked: "1", stories: "2", pad: 4100 }));
  expect(readFileSync(join(dir, "02-second.md"), "utf8").length).toBeGreaterThan(4000);

  const r = await p.werk(["ticket-check", dir, "--root", "root", "--spec", s]);
  console.log(r);
  const lines = failureLines(r.out);
  expect(lines.some((l) => l.startsWith("01-first.md") && l.includes("no-file-paths") && l.includes("src/loop.ts") && /line 9\b/.test(l))).toBe(true);
  expect(lines.some((l) => l.includes("Makefile"))).toBe(false);
  expect(lines.some((l) => l.startsWith("02-second.md") && l.includes("size"))).toBe(true);
  expect(countLine(r.out)).toMatch(/[1-9]\d* failures?/);
  expect(r.code).toBe(1);
});

test("26.3 set checks: uncited card, missing story, cycle, but not a ghost", async () => {
  const p = freshProject();
  seed(p, "node.added", { id: "root", kind: "card", title: "Root" });
  decided(p, "alpha", "root");
  decided(p, "beta", "root");
  const g = await p.werk(["add", "ghosty", "--title", "A ghost", "--parent", "root"]);
  expect(g.code).toBe(0);
  const s = spec(p, [1, 2, 3]);
  const dir = folder(p, {
    "01-one.md": ticket({ title: "One", cites: "alpha", stories: "1" }),
    "02-two.md": ticket({ title: "Two", cites: "alpha", blocked: "3", stories: "2" }),
    "03-three.md": ticket({ title: "Three", cites: "alpha", blocked: "2", stories: "1" }),
  });
  const r = await p.werk(["ticket-check", dir, "--root", "root", "--spec", s]);
  console.log(r);
  const lines = failureLines(r.out);
  const cited = lines.filter((l) => l.startsWith("ticket set") && l.includes("cards-cited"));
  expect(cited.length).toBe(1);
  expect(cited[0]).toContain("beta");
  const stories = lines.filter((l) => l.startsWith("ticket set") && l.includes("stories"));
  expect(stories.length).toBe(1);
  expect(stories[0]).toMatch(/\b3\b/);
  const cycle = lines.filter((l) => l.includes("blocked_by"));
  expect(cycle.some((l) => l.includes("02-two.md") && l.includes("03-three.md"))).toBe(true);
  expect(lines.some((l) => l.includes("ghosty"))).toBe(false);
  expect(r.code).toBe(1);
});

test("26.4 a ticket with no title fails alone", async () => {
  const p = freshProject();
  seed(p, "node.added", { id: "root", kind: "card", title: "Root" });
  decided(p, "alpha", "root");
  const s = spec(p, [1]);
  const dir = folder(p, { "01-notitle.md": ticket({ cites: "alpha", stories: "1" }) });
  const r = await p.werk(["ticket-check", dir, "--root", "root", "--spec", s]);
  console.log(r);
  const lines = failureLines(r.out);
  const own = lines.filter((l) => l.startsWith("01-notitle.md"));
  expect(own.some((l) => l.includes(": title:"))).toBe(true);
  expect(own.filter((l) => !l.includes(": title:"))).toEqual([]);
  expect(lines.some((l) => l.startsWith("ticket set") && l.includes("cards-cited") && l.includes("alpha"))).toBe(true);
  expect(lines.some((l) => l.startsWith("ticket set") && l.includes("stories") && /\b1\b/.test(l))).toBe(true);
  expect(r.code).toBe(1);
});

test("26.5 a malformed call never reads as a pass", async () => {
  const p = freshProject();
  seed(p, "node.added", { id: "root", kind: "card", title: "Root" });
  decided(p, "alpha", "root");
  const dir = folder(p, { "01-one.md": ticket({ title: "One", cites: "alpha", stories: "1" }) });
  const missing = await p.werk(["ticket-check", dir, "--root", "root", "--spec", join(p.dir, "nope.md")]);
  console.log(missing);
  expect(`${missing.out}${missing.err}`).toMatch(/spec/i);
  expect(`${missing.out}${missing.err}`).toMatch(/no spec file|missing|not exist|does not/i);
  expect(missing.code).toBe(2);
  const noHeading = spec(p, [1], "## Stories");
  const r2 = await p.werk(["ticket-check", dir, "--root", "root", "--spec", noHeading]);
  expect(r2.code).toBe(2);
  const good = spec(p, [1]);
  const r3 = await p.werk(["ticket-check", dir, "--root", "no-such-card", "--spec", good]);
  expect(r3.code).toBe(2);
  const r4 = await p.werk(["ticket-check", dir, "--spec", good]);
  expect(r4.code).toBe(2);
});
