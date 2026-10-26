import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ticket } from "../src/tickets/fixtures.ts";
import {
  createProject,
  decided,
  ghost,
  open,
  type Project,
  seedMap,
  werk,
} from "./support.ts";

let p: Project;
beforeEach(() => {
  p = createProject();
});
afterEach(() => p.dispose());

const write = (path: string, text: string) => {
  mkdirSync(join(p.dir, path, ".."), { recursive: true });
  writeFileSync(join(p.dir, path), text);
};
const spec = (n: number) =>
  `# Spec\n\n## User stories\n\n${Array.from({ length: n }, (_, i) => `${i + 1}. As a person, I want story ${i + 1}.`).join("\n")}\n`;
const check = () =>
  werk(p, "ticket-check", "tickets", "--root", "root", "--spec", "spec.md");
/** Links each decided card under the root after it is decided (a decided card under an open parent is refused). */
const under = (...ids: string[]) =>
  ids.map((id) => ({
    type: "edge.added",
    from: id,
    to: "root",
    link: "refines",
    why: "w",
  }));
const lines = (t: string) => t.split("\n").filter((l) => l.trim() !== "");

test("30.1 a folder of correct tickets passes", async () => {
  seedMap(
    p,
    open("root", { title: "Root" }),
    decided("d1"),
    decided("d2"),
    ...under("d1", "d2"),
  );
  write("spec.md", spec(2));
  write("tickets/01-a.md", ticket({ cites: "d1", stories: "1" }));
  write(
    "tickets/02-b.md",
    ticket({ cites: "d2", stories: "2", blockedBy: "1" }),
  );
  const r = await check();
  const out = lines(r.stdout);
  expect(out).toHaveLength(1);
  expect(out[0]).toBe(
    "2 tickets, 0 own-check failures, 0 failures, 2 decided cards, 2 stories",
  );
  expect(r.code).toBe(0);
});

test("30.2 own-check failures name the ticket, the check and the field", async () => {
  seedMap(
    p,
    open("root", { title: "Root" }),
    decided("d1"),
    ...under("d1"),
  );
  write("spec.md", spec(1));
  write("tickets/01-a.md", ticket({ cites: "d1", stories: "1" }));
  write(
    "tickets/02-b.md",
    ticket({
      cites: "d1",
      what: "First line.\nSecond line.\nThird line.\nEdit src/loop.ts now.",
    }),
  );
  write("tickets/03-c.md", ticket({ cites: "d1", touches: null }));
  const text = readTicket02();
  expect(text.split("\n")[11]).toContain("src/loop.ts");
  const r = await check();
  const out = lines(r.stdout);
  expect(
    out.some(
      (l) =>
        l.startsWith("02-b.md") &&
        l.includes("no-file-paths") &&
        l.includes("src/loop.ts") &&
        l.includes("12"),
    ),
  ).toBe(true);
  expect(
    out.some(
      (l) =>
        l.startsWith("03-c.md") && l.includes("shape") && l.includes("touches"),
    ),
  ).toBe(true);
  expect(out.some((l) => l.startsWith("01-a.md"))).toBe(false);
  expect(out[out.length - 1]).toMatch(/^3 tickets, 2 own-check failures/);
  expect(r.code).toBe(1);
});

function readTicket02() {
  return ticket({
    cites: "d1",
    what: "First line.\nSecond line.\nThird line.\nEdit src/loop.ts now.",
  });
}

test("30.3 an uncited decided card fails the set, and a ghost does not count", async () => {
  seedMap(
    p,
    open("root", { title: "Root" }),
    decided("d1"),
    decided("d3"),
    ghost("ghostcard", { parent: "root", status: "decided" }),
    ...under("d1", "d3"),
  );
  write("spec.md", spec(2));
  write("tickets/01-a.md", ticket({ cites: "root", stories: "1" }));
  write("tickets/02-b.md", ticket({ cites: "d1", stories: "2" }));
  const r = await check();
  const out = lines(r.stdout);
  const set = out.filter((l) => l.startsWith("ticket set"));
  expect(set).toHaveLength(1);
  expect(set[0]).toContain("d3");
  expect(r.stdout).not.toContain("ghostcard");
  expect(out[out.length - 1]).toContain("2 decided cards");
  expect(r.code).toBe(1);
});

test("30.4 a cycle in blocked_by names only the tickets on the cycle", async () => {
  seedMap(
    p,
    open("root", { title: "Root" }),
    decided("d1"),
    decided("d2"),
    decided("d3"),
    decided("d4"),
    ...under("d1", "d2", "d3", "d4"),
  );
  write("spec.md", spec(4));
  write("tickets/01-a.md", ticket({ cites: "d1", stories: "1" }));
  write(
    "tickets/02-b.md",
    ticket({ cites: "d2", stories: "2", blockedBy: "3" }),
  );
  write(
    "tickets/03-c.md",
    ticket({ cites: "d3", stories: "3", blockedBy: "2" }),
  );
  write(
    "tickets/04-d.md",
    ticket({ cites: "d4", stories: "4", blockedBy: "3" }),
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
  seedMap(
    p,
    open("root", { title: "Root" }),
    decided("d1"),
    ...under("d1"),
  );
  write("spec.md", "# Spec\n\nNo stories here.\n");
  write("tickets/01-a.md", ticket({ cites: "d1", stories: "1" }));
  const r = await check();
  expect(r.stderr).toContain("User stories");
  expect(r.stdout.trim()).toBe("");
  expect(r.code).toBe(2);
});
