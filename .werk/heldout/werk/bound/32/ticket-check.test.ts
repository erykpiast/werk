import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decided, ghost, open, reopen } from "../src/map/mark-fixtures.ts";
import { ticket } from "../src/tickets/fixtures.ts";
import { createProject, type Project, seedMap, werkIn } from "./cli-support.ts";

let project: Project;
let werk: ReturnType<typeof werkIn>;
beforeEach(() => {
  project = createProject();
  werk = werkIn(project);
});
afterEach(() => project.dispose());

const write = (path: string, text: string) => {
  mkdirSync(join(project.dir, path, ".."), { recursive: true });
  writeFileSync(join(project.dir, path), text);
};
const SPEC =
  "## User stories\n\n1. As a person, I want a.\n2. As a person, I want b.\n";
const check = () =>
  werk("ticket-check", "tickets", "--root", "root", "--spec", "spec.md");

/** An open root with two decided cards under it: the root is decided first, then reopened. */
const twoDecided = () => [
  decided("root", { title: "Root" }),
  decided("alpha", { title: "Alpha", parent: "root" }),
  decided("beta", { title: "Beta", parent: "root" }),
  reopen("root", { reason: "rejected", text: "x" }),
];

describe("30 ticket-check", () => {
  test("30.1 a folder of correct tickets passes", async () => {
    seedMap(project, twoDecided());
    write("spec.md", SPEC);
    write("tickets/01-a.md", ticket({ cites: "alpha", stories: "1" }));
    write(
      "tickets/02-b.md",
      ticket({ cites: "beta", stories: "2", blockedBy: "1" }),
    );
    const r = await check();
    const lines = r.stdout.trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe(
      "2 tickets, 0 own-check failures, 0 failures, 2 decided cards, 2 stories",
    );
    expect(r.code).toBe(0);
  });

  test("30.2 own-check failures name the ticket, the check and the field", async () => {
    seedMap(project, twoDecided());
    write("spec.md", SPEC);
    write("tickets/01-a.md", ticket({ cites: "alpha", stories: "1" }));
    write(
      "tickets/02-b.md",
      ticket({
        cites: "beta",
        stories: "2",
        what: "Line one.\nLine two.\nLine three.\nEdit src/loop.ts here.",
      }),
    );
    write(
      "tickets/03-c.md",
      ticket({ cites: "beta", stories: "2", touches: null }),
    );
    const text = await Bun.file(join(project.dir, "tickets/02-b.md")).text();
    expect(text.split("\n")[11]).toContain("src/loop.ts");
    const r = await check();
    const out = r.stdout;
    expect(out).toMatch(/02-b\.md: no-file-paths: .*src\/loop\.ts \(line 12\)/);
    expect(out).toMatch(/03-c\.md: shape: touches: /);
    expect(out).not.toContain("01-a.md:");
    const last = out.trim().split("\n").at(-1) as string;
    expect(last).toContain("3 tickets, 2 own-check failures");
    expect(r.code).toBe(1);
  });

  test("30.3 an uncited decided card fails the set, a ghost does not count", async () => {
    seedMap(project, [
      decided("root", { title: "Root" }),
      decided("alpha", { title: "Alpha", parent: "root" }),
      decided("beta", { title: "Beta", parent: "root" }),
      [
        ghost("spook", { title: "Spook", parent: "root" }),
        { type: "node.edited", id: "spook", who: "me", noBasis: "t" },
        { type: "criterion.added", id: "spook", form: "revisit" },
        { type: "node.decided", id: "spook" },
      ],
      reopen("root", { reason: "rejected", text: "x" }),
    ]);
    write("spec.md", SPEC);
    write("tickets/01-a.md", ticket({ cites: "root, alpha", stories: "1" }));
    write("tickets/02-b.md", ticket({ cites: "alpha", stories: "2" }));
    const r = await check();
    const lines = r.stdout.trim().split("\n");
    const set = lines.filter((l) => l.startsWith("ticket set"));
    expect(set).toHaveLength(1);
    expect(set[0]).toContain("beta");
    expect(r.stdout).not.toContain("spook");
    expect(lines.at(-1)).toContain("2 decided cards");
    expect(r.code).toBe(1);
  });

  test("30.4 a cycle in blocked_by names only the tickets on the cycle", async () => {
    seedMap(project, [
      decided("root", { title: "Root" }),
      decided("alpha", { title: "Alpha", parent: "root" }),
      decided("beta", { title: "Beta", parent: "root" }),
      decided("gamma", { title: "Gamma", parent: "root" }),
      decided("delta", { title: "Delta", parent: "root" }),
      reopen("root", { reason: "rejected", text: "x" }),
    ]);
    write("spec.md", "## User stories\n\n1. a\n2. b\n3. c\n4. d\n");
    write("tickets/01-a.md", ticket({ cites: "alpha", stories: "1" }));
    write(
      "tickets/02-b.md",
      ticket({ cites: "beta", stories: "2", blockedBy: "3" }),
    );
    write(
      "tickets/03-c.md",
      ticket({ cites: "gamma", stories: "3", blockedBy: "2" }),
    );
    write(
      "tickets/04-d.md",
      ticket({ cites: "delta", stories: "4", blockedBy: "3" }),
    );
    const r = await check();
    expect(r.stdout).toMatch(/02-b\.md: blocked_by:/);
    expect(r.stdout).toMatch(/03-c\.md: blocked_by:/);
    expect(r.stdout).not.toContain("01-a.md:");
    expect(r.stdout).not.toContain("04-d.md:");
    expect(r.code).toBe(1);
  });

  test("30.5 a spec with no User stories heading is a malformed call", async () => {
    seedMap(project, [...open("root", { title: "Root" })]);
    write("spec.md", "# Spec\n\nno stories here\n");
    write("tickets/01-a.md", ticket({ cites: "root", stories: "1" }));
    const r = await check();
    expect(r.stderr).toContain("User stories");
    expect(r.stdout).toBe("");
    expect(r.code).toBe(2);
  });
});
