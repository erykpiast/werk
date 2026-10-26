import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decided, ghost, reopen } from "../../src/map/mark-fixtures.ts";
import { createProject, type Project } from "../../src/test-env/project.ts";
import { ticket } from "../../src/tickets/fixtures.ts";

const CLI = join(import.meta.dir, "..", "..", "src", "cli.ts");
let project: Project;
beforeEach(() => {
  project = createProject();
});
afterEach(() => project.dispose());

const seed = (events: unknown[]) =>
  writeFileSync(
    project.logPath,
    `${events.map((e) => JSON.stringify(e)).join("\n")}\n`,
  );
const write = (path: string, text: string) => {
  mkdirSync(join(project.dir, path, ".."), { recursive: true });
  writeFileSync(join(project.dir, path), text);
};
const run = () =>
  project.run([
    "bun",
    CLI,
    "ticket-check",
    "tickets",
    "--root",
    "root",
    "--spec",
    "spec.md",
  ]);
const lines = (s: string) => s.split("\n").filter((l) => l !== "");
const SPEC2 = "# Spec\n\n## User stories\n\n1. As a, I want a.\n2. As b, I want b.\n";

// A child is decided while its parent is decided, as the contract wants. Then the root is
// reopened, so the root is an open card and only its children count as decided cards.
const tree = (...children: unknown[][]) => [
  ...decided("root"),
  ...children.flat(),
  reopen("root"),
];
const child = (id: string) =>
  decided(id, { parent: "root" });

describe("ticket-check", () => {
  test("30.1 a folder of correct tickets passes", async () => {
    seed(tree(child("c1"), child("c2")));
    write("spec.md", SPEC2);
    write("tickets/01-a.md", ticket({ cites: "c1", stories: "1" }));
    write(
      "tickets/02-b.md",
      ticket({ cites: "c2", stories: "2", blockedBy: "1" }),
    );
    const r = await run();
    const out = lines(r.stdout);
    expect(out).toEqual([
      "2 tickets, 0 own-check failures, 0 failures, 2 decided cards, 2 stories",
    ]);
    expect(r.code).toBe(0);
  });

  test("30.2 own-check failures name the ticket, the check and the field", async () => {
    seed(tree(child("c1")));
    write("spec.md", "## User stories\n\n1. a\n");
    write("tickets/01-a.md", ticket({ cites: "c1", stories: "1" }));
    const pad = Array.from({ length: 3 }, () => "More words.").join("\n");
    const base = ticket({ cites: "c1", stories: "1", what: `${pad}\nEdit src/loop.ts now.` });
    const lns = base.split("\n");
    // put the path on line 12 exactly
    const at = lns.findIndex((l) => l.includes("src/loop.ts"));
    expect(at + 1).toBe(12);
    write("tickets/02-b.md", base);
    write("tickets/03-c.md", ticket({ cites: "c1", stories: "1", touches: null }));
    const r = await run();
    const out = lines(r.stdout);
    expect(out.some((l) => l.startsWith("02-b.md: no-file-paths") && l.includes("src/loop.ts") && l.includes("line 12"))).toBe(true);
    expect(out.some((l) => l.startsWith("03-c.md: shape: touches"))).toBe(true);
    expect(out.some((l) => l.startsWith("01-a.md"))).toBe(false);
    expect(out.at(-1)).toContain("3 tickets, 2 own-check failures");
    expect(r.code).toBe(1);
  });

  test("30.3 an uncited decided card fails the set and a ghost does not count", async () => {
    seed([
      ...decided("root"),
      ...decided("a", { parent: "root" }),
      ...decided("b", { parent: "root" }),
      ghost("g", { parent: "root", status: "decided" }),
      reopen("root"),
    ]);
    write("spec.md", "## User stories\n\n1. a\n");
    write("tickets/01-a.md", ticket({ cites: "root", stories: "1" }));
    write("tickets/02-b.md", ticket({ cites: "a", stories: "1" }));
    const r = await run();
    const out = lines(r.stdout);
    const set = out.filter((l) => l.startsWith("ticket set"));
    expect(set).toHaveLength(1);
    expect(set[0]).toContain("b");
    expect(out.some((l) => /\bg\b/.test(l.replace(/ticket set.*/, "")) )).toBe(false);
    expect(out.filter((l) => /(^|[ ,])g($|[ ,])/.test(l))).toEqual([]);
    expect(out.at(-1)).toContain("2 decided cards");
    expect(r.code).toBe(1);
  });

  test("30.4 a cycle in blocked_by names only the tickets on the cycle", async () => {
    seed(tree(child("c1")));
    write("spec.md", "## User stories\n\n1. a\n");
    write("tickets/01-a.md", ticket({ cites: "c1", stories: "1" }));
    write("tickets/02-b.md", ticket({ cites: "c1", stories: "1", blockedBy: "3" }));
    write("tickets/03-c.md", ticket({ cites: "c1", stories: "1", blockedBy: "2" }));
    write("tickets/04-d.md", ticket({ cites: "c1", stories: "1", blockedBy: "3" }));
    const r = await run();
    const out = lines(r.stdout);
    expect(out.some((l) => l.startsWith("02-b.md: blocked_by"))).toBe(true);
    expect(out.some((l) => l.startsWith("03-c.md: blocked_by"))).toBe(true);
    expect(out.some((l) => l.startsWith("01-a.md"))).toBe(false);
    expect(out.some((l) => l.startsWith("04-d.md"))).toBe(false);
    expect(r.code).toBe(1);
  });

  test("30.5 a spec with no User stories heading is a malformed call", async () => {
    seed(tree(child("c1")));
    write("spec.md", "# Spec\n\nNothing here.\n");
    write("tickets/01-a.md", ticket({ cites: "c1", stories: "1" }));
    const r = await run();
    expect(r.stderr).toContain("User stories");
    expect(r.stdout).toBe("");
    expect(r.code).toBe(2);
  });
});
