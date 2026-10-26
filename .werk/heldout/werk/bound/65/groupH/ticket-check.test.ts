// Held-out steps 26.1–26.5: werk ticket-check.
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync, appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { freshProject, type Project } from "../../src/test/project.ts";

function seed(p: Project, type: string, payload: object) {
  const log = join(p.dir, ".werk", "log.jsonl");
  const n = readFileSync(log, "utf8").split("\n").filter(Boolean).length;
  appendFileSync(log, `${JSON.stringify({ seq: n + 1, at: "2026-10-01T00:00:00.000Z", actor: "you", type, payload })}\n`);
}

function ticket(o: { title?: string; cites: string; blocked?: string; stories: string; what?: string; checks?: string; pad?: string }) {
  const lines = [
    ...(o.title === undefined ? [] : [`title: ${o.title}`]),
    `cites: ${o.cites}`,
    `blocked_by: ${o.blocked ?? ""}`,
    `stories: ${o.stories}`,
    "touches: reader",
    "",
    "## What to build",
    o.what ?? "Build the reader of the log.\nIt reads every line.",
    "",
    "## Acceptance criteria",
    "- [ ] The reader reads every line.",
    "",
    "## Checks",
    o.checks ?? "",
    o.pad ?? "",
  ];
  return `${lines.join("\n")}\n`;
}

function spec(p: Project, stories: number[], heading = true) {
  const file = join(p.dir, "spec.md");
  writeFileSync(file, `# Spec\n\n${heading ? "## User stories" : "## Stories list"}\n\n${stories.map((n) => `${n}. As a person I want story ${n}.`).join("\n")}\n\n## Other\n`);
  return file;
}

test("26.1 valid tickets pass clean", async () => {
  const p = freshProject();
  seed(p, "node.added", { id: "root", kind: "card", title: "Root", status: "decided" });
  seed(p, "node.added", { id: "alpha", kind: "card", title: "Alpha", parent: "root", status: "decided" });
  seed(p, "node.added", { id: "beta", kind: "card", title: "Beta", parent: "root", status: "decided" });
  const s = spec(p, [1, 2]);
  const dir = join(p.dir, "tickets");
  mkdirSync(dir);
  writeFileSync(join(dir, "01-reader.md"), ticket({ title: "Reader", cites: "root, alpha", stories: "1", checks: "- `make test`" }));
  writeFileSync(join(dir, "02-writer.md"), ticket({ title: "Writer", cites: "#beta", blocked: "1", stories: "2", checks: "" }));
  const r = await p.werk(["ticket-check", dir, "--root", "root", "--spec", s]);
  console.log("26.1", r.code, JSON.stringify(r.out), JSON.stringify(r.err));
  const lines = r.out.trim().split("\n");
  expect(lines.length).toBe(1);
  expect(lines.at(-1)).toMatch(/\b0 failures\b/);
  expect(r.code).toBe(0);
});

test("26.2 file path and oversized ticket", async () => {
  const p = freshProject();
  seed(p, "node.added", { id: "root", kind: "card", title: "Root", status: "decided" });
  seed(p, "node.added", { id: "alpha", kind: "card", title: "Alpha", parent: "root", status: "decided" });
  const s = spec(p, [1, 2]);
  const dir = join(p.dir, "tickets");
  mkdirSync(dir);
  writeFileSync(join(dir, "01-reader.md"), ticket({ title: "Reader", cites: "root", stories: "1", checks: "- `make test`" }));
  writeFileSync(join(dir, "02-writer.md"), ticket({ title: "Writer", cites: "alpha", blocked: "1", stories: "2" }));
  const ok = await p.werk(["ticket-check", dir, "--root", "root", "--spec", s]);
  expect(ok.code).toBe(0);
  // Edit ticket 1: line 9 (inside What to build) names src/loop.ts, and it also names Makefile.
  const t1 = ticket({ title: "Reader", cites: "root", stories: "1", checks: "- `make test`", what: "Build the reader of the log.\nThe loop lives in src/loop.ts today.\nThe Makefile gets no new target." });
  expect(t1.split("\n")[8]).toContain("src/loop.ts");
  writeFileSync(join(dir, "01-reader.md"), t1);
  writeFileSync(join(dir, "02-writer.md"), ticket({ title: "Writer", cites: "alpha", blocked: "1", stories: "2", pad: "x".repeat(4100) }));
  const r = await p.werk(["ticket-check", dir, "--root", "root", "--spec", s]);
  console.log("26.2", r.code, r.out, r.err);
  const lines = r.out.trim().split("\n");
  const fail = lines.slice(0, -1);
  expect(fail.some((l) => l.startsWith("01-reader.md") && l.includes("no-file-paths") && l.includes("src/loop.ts") && /line 9\b/.test(l))).toBe(true);
  expect(fail.some((l) => l.includes("Makefile"))).toBe(false);
  expect(fail.some((l) => l.startsWith("02-writer.md") && l.includes("size"))).toBe(true);
  expect(lines.at(-1)).toMatch(/[1-9]\d* failures?/);
  expect(r.code).toBe(1);
});

test("26.3 set checks report uncited card, missing story, cycle, not a ghost", async () => {
  const p = freshProject();
  seed(p, "node.added", { id: "root", kind: "card", title: "Root", status: "decided" });
  seed(p, "node.added", { id: "alpha", kind: "card", title: "Alpha", parent: "root", status: "decided" });
  seed(p, "node.added", { id: "beta", kind: "card", title: "Beta", parent: "root", status: "decided" });
  seed(p, "node.proposed", { id: "ghosty", kind: "card", title: "Ghost", parent: "root", status: "decided" });
  const s = spec(p, [1, 2, 3]);
  const dir = join(p.dir, "tickets");
  mkdirSync(dir);
  writeFileSync(join(dir, "01-a.md"), ticket({ title: "A", cites: "root", stories: "1" }));
  writeFileSync(join(dir, "02-b.md"), ticket({ title: "B", cites: "alpha", blocked: "3", stories: "2" }));
  writeFileSync(join(dir, "03-c.md"), ticket({ title: "C", cites: "root", blocked: "2", stories: "2" }));
  const r = await p.werk(["ticket-check", dir, "--root", "root", "--spec", s]);
  console.log("26.3", r.code, r.out, r.err);
  const lines = r.out.trim().split("\n").slice(0, -1);
  const cited = lines.filter((l) => l.startsWith("ticket set") && l.includes("cards-cited"));
  expect(cited.length).toBe(1);
  expect(cited[0]).toContain("beta");
  const stories = lines.filter((l) => l.startsWith("ticket set") && l.includes("stories"));
  expect(stories.length).toBe(1);
  expect(stories[0]).toMatch(/\b3\b/);
  expect(lines.some((l) => l.includes("blocked_by") && l.includes("02-b.md") && l.includes("03-c.md"))).toBe(true);
  expect(r.out.includes("ghosty")).toBe(false);
  expect(r.code).toBe(1);
});

test("26.4 a ticket with no title fails alone, its cites do not count", async () => {
  const p = freshProject();
  seed(p, "node.added", { id: "root", kind: "card", title: "Root" });
  seed(p, "node.added", { id: "alpha", kind: "card", title: "Alpha", parent: "root", status: "decided" });
  const s = spec(p, [1]);
  const dir = join(p.dir, "tickets");
  mkdirSync(dir);
  writeFileSync(join(dir, "01-a.md"), ticket({ cites: "alpha", stories: "1" }));
  const r = await p.werk(["ticket-check", dir, "--root", "root", "--spec", s]);
  console.log("26.4", r.code, r.out, r.err);
  const lines = r.out.trim().split("\n").slice(0, -1);
  const own = lines.filter((l) => l.startsWith("01-a.md"));
  expect(own.length).toBe(1);
  expect(own[0]).toContain(": title:");
  expect(lines.some((l) => l.startsWith("ticket set") && l.includes("cards-cited") && l.includes("alpha"))).toBe(true);
  expect(lines.some((l) => l.startsWith("ticket set") && l.includes("stories") && /story 1\b/.test(l))).toBe(true);
  expect(r.code).toBe(1);
});

test("26.5 a malformed call exits 2", async () => {
  const p = freshProject();
  seed(p, "node.added", { id: "root", kind: "card", title: "Root", status: "decided" });
  const dir = join(p.dir, "tickets");
  mkdirSync(dir);
  writeFileSync(join(dir, "01-a.md"), ticket({ title: "A", cites: "root", stories: "1" }));
  const good = spec(p, [1]);
  const missing = await p.werk(["ticket-check", dir, "--root", "root", "--spec", join(p.dir, "nope.md")]);
  console.log("26.5 missing", missing.code, missing.out, missing.err);
  expect(`${missing.out}${missing.err}`).toMatch(/spec/i);
  expect(`${missing.out}${missing.err}`).toMatch(/no spec file|missing|not exist|not found/i);
  expect(missing.code).toBe(2);
  const noHeadFile = join(p.dir, "nohead.md");
  writeFileSync(noHeadFile, "# Spec\n\n## Goals\n\n1. Something.\n");
  expect((await p.werk(["ticket-check", dir, "--root", "root", "--spec", noHeadFile])).code).toBe(2);
  expect((await p.werk(["ticket-check", dir, "--root", "nobody", "--spec", good])).code).toBe(2);
  expect((await p.werk(["ticket-check", dir, "--spec", good])).code).toBe(2);
});
