import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ticket } from "../../src/tickets/fixtures.ts";
import { decidedRaw, ghost, open, seed, useProject } from "./support.ts";

const ctx = useProject();
const write = (path: string, text: string) => {
  const full = join(ctx.project.dir, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, text);
};
const check = () => ctx.werk("ticket-check", "tickets", "--root", "root", "--spec", "spec.md");
const SPEC = "# Spec\n\n## User stories\n\n1. As a person, I want one.\n2. As a person, I want two.\n";
const lastLine = (text: string) => text.trim().split("\n").at(-1);

test("30.1 a folder of correct tickets passes", async () => {
  seed(ctx.project, open("root", { title: "Root" }), decidedRaw("a", { parent: "root" }), decidedRaw("b", { parent: "root" }));
  write("spec.md", SPEC);
  write("tickets/01-first.md", ticket({ cites: "a", stories: "1", blockedBy: "" }));
  write("tickets/02-second.md", ticket({ cites: "b", stories: "2", blockedBy: "1" }));
  const result = await check();
  expect(result.stdout.trim().split("\n")).toHaveLength(1);
  expect(lastLine(result.stdout)).toBe("2 tickets, 0 own-check failures, 0 failures, 2 decided cards, 2 stories");
  expect(result.code).toBe(0);
});

test("30.2 own-check failures name the ticket, the check and the field", async () => {
  seed(ctx.project, open("root", { title: "Root" }), decidedRaw("a", { parent: "root" }));
  write("spec.md", "## User stories\n\n1. one\n");
  write("tickets/01-ok.md", ticket({ cites: "a", stories: "1" }));
  // The path sits on line 12 of the ticket file.
  const body = "Build it.\n\n\nEdit src/loop/run.ts now.";
  const second = ticket({ cites: "", stories: "", what: body });
  expect(second.split("\n")[11]).toContain("src/loop/run.ts");
  write("tickets/02-path.md", second);
  write("tickets/03-no-touches.md", ticket({ touches: null }));
  const result = await check();
  const lines = result.stdout.trim().split("\n");
  const line2 = lines.find((l) => l.startsWith("02-path.md"));
  expect(line2).toContain("no-file-paths");
  expect(line2).toContain("src/loop/run.ts");
  expect(line2).toContain("line 12");
  const line3 = lines.find((l) => l.startsWith("03-no-touches.md"));
  expect(line3).toContain("shape");
  expect(line3).toContain("touches");
  expect(lines.some((l) => l.startsWith("01-ok.md"))).toBe(false);
  expect(lastLine(result.stdout)).toMatch(/^3 tickets, 2 own-check failures/);
  expect(result.code).toBe(1);
});

test("30.3 an uncited decided card fails the set and a ghost does not count", async () => {
  seed(
    ctx.project,
    open("root", { title: "Root" }),
    decidedRaw("cited", { parent: "root" }),
    decidedRaw("uncited", { parent: "root" }),
    ghost("phantom", { status: "decided", parent: "root" }),
  );
  write("spec.md", "## User stories\n\n1. one\n");
  write("tickets/01-a.md", ticket({ cites: "root, cited", stories: "1" }));
  const result = await check();
  const setLines = result.stdout.trim().split("\n").filter((l) => l.startsWith("ticket set"));
  expect(setLines).toHaveLength(1);
  expect(setLines[0]).toContain("uncited");
  expect(result.stdout).not.toContain("phantom");
  expect(lastLine(result.stdout)).toContain("2 decided cards");
  expect(result.code).toBe(1);
});

test("30.4 a blocked_by cycle names only the tickets on the cycle", async () => {
  seed(ctx.project, open("root", { title: "Root" }), decidedRaw("a", { parent: "root" }));
  write("spec.md", "## User stories\n\n1. one\n2. two\n3. three\n4. four\n");
  write("tickets/01-a.md", ticket({ cites: "a", stories: "1" }));
  write("tickets/02-b.md", ticket({ stories: "2", cites: "", blockedBy: "3" }));
  write("tickets/03-c.md", ticket({ stories: "3", cites: "", blockedBy: "2" }));
  write("tickets/04-d.md", ticket({ stories: "4", cites: "", blockedBy: "3" }));
  const result = await check();
  const lines = result.stdout.trim().split("\n");
  const failure = (file: string) => lines.some((l) => l.startsWith(file) && l.includes("blocked_by"));
  expect(failure("02-b.md")).toBe(true);
  expect(failure("03-c.md")).toBe(true);
  expect(lines.some((l) => l.startsWith("01-a.md"))).toBe(false);
  expect(lines.some((l) => l.startsWith("04-d.md"))).toBe(false);
  expect(result.code).toBe(1);
});

test("30.5 a spec with no User stories heading is a malformed call", async () => {
  seed(ctx.project, open("root", { title: "Root" }));
  write("spec.md", "# Spec\n\nNo stories here.\n");
  write("tickets/01-a.md", ticket({ cites: "", stories: "1" }));
  const result = await check();
  expect(result.stderr).toContain("User stories");
  expect(result.stdout).not.toContain("tickets,");
  expect(result.stdout.trim()).toBe("");
  expect(result.code).toBe(2);
});
