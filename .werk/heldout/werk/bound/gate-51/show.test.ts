import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as fx from "../src/map/mark-fixtures.ts";

const ROOT = join(import.meta.dirname, "..");
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** Writes the events as a log and runs `werk show` through the command line. */
async function show(events: unknown[], ...args: string[]) {
  const dir = mkdtempSync(join(tmpdir(), "heldout-"));
  dirs.push(dir);
  const log = join(dir, "log.jsonl");
  writeFileSync(log, `${events.flat().map((e) => JSON.stringify(e)).join("\n")}\n`);
  const child = Bun.spawn(["bun", "src/cli.ts", "show", ...args], {
    cwd: ROOT,
    env: { ...process.env, WERK_LOG: log },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, code };
}

const rollupLines = (s: string) => s.split("\n").filter((l) => /^\s*rollup:/.test(l));

test("11.1 rollup counts the card and its refines subtree", async () => {
  const r = await show(
    [
      fx.decided("root"),
      // The grandchild is decided while its parent is, then the parent reopens.
      fx.decided("c1", { parent: "root" }),
      fx.decided("g", { parent: "c1" }),
      fx.reopen("c1"),
      fx.open("c2", { parent: "root", status: "proto" }),
    ],
    "root",
  );
  expect(r.code).toBe(0);
  const lines = rollupLines(r.stdout);
  expect(lines).toEqual(["rollup: 4 cards: 1 open, 1 proto, 2 decided"]);
});

test("11.2 each incoming refines link shows the child's own rollup", async () => {
  const r = await show(
    [
      fx.decided("p"),
      fx.decided("c", { parent: "p" }),
      fx.decided("g2", { parent: "c" }),
      fx.open("g1", { parent: "c" }),
      fx.reopen("c"),
      fx.reopen("p"),
    ],
    "p",
  );
  expect(r.code).toBe(0);
  const linkLine = r.stdout.split("\n").find((l) => l.includes("<- refines"));
  expect(linkLine).toBeDefined();
  expect(linkLine).toContain("c  Title c");
  expect(linkLine).toContain("rollup: 3 cards:");
  expect(r.stdout.split("\n").filter((l) => l.startsWith("rollup:"))).toEqual([
    "rollup: 4 cards: 3 open, 0 proto, 1 decided",
  ]);
});

const quote = {
  type: "excerpt.quoted",
  id: "x:ex0",
  title: "seats are the unit",
  card: "x",
  conversation: "pricing",
  session: "s1",
  message: 2,
  start: 0,
  end: 18,
  speaker: "agent",
  said_at: "10:02",
};

test("11.3 options, excerpts and a proposed source print with their words", async () => {
  const r = await show(
    [
      fx.open("y"),
      fx.open("x"),
      fx.link("x", "y"),
      fx.ghost("x:opt0", { kind: "option", title: "Per call", why: "Too noisy" }),
      fx.link("x:opt0", "x", "alternative_to"),
      quote,
      fx.ghost("x:src0", { kind: "source", title: "Survey", why: "70% agree" }),
      fx.link("x", "x:src0", "supported_by"),
    ],
    "x",
  );
  expect(r.code).toBe(0);
  const out = r.stdout;
  expect(out).toContain("-> depends_on");
  expect(out).toContain("why: x takes y");
  expect(out.indexOf("Options:")).toBeGreaterThan(out.indexOf("-> depends_on"));
  expect(out).toMatch(/Options:\n\s+x:opt0\s+Per call.*\n\s+why not: Too noisy/);
  expect(out).toMatch(/Say:\n\s+agent: seats are the unit/);
  expect(out).toMatch(/Ev:\n\s+x:src0\s+Survey\s+proposed\n\s+finding: 70% agree/);
});

test("11.4 no options means no Options section", async () => {
  const r = await show(
    [
      fx.open("x"),
      quote,
      fx.ghost("x:src0", { kind: "source", title: "Survey", why: "70% agree" }),
      fx.link("x", "x:src0", "supported_by"),
    ],
    "x",
  );
  expect(r.code).toBe(0);
  expect(r.stdout).toContain("Say:");
  expect(r.stdout).toContain("Ev:");
  expect(r.stdout).not.toContain("Options");
});

test("11.5 show with no id prints the root card", async () => {
  const r = await show([fx.open("r"), fx.open("c", { parent: "r" }), fx.open("d", { parent: "c" })]);
  expect(r.code).toBe(0);
  expect(r.stdout).toContain("Title r");
  expect(r.stdout.split("\n")[0]).toContain("card r");
  expect(r.stdout).toContain("rollup: 3 cards: 3 open, 0 proto, 0 decided");
  const linkLine = r.stdout.split("\n").find((l) => l.includes("<- refines"));
  expect(linkLine).toContain("c  Title c");
  expect(linkLine).toContain("rollup: 2 cards:");
});
