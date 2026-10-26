import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ticket } from "../src/tickets/fixtures.ts";
import { card, ghost, lines, setupWerk } from "./support.ts";

const { p, werk, seed } = setupWerk();

const write = (path: string, text: string) => {
  const full = join(p().dir, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, text);
};

const SPEC12 =
  "# Spec\n\n## User stories\n\n1. As a user, I want one.\n2. As a user, I want two.\n";
const check = () =>
  werk("ticket-check", "tickets", "--root", "root", "--spec", "spec.md");

test("30.1 a folder of correct tickets passes", async () => {
  write("spec.md", SPEC12);
  seed(
    card("root", { title: "Root" }),
    card("a", { title: "A", status: "decided", parent: "root" }),
    card("b", { title: "B", status: "decided", parent: "root" }),
  );
  write("tickets/01-first.md", ticket({ cites: "a", stories: "1" }));
  write(
    "tickets/02-second.md",
    ticket({ cites: "b", stories: "2", blockedBy: "1" }),
  );
  const r = await check();
  const out = lines(r.stdout);
  expect(out).toHaveLength(1);
  const last = out.at(-1) as string;
  expect(last).toContain("2 tickets");
  expect(last).toContain("0 own-check failures");
  expect(last).toContain("0 failures");
  expect(last).toContain("2 decided cards");
  expect(last).toContain("2 stories");
  expect(r.code).toBe(0);
});

test("30.2 own-check failures name the ticket, the check and the field", async () => {
  write("spec.md", SPEC12);
  seed(
    card("root", { title: "Root" }),
    card("a", { title: "A", status: "decided", parent: "root" }),
  );
  write("tickets/01-ok.md", ticket({ cites: "a", stories: "1, 2" }));
  const pathLine = [
    "first line",
    "second line",
    "third line",
    "Edit src/loop.ts now.",
  ];
  const second = ticket({
    cites: "a",
    stories: "2",
    what: pathLine.join("\n"),
  });
  expect(second.split("\n")[11]).toContain("src/loop.ts");
  write("tickets/02-path.md", second);
  write(
    "tickets/03-notouch.md",
    ticket({ cites: "a", stories: "1", touches: null }),
  );
  const r = await check();
  const out = lines(r.stdout);
  const two = out.find((l) => l.startsWith("02-path.md"));
  expect(two).toContain("no-file-paths");
  expect(two).toContain("src/loop.ts");
  expect(two).toContain("line 12");
  const three = out.find((l) => l.startsWith("03-notouch.md"));
  expect(three).toContain("shape");
  expect(three).toContain("touches");
  expect(out.some((l) => l.startsWith("01-ok.md"))).toBe(false);
  const last = out.at(-1) as string;
  expect(last).toContain("3 tickets");
  expect(last).toContain("2 own-check failures");
  expect(r.code).toBe(1);
});

test("30.3 an uncited decided card fails the set, and a ghost does not count", async () => {
  write("spec.md", SPEC12.replace("2. As a user, I want two.\n", ""));
  seed(
    card("root", { title: "Root" }),
    ghost("ghost-card", { title: "Ghost", status: "decided", parent: "root" }),
    card("cited-card", { title: "Cited", status: "decided", parent: "root" }),
    card("lonely-card", { title: "Lonely", status: "decided", parent: "root" }),
  );
  write("tickets/01-a.md", ticket({ cites: "root, cited-card", stories: "1" }));
  const r = await check();
  const out = lines(r.stdout);
  const set = out.filter((l) => l.startsWith("ticket set"));
  expect(set).toHaveLength(1);
  expect(set[0]).toContain("lonely-card");
  expect(out.some((l) => l.includes("ghost-card"))).toBe(false);
  expect(out.at(-1)).toContain("2 decided cards");
  expect(r.code).toBe(1);
});

test("30.4 a cycle in blocked_by names only the tickets on the cycle", async () => {
  write("spec.md", "## User stories\n\n1. one\n2. two\n3. three\n4. four\n");
  seed(
    card("root", { title: "Root" }),
    card("a", { title: "A", status: "decided", parent: "root" }),
  );
  write("tickets/01-a.md", ticket({ cites: "a", stories: "1" }));
  write(
    "tickets/02-b.md",
    ticket({ cites: "a", stories: "2", blockedBy: "3" }),
  );
  write(
    "tickets/03-c.md",
    ticket({ cites: "a", stories: "3", blockedBy: "2" }),
  );
  write(
    "tickets/04-d.md",
    ticket({ cites: "a", stories: "4", blockedBy: "3" }),
  );
  const r = await check();
  const out = lines(r.stdout);
  expect(
    out.some((l) => l.startsWith("02-b.md") && l.includes("blocked_by")),
  ).toBe(true);
  expect(
    out.some((l) => l.startsWith("03-c.md") && l.includes("blocked_by")),
  ).toBe(true);
  expect(out.some((l) => l.startsWith("01-a.md"))).toBe(false);
  expect(out.some((l) => l.startsWith("04-d.md"))).toBe(false);
  expect(r.code).toBe(1);
});

test("30.5 a spec with no User stories heading is a malformed call", async () => {
  write("spec.md", "# Spec\n\nNo stories here.\n");
  seed(card("root", { title: "Root" }));
  write("tickets/01-a.md", ticket({ cites: "root", stories: "1" }));
  const r = await check();
  expect(r.stderr).toContain("User stories");
  expect(r.stdout.trim()).toBe("");
  expect(r.code).toBe(2);
});
