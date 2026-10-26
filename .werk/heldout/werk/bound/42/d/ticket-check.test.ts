import { afterEach, beforeEach, expect, test } from "bun:test";
import { decided, ghost, open, reopen } from "../../src/map/mark-fixtures.ts";
import { ticket } from "../../src/tickets/fixtures.ts";
import { createProject, type Project, tools } from "./h.ts";

let project: Project;
let t: ReturnType<typeof tools>;
beforeEach(() => {
  project = createProject();
  t = tools(project);
});
afterEach(() => project.dispose());

const child = (id: string) =>
  [...decided(id, { parent: "root" })];
const check = () =>
  t.werk("ticket-check", "tickets", "--root", "root", "--spec", "spec.md");
const spec2 = "## User stories\n\n1. As a person, I want a.\n2. As a person, I want b.\n";
const last = (s: string) => s.trim().split("\n").at(-1);

test("30.1 correct folder passes", async () => {
  t.seedMap(decided("root"), child("a"), child("b"));
  t.write("spec.md", spec2);
  t.write("tickets/01-a.md", ticket({ cites: "root, a", stories: "1" }));
  t.write("tickets/02-b.md", ticket({ cites: "b", stories: "2", blockedBy: "1", title: "Second thing" }));
  const r = await check();
  console.log("30.1", JSON.stringify(r));
  expect(r.stdout.trim().split("\n")).toHaveLength(1);
  expect(last(r.stdout)).toBe("2 tickets, 0 own-check failures, 0 failures, 3 decided cards, 2 stories");
  expect(r.code).toBe(0);
});

test("30.1 (count as written: 2 decided cards)", async () => {
  // The step says "a root card with two decided cards under it" and a last line with 2 decided cards.
  t.seedMap(decided("root"), child("a"), child("b"), [reopen("root")]);
  t.write("spec.md", spec2);
  t.write("tickets/01-a.md", ticket({ cites: "a", stories: "1" }));
  t.write("tickets/02-b.md", ticket({ cites: "b", stories: "2", blockedBy: "1", title: "Second thing" }));
  const r = await check();
  console.log("30.1b", JSON.stringify(r));
  expect(last(r.stdout)).toBe("2 tickets, 0 own-check failures, 0 failures, 2 decided cards, 2 stories");
  expect(r.code).toBe(0);
});

test("30.2 own-check failures", async () => {
  t.seedMap(decided("root"));
  t.write("spec.md", "## User stories\n\n1. a\n");
  t.write("tickets/01-a.md", ticket({ cites: "root" }));
  const body = Array.from({ length: 10 }, (_, i) => `line ${i}`);
  // line 12 of the file must hold the path
  const text = ticket({ cites: "root", what: "x" }).split("\n");
  const lines = ["title: Second", "cites: root", "blocked_by: ", "stories: 1", "touches: map view", "", "## What to build", "", "Some words here.", "More words.", "", "Edit src/loop.ts now.", "", "## Acceptance criteria", "", "- [ ] ok", "", "## Checks", "", "- `make test`", ""];
  void body; void text;
  t.write("tickets/02-b.md", lines.join("\n"));
  t.write("tickets/03-c.md", ticket({ cites: "root", touches: null }));
  const r = await check();
  console.log("30.2", JSON.stringify(r));
  expect(r.stdout).toMatch(/02-b\.md.*src\/loop\.ts.*12/);
  expect(r.stdout).toMatch(/02-b\.md: file-paths|02-b\.md: no-file-paths|02-b\.md: [a-z-]*path/);
  expect(r.stdout).toMatch(/03-c\.md: shape: touches/);
  expect(r.stdout).not.toContain("01-a.md");
  expect(last(r.stdout)).toMatch(/^3 tickets, 2 own-check failures/);
  expect(r.code).toBe(1);
});

test("30.3 uncited decided card fails the set; ghost ignored", async () => {
  t.seedMap(
    decided("root"),
    child("a"),
    child("b"),
    [reopen("root")],
    // a ghost with the decided status
    [{ type: "node.proposed", id: "ghosty", kind: "card", title: "Ghost", status: "decided", parent: "root" }],
  );
  t.write("spec.md", "## User stories\n\n1. a\n");
  t.write("tickets/01-a.md", ticket({ cites: "root, a", stories: "1" }));
  const r = await check();
  console.log("30.3", JSON.stringify(r));
  const setLines = r.stdout.split("\n").filter((l) => l.startsWith("ticket set"));
  expect(setLines).toHaveLength(1);
  expect(setLines[0]).toContain("b");
  expect(r.stdout).not.toContain("ghosty");
  expect(last(r.stdout)).toContain("2 decided cards");
  expect(r.code).toBe(1);
});

test("30.3b ghost wording: fold of a decided ghost", async () => {
  t.seedMap(decided("root"), child("a"), [ghost("g", { parent: "root" })]);
  t.write("spec.md", "## User stories\n\n1. a\n");
  t.write("tickets/01-a.md", ticket({ cites: "root, a", stories: "1" }));
  const r = await check();
  expect(r.stdout).not.toContain("g");
  expect(r.code).toBe(0);
});

test("30.4 cycle names only cycle tickets", async () => {
  t.seedMap(decided("root"));
  t.write("spec.md", "## User stories\n\n1. a\n");
  const mk = (n: number, blocked: string) =>
    t.write(`tickets/0${n}-t.md`, ticket({ cites: "root", stories: "1", title: `T${n}`, blockedBy: blocked }));
  mk(1, "");
  mk(2, "3");
  mk(3, "2");
  mk(4, "3");
  const r = await check();
  console.log("30.4", JSON.stringify(r));
  const f = r.stdout.split("\n").filter((l) => l.includes("blocked_by"));
  expect(f.some((l) => l.startsWith("02-t.md"))).toBe(true);
  expect(f.some((l) => l.startsWith("03-t.md"))).toBe(true);
  expect(r.stdout).not.toMatch(/^01-t\.md/m);
  expect(r.stdout).not.toMatch(/^04-t\.md/m);
  expect(r.code).toBe(1);
});

test("30.5 spec without User stories heading is exit 2", async () => {
  t.seedMap(decided("root"));
  t.write("spec.md", "# Spec\n\nNothing.\n");
  t.write("tickets/01-a.md", ticket({ cites: "root" }));
  const r = await check();
  expect(r.code).toBe(2);
  expect(r.stderr).toContain("User stories");
  expect(r.stdout.trim()).toBe("");
});
