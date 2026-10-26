import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ticket } from "../src/tickets/fixtures.ts";
import {
  appendRaw,
  createProject,
  decideThenAttach,
  type Project,
  real,
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
const check = () =>
  werk(p, "ticket-check", "tickets", "--root", "root", "--spec", "spec.md");
const lines = (s: string) => s.split("\n").filter((l) => l !== "");
const spec = (n: number) => {
  const stories = Array.from(
    { length: n },
    (_, i) => `${i + 1}. As a person, I want story ${i + 1}.`,
  );
  return `# Spec\n\n## User stories\n\n${stories.join("\n")}\n`;
};

/** An open root with decided cards under it. */
async function rootWith(...ids: string[]) {
  await real(p, "root", { title: "Root" });
  for (const id of ids) await decideThenAttach(p, id, "root");
}

test("30.1 a folder of correct tickets passes", async () => {
  await rootWith("card-a", "card-b");
  write("spec.md", spec(2));
  write("tickets/01-first.md", ticket({ cites: "card-a", stories: "1" }));
  write(
    "tickets/02-second.md",
    ticket({ cites: "card-b", stories: "2", blockedBy: "1" }),
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
  await rootWith("card-a");
  write("spec.md", spec(1));
  write("tickets/01-first.md", ticket({ cites: "card-a", stories: "1" }));
  const what = "Line one.\nLine two.\nLine three.\nRead src/loop.ts here.";
  write("tickets/02-second.md", ticket({ what }));
  write("tickets/03-third.md", ticket({ touches: null }));
  expect(ticket({ what }).split("\n")[11]).toContain("src/loop.ts");
  const r = await check();
  const out = lines(r.stdout);
  const second = out.find((l) => l.startsWith("02-second.md"));
  expect(second).toContain("no-file-paths");
  expect(second).toContain("src/loop.ts");
  expect(second).toContain("line 12");
  const third = out.find((l) => l.startsWith("03-third.md"));
  expect(third).toContain("shape");
  expect(third).toContain("touches");
  expect(out.some((l) => l.startsWith("01-first.md"))).toBe(false);
  expect(out.at(-1)).toContain("3 tickets, 2 own-check failures");
  expect(r.code).toBe(1);
});

test("30.3 an uncited decided card fails the set, and a ghost does not count", async () => {
  await rootWith("card-a", "card-b");
  appendRaw(p, {
    type: "node.proposed",
    id: "card-ghost",
    kind: "card",
    title: "card-ghost",
    status: "decided",
    parent: "root",
  });
  write("spec.md", spec(1));
  write("tickets/01-first.md", ticket({ cites: "root, card-a", stories: "1" }));
  const r = await check();
  const out = lines(r.stdout);
  const set = out.filter((l) => l.startsWith("ticket set"));
  expect(set).toHaveLength(1);
  expect(set[0]).toContain("card-b");
  expect(out.some((l) => l.includes("card-ghost"))).toBe(false);
  expect(out.at(-1)).toContain("2 decided cards");
  expect(r.code).toBe(1);
});

test("30.4 a cycle in blocked_by names only the tickets on the cycle", async () => {
  await rootWith("card-a");
  write("spec.md", spec(1));
  const t = (blockedBy: string) =>
    ticket({ cites: "card-a", stories: "1", blockedBy });
  write("tickets/01-a.md", t(""));
  write("tickets/02-b.md", t("3"));
  write("tickets/03-c.md", t("2"));
  write("tickets/04-d.md", t("3"));
  const r = await check();
  const out = lines(r.stdout);
  const failure = (file: string) =>
    out.find((l) => l.startsWith(file) && l.includes("blocked_by"));
  expect(failure("02-b.md")).toBeDefined();
  expect(failure("03-c.md")).toBeDefined();
  expect(out.some((l) => l.startsWith("01-a.md"))).toBe(false);
  expect(out.some((l) => l.startsWith("04-d.md"))).toBe(false);
  expect(r.code).toBe(1);
});

test("30.5 a spec with no User stories heading is a malformed call", async () => {
  await rootWith("card-a");
  write("spec.md", "# Spec\n\nNo stories here.\n");
  write("tickets/01-a.md", ticket({ cites: "card-a", stories: "1" }));
  const r = await check();
  expect(r.stderr).toContain("User stories");
  expect(r.stdout.trim()).toBe("");
  expect(r.code).toBe(2);
});
