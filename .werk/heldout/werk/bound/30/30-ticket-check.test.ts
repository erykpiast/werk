import { expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { useProject } from "../src/test-env/project.ts";
import { card, seedLog, werk, write } from "./helpers.ts";

const project = useProject();

const SPEC2 = "# Spec\n\n## User stories\n\n1. As a person, I want a.\n2. As a person, I want b.\n";

function ticket(o: {
  cites?: string;
  blockedBy?: string;
  stories?: string;
  touches?: string | null;
  what?: string;
}) {
  const lines = [
    "title: A ticket",
    `cites: ${o.cites ?? "a"}`,
    `blocked_by: ${o.blockedBy ?? ""}`,
    `stories: ${o.stories ?? "1"}`,
  ];
  if (o.touches !== null) lines.push(`touches: ${o.touches ?? "map view"}`);
  lines.push(
    "",
    "## What to build",
    "",
    o.what ?? "A person sees the thing.",
    "",
    "## Acceptance criteria",
    "",
    "- [ ] The thing shows.",
    "",
    "## Checks",
    "",
    "- `make test`",
    "",
  );
  return lines.join("\n");
}

const check = (p: ReturnType<typeof project>, spec = "spec.md") =>
  werk(p, "ticket-check", "tickets", "--root", "root", "--spec", spec);

test("30.1 a folder of correct tickets passes", async () => {
  const p = project();
  seedLog(p, [...card("root", "Root", "open"), ...card("a", "A", "decided", { parent: "root" }), ...card("b", "B", "decided", { parent: "root" })]);
  write(p, "spec.md", SPEC2);
  write(p, "tickets/01-a.md", ticket({ cites: "a", stories: "1" }));
  write(p, "tickets/02-b.md", ticket({ cites: "b", stories: "2", blockedBy: "1" }));
  const r = await check(p);
  const lines = r.stdout.trim().split("\n");
  expect(lines).toHaveLength(1);
  expect(lines.at(-1)).toBe(
    "2 tickets, 0 own-check failures, 0 failures, 2 decided cards, 2 stories",
  );
  expect(r.code).toBe(0);
});

test("30.2 own-check failures name the ticket, the check and the field", async () => {
  const p = project();
  seedLog(p, [...card("root", "Root", "decided")]);
  write(p, "spec.md", "## User stories\n\n1. a\n");
  write(p, "tickets/01-a.md", ticket({ cites: "root" }));
  const filler = Array.from({ length: 3 }, (_, i) => `Filler ${i}.`).join("\n");
  const body = `${filler}\nEdit src/loop.ts here.`;
  write(p, "tickets/02-b.md", ticket({ what: body }));
  write(p, "tickets/03-c.md", ticket({ touches: null }));
  const r = await check(p);
  const lines = r.stdout.trim().split("\n");
  const two = lines.find((l) => l.startsWith("02-b.md"));
  expect(two).toContain("no-file-paths");
  expect(two).toContain("src/loop.ts");
  // line number of the path in the file
  const text = await Bun.file(join(p.dir, "tickets/02-b.md")).text();
  const at = text.split("\n").findIndex((l) => l.includes("src/loop.ts")) + 1;
  expect(at).toBe(12);
  expect(two).toContain("line 12");
  const three = lines.find((l) => l.startsWith("03-c.md"));
  expect(three).toContain("shape");
  expect(three).toContain("touches");
  expect(lines.some((l) => l.startsWith("01-a.md"))).toBe(false);
  expect(lines.at(-1)).toMatch(/^3 tickets, 2 own-check failures/);
  expect(r.code).toBe(1);
});

test("30.3 an uncited decided card fails the set, a ghost does not count", async () => {
  const p = project();
  seedLog(p, [
    ...card("root", "Root", "open"),
    ...card("a", "A", "decided", { parent: "root" }),
    ...card("c", "Uncited real", "decided", { parent: "root" }),
    { type: "node.proposed", id: "ghost", kind: "card", title: "Ghost", status: "decided", parent: "root" },
  ]);
  write(p, "spec.md", "## User stories\n\n1. a\n");
  write(p, "tickets/01-a.md", ticket({ cites: "root, a" }));
  const r = await check(p);
  const lines = r.stdout.trim().split("\n");
  const set = lines.filter((l) => l.startsWith("ticket set"));
  expect(set).toHaveLength(1);
  expect(set[0]).toContain("c");
  expect(set[0]).not.toContain("ghost");
  expect(r.stdout).not.toContain("ghost");
  expect(lines.at(-1)).toContain("2 decided cards");
  expect(r.code).toBe(1);
});

test("30.4 a cycle in blocked_by names only the tickets on the cycle", async () => {
  const p = project();
  seedLog(p, [...card("root", "Root", "decided")]);
  write(p, "spec.md", "## User stories\n\n1. a\n");
  write(p, "tickets/01-a.md", ticket({ cites: "root" }));
  write(p, "tickets/02-b.md", ticket({ blockedBy: "3" }));
  write(p, "tickets/03-c.md", ticket({ blockedBy: "2" }));
  write(p, "tickets/04-d.md", ticket({ blockedBy: "3" }));
  const r = await check(p);
  const lines = r.stdout.trim().split("\n");
  expect(lines.some((l) => l.startsWith("02-b.md") && l.includes("blocked_by"))).toBe(true);
  expect(lines.some((l) => l.startsWith("03-c.md") && l.includes("blocked_by"))).toBe(true);
  expect(lines.some((l) => l.startsWith("01-a.md"))).toBe(false);
  expect(lines.some((l) => l.startsWith("04-d.md"))).toBe(false);
  expect(r.code).toBe(1);
});

test("30.5 a spec with no User stories heading is a malformed call", async () => {
  const p = project();
  seedLog(p, [...card("root", "Root", "decided")]);
  write(p, "spec.md", "# Spec\n\nNo stories here.\n");
  write(p, "tickets/01-a.md", ticket({ cites: "root" }));
  const r = await check(p);
  expect(r.stderr + r.stdout).toContain("User stories");
  expect(r.stdout).not.toMatch(/failures/);
  expect(r.stdout.trim()).toBe("");
  expect(r.code).toBe(2);
});
