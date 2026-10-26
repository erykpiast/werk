import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, setDefaultTimeout, test } from "bun:test";
import { ticket } from "../src/tickets/fixtures.ts";
import { createProject, decide, makeWerk, real, type W } from "./support.ts";

setDefaultTimeout(120000);

type P = ReturnType<typeof createProject>;
async function withW<T>(body: (w: W, p: P, write: (path: string, text: string) => void) => Promise<T>) {
  const p = createProject();
  try {
    const write = (path: string, text: string) => {
      mkdirSync(join(p.dir, path, ".."), { recursive: true });
      writeFileSync(join(p.dir, path), text);
    };
    return await body(makeWerk(p), p, write);
  } finally {
    await p.dispose();
  }
}
const check = (w: W, ...extra: string[]) =>
  w("ticket-check", "tickets", "--root", "root", "--spec", "spec.md", ...extra);

/** root (reopened, so not decided) with decided children. */
async function mapWith(w: W, ids: string[], ghostId?: string) {
  await real(w, "root", "Root");
  await decide(w, "root");
  for (const id of ids) {
    await real(w, id, `Card ${id}`, { parent: "root" });
    await decide(w, id);
  }
  if (ghostId) {
    expect((await w("add", ghostId, "--title", "Ghost card", "--parent", "root")).code).toBe(0);
    await decide(w, ghostId);
  }
  expect((await w("reopen", "root", "--reason", "invalidated", "--why", "x")).code).toBe(0);
}
const lastLine = (s: string) => s.trim().split("\n").at(-1) as string;

test("30.1 a folder of correct tickets passes", () =>
  withW(async (w, _p, write) => {
    await mapWith(w, ["c1", "c2"]);
    write("spec.md", "## User stories\n\n1. As a person, I want a.\n2. As a person, I want b.\n");
    write("tickets/01-a.md", ticket({ cites: "c1", stories: "1" }));
    write("tickets/02-b.md", ticket({ cites: "c2", stories: "2", blockedBy: "1" }));
    const r = await check(w);
    const lines = r.stdout.trim().split("\n");
    expect(lines.length).toBe(1);
    expect(lastLine(r.stdout)).toBe("2 tickets, 0 own-check failures, 0 failures, 2 decided cards, 2 stories");
    expect(r.code).toBe(0);
  }));

test("30.2 own-check failures name the ticket, the check and the field", () =>
  withW(async (w, _p, write) => {
    await mapWith(w, ["c1"]);
    write("spec.md", "## User stories\n\n1. a\n");
    write("tickets/01-a.md", ticket({ cites: "c1", stories: "1" }));
    write("tickets/02-b.md", ticket({ cites: "c1", what: "Do a.\nDo b.\nDo c.\nEdit src/loop.ts now." }));
    write("tickets/03-c.md", ticket({ cites: "c1", touches: null }));
    const r = await check(w);
    const lines = r.stdout.trim().split("\n");
    const second = lines.find((l) => l.includes("02-b.md"));
    expect(second).toBeDefined();
    expect(second).toMatch(/file-paths|no-file-paths|paths/i);
    expect(second).toContain("src/loop.ts");
    expect(second).toMatch(/line 12/);
    const third = lines.find((l) => l.includes("03-c.md"));
    expect(third).toMatch(/shape/);
    expect(third).toMatch(/touches/);
    expect(lines.some((l) => l.includes("01-a.md"))).toBe(false);
    expect(lastLine(r.stdout)).toMatch(/^3 tickets, 2 own-check failures/);
    expect(r.code).toBe(1);
  }));

test("30.3 an uncited decided card fails the set, a ghost does not count", () =>
  withW(async (w, _p, write) => {
    await mapWith(w, ["c1", "c2"], "ghost1");
    write("spec.md", "## User stories\n\n1. a\n2. b\n");
    write("tickets/01-a.md", ticket({ cites: "root", stories: "1" }));
    write("tickets/02-b.md", ticket({ cites: "c1", stories: "2" }));
    const r = await check(w);
    const lines = r.stdout.trim().split("\n");
    const set = lines.filter((l) => l.startsWith("ticket set"));
    expect(set.length).toBe(1);
    expect(set[0]).toContain("c2");
    expect(r.stdout).not.toContain("ghost1");
    expect(lastLine(r.stdout)).toMatch(/2 decided cards/);
    expect(r.code).toBe(1);
  }));

test("30.4 a cycle names only the tickets on it", () =>
  withW(async (w, _p, write) => {
    await mapWith(w, ["c1"]);
    write("spec.md", "## User stories\n\n1. a\n");
    write("tickets/01-a.md", ticket({ cites: "c1", stories: "1" }));
    write("tickets/02-b.md", ticket({ cites: "c1", blockedBy: "3" }));
    write("tickets/03-c.md", ticket({ cites: "c1", blockedBy: "2" }));
    write("tickets/04-d.md", ticket({ cites: "c1", blockedBy: "3" }));
    const r = await check(w);
    const lines = r.stdout.trim().split("\n");
    const bb = (f: string) => lines.some((l) => l.includes(f) && l.includes("blocked_by"));
    expect(bb("02-b.md")).toBe(true);
    expect(bb("03-c.md")).toBe(true);
    expect(lines.some((l) => l.includes("01-a.md"))).toBe(false);
    expect(lines.some((l) => l.includes("04-d.md"))).toBe(false);
    expect(r.code).toBe(1);
  }));

test("30.5 a spec with no User stories heading is a malformed call", () =>
  withW(async (w, _p, write) => {
    await mapWith(w, ["c1"]);
    write("spec.md", "# Spec\n\nNothing here.\n");
    write("tickets/01-a.md", ticket({ cites: "c1", stories: "1" }));
    const r = await check(w);
    expect(r.stderr + r.stdout).toMatch(/no "User stories" heading|no User stories heading/);
    expect(r.stdout.trim()).toBe("");
    expect(r.code).toBe(2);
  }));
