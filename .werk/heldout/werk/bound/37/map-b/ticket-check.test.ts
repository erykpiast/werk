import { afterEach, beforeEach, expect, test } from "bun:test";
import { decided, ghost, link, open } from "../../src/map/mark-fixtures.ts";
import { createProject, type Project } from "../../src/test-env/project.ts";
import { ticket } from "../../src/tickets/fixtures.ts";
import { seed, werk, write } from "./helpers.ts";

let project: Project;
beforeEach(() => {
  project = createProject();
});
afterEach(() => project.dispose());

const SPEC2 = "# Spec\n\n## User stories\n\n1. As a person, a.\n2. As a person, b.\n";
const check = () =>
  werk(project, "ticket-check", "tickets", "--root", "root", "--spec", "spec.md");

test("30.1 a folder of correct tickets passes", async () => {
  seed(
    project,
    decided("root", { title: "Root" }),
    decided("c1", { title: "C1", parent: "root" }),
    decided("c2", { title: "C2", parent: "root" }),
  );
  write(project, "spec.md", SPEC2);
  write(project, "tickets/01-a.md", ticket({ cites: "c1, root", stories: "1" }));
  write(
    project,
    "tickets/02-b.md",
    ticket({ cites: "c2", stories: "2", blockedBy: "1" }),
  );
  const r = await check();
  expect(r.code).toBe(0);
  const lines = r.stdout.trim().split("\n");
  expect(lines).toHaveLength(1);
  expect(lines[0]).toContain("2 tickets");
  expect(lines[0]).toContain("0 own-check failures");
  expect(lines[0]).toContain("0 failures");
  expect(lines[0]).toContain("3 decided cards");
  expect(lines[0]).toContain("2 stories");
});

test("30.2 own-check failures name ticket, check and field", async () => {
  seed(project, decided("root", { title: "Root" }));
  write(project, "spec.md", "## User stories\n\n1. a\n");
  write(project, "tickets/01-a.md", ticket({ cites: "root" }));
  const lines12 = [
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
    "eleven",
  ];
  const body = [...lines12, "Edit src/loop.ts now."].join("\n");
  write(
    project,
    "tickets/02-b.md",
    `title: B\ncites: root\nblocked_by:\nstories: 1\ntouches: x\n\n## What to build\n\n${body}\n\n## Acceptance criteria\n\n- [ ] ok\n\n## Checks\n\n- \`make test\`\n`,
  );
  write(project, "tickets/03-c.md", ticket({ cites: "root", touches: null }));
  const r = await check();
  expect(r.code).toBe(1);
  const out = r.stdout.split("\n");
  const second = out.find((l) => l.startsWith("02-b.md"));
  expect(second).toContain("no-file-paths");
  expect(second).toContain("src/loop.ts");
  const lineNo = (second ?? "").match(/line (\d+)/)?.[1];
  const actual = `title: B\ncites: root\nblocked_by:\nstories: 1\ntouches: x\n\n## What to build\n\n${body}`
    .split("\n")
    .findIndex((l) => l.includes("src/loop.ts")) + 1;
  expect(Number(lineNo)).toBe(actual);
  const third = out.find((l) => l.startsWith("03-c.md"));
  expect(third).toContain("shape");
  expect(third).toContain("touches");
  expect(out.some((l) => l.startsWith("01-a.md"))).toBe(false);
  const last = out.filter((l) => l.trim() !== "").at(-1);
  expect(last).toContain("3 tickets");
  expect(last).toContain("2 own-check failures");
});

test("30.3 an uncited real decided card fails the set, a ghost does not count", async () => {
  seed(
    project,
    open("root", { title: "Root" }),
    decided("c1", { title: "C1" }),
    decided("c2", { title: "C2" }),
    link("c1", "root", "refines"),
    link("c2", "root", "refines"),
    ghost("gh", { title: "Ghost", parent: "root", status: "decided" }),
  );
  write(project, "spec.md", "## User stories\n\n1. a\n2. b\n");
  write(project, "tickets/01-a.md", ticket({ cites: "root, c1", stories: "1" }));
  write(project, "tickets/02-b.md", ticket({ cites: "root", stories: "2" }));
  const r = await check();
  expect(r.code).toBe(1);
  const out = r.stdout.split("\n");
  const set = out.filter((l) => l.startsWith("ticket set"));
  expect(set).toHaveLength(1);
  expect(set[0]).toContain("c2");
  expect(r.stdout).not.toContain("gh");
  expect(out.filter((l) => l.trim() !== "").at(-1)).toContain("2 decided cards");
});

test("30.4 a cycle in blocked_by names only the tickets on it", async () => {
  seed(project, decided("root", { title: "Root" }));
  write(project, "spec.md", "## User stories\n\n1. a\n");
  write(project, "tickets/01-a.md", ticket({ cites: "root", stories: "1" }));
  write(project, "tickets/02-b.md", ticket({ cites: "root", blockedBy: "3" }));
  write(project, "tickets/03-c.md", ticket({ cites: "root", blockedBy: "2" }));
  write(project, "tickets/04-d.md", ticket({ cites: "root", blockedBy: "3" }));
  const r = await check();
  expect(r.code).toBe(1);
  const out = r.stdout.split("\n");
  expect(out.some((l) => l.startsWith("02-b.md") && l.includes("blocked_by"))).toBe(true);
  expect(out.some((l) => l.startsWith("03-c.md") && l.includes("blocked_by"))).toBe(true);
  expect(out.some((l) => l.startsWith("01-a.md"))).toBe(false);
  expect(out.some((l) => l.startsWith("04-d.md"))).toBe(false);
});

test("30.5 a spec with no User stories heading is a malformed call", async () => {
  seed(project, decided("root", { title: "Root" }));
  write(project, "spec.md", "# Spec\n\nNothing here.\n");
  write(project, "tickets/01-a.md", ticket({ cites: "root" }));
  const r = await check();
  expect(r.code).toBe(2);
  expect(r.stderr + r.stdout).toContain("User stories");
  expect(r.stdout.trim()).toBe("");
});
