// werk/30: `werk ticket-check` judges a folder of hand-written tickets.
import { expect, test } from "bun:test";
import { ticket } from "../src/tickets/fixtures.ts";
import { card, useWerk } from "./support.ts";

const w = useWerk();
const SPEC2 = "# Spec\n\n## User stories\n\n1. As a person, I want the first thing.\n2. As a person, I want the second thing.\n";
const check = (...extra: string[]) =>
  w.run("ticket-check", "tickets", "--root", "root", "--spec", "spec.md", ...extra);
const lines = (text: string) => text.split("\n").filter((l) => l !== "");

test("30.1 a folder of correct tickets passes", async () => {
  w.seed(
    ...card("root", { title: "Root" }),
    ...card("a", { parent: "root", status: "decided" }),
    ...card("b", { parent: "root", status: "decided" }),
  );
  w.write("spec.md", SPEC2);
  w.write("tickets/01-first.md", ticket({ cites: "a", stories: "1" }));
  w.write("tickets/02-second.md", ticket({ cites: "b", stories: "2", blockedBy: "1" }));
  const r = await check();
  const out = lines(r.stdout);
  expect(out).toHaveLength(1);
  expect(out[0]).toMatch(/^2 tickets, 0 own-check failures, 0 failures, 2 decided cards, 2 stories$/);
  expect(r.code).toBe(0);
});

test("30.2 own-check failures name the ticket, the check and the field", async () => {
  w.seed(
    ...card("root", { title: "Root" }),
    ...card("a", { parent: "root", status: "decided" }),
  );
  w.write("spec.md", "## User stories\n\n1. one\n2. two\n3. three\n");
  w.write("tickets/01-ok.md", ticket({ cites: "a", stories: "1" }));
  // The path sits on line 12 of the file.
  w.write("tickets/02-path.md", ticket({ cites: "a", stories: "2", what: "First line.\nSecond line.\nThird line.\nEdit src/loop/run.ts now." }));
  w.write("tickets/03-notouch.md", ticket({ cites: "a", stories: "3", touches: null }));
  const r = await check();
  const out = lines(r.stdout);
  const second = out.find((l) => l.startsWith("02-path.md"));
  expect(second).toBeDefined();
  expect(second).toContain("no-file-paths");
  expect(second).toContain("src/loop/run.ts");
  expect(second).toContain("line 12");
  const third = out.find((l) => l.startsWith("03-notouch.md"));
  expect(third).toBeDefined();
  expect(third).toContain("shape");
  expect(third).toContain("touches");
  expect(out.some((l) => l.startsWith("01-ok.md"))).toBe(false);
  expect(out.at(-1)).toMatch(/^3 tickets, 2 own-check failures/);
  expect(r.code).toBe(1);
});

test("30.3 an uncited decided card fails the set, and a ghost does not count", async () => {
  w.seed(
    ...card("root", { title: "Root" }),
    ...card("cited", { parent: "root", status: "decided" }),
    ...card("uncited", { parent: "root", status: "decided" }),
    { type: "node.proposed", id: "phantom", kind: "card", title: "Phantom", status: "decided", parent: "root" },
  );
  w.write("spec.md", "## User stories\n\n1. one\n2. two\n");
  w.write("tickets/01-a.md", ticket({ cites: "root, cited", stories: "1" }));
  w.write("tickets/02-b.md", ticket({ cites: "root, cited", stories: "2" }));
  const r = await check();
  const out = lines(r.stdout);
  const setLines = out.filter((l) => l.startsWith("ticket set"));
  expect(setLines).toHaveLength(1);
  expect(setLines[0]).toContain("uncited");
  expect(out.some((l) => l.includes("phantom"))).toBe(false);
  expect(out.at(-1)).toMatch(/\b2 decided cards\b/);
  expect(r.code).toBe(1);
});

test("30.4 a cycle in blocked_by names only the tickets on the cycle", async () => {
  w.seed(
    ...card("root", { title: "Root" }),
    ...card("a", { parent: "root", status: "decided" }),
    ...card("b", { parent: "root", status: "decided" }),
    ...card("c", { parent: "root", status: "decided" }),
    ...card("d", { parent: "root", status: "decided" }),
  );
  w.write("spec.md", "## User stories\n\n1. one\n2. two\n3. three\n4. four\n");
  w.write("tickets/01-a.md", ticket({ cites: "a", stories: "1" }));
  w.write("tickets/02-b.md", ticket({ cites: "b", stories: "2", blockedBy: "3" }));
  w.write("tickets/03-c.md", ticket({ cites: "c", stories: "3", blockedBy: "2" }));
  w.write("tickets/04-d.md", ticket({ cites: "d", stories: "4", blockedBy: "3" }));
  const r = await check();
  const out = lines(r.stdout);
  expect(out.some((l) => l.startsWith("02-b.md") && l.includes("blocked_by"))).toBe(true);
  expect(out.some((l) => l.startsWith("03-c.md") && l.includes("blocked_by"))).toBe(true);
  expect(out.some((l) => l.startsWith("01-a.md"))).toBe(false);
  expect(out.some((l) => l.startsWith("04-d.md"))).toBe(false);
  expect(r.code).toBe(1);
});

test("30.5 a spec with no User stories heading is a malformed call", async () => {
  w.seed(...card("root", { title: "Root" }), ...card("a", { parent: "root", status: "decided" }));
  w.write("spec.md", "# Spec\n\nNo stories here.\n");
  w.write("tickets/01-a.md", ticket({ cites: "a", stories: "1" }));
  const r = await check();
  expect(r.stderr + r.stdout).toMatch(/User stories/);
  expect(r.stdout.trim()).toBe("");
  expect(r.code).toBe(2);
});
