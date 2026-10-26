import { afterEach, beforeEach, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createProject, type Project } from "../src/test-env/project.ts";

setDefaultTimeout(600_000);
const CLI = join(import.meta.dir, "..", "src", "cli.ts");
let project: Project;
beforeEach(() => {
  project = createProject();
});
afterEach(() => project.dispose());
const werk = (...args: string[]) => project.run(["bun", CLI, ...args]);
async function ok(...args: string[]) {
  const r = await werk(...args);
  if (r.code !== 0) throw new Error(`setup: werk ${args.join(" ")} -> ${r.code}: ${r.stderr}`);
  return r;
}

// ---- 43: follow-up records on the board log ----
const boardPath = () => join(project.dir, ".werk", "board.jsonl");
const seed = (...events: unknown[]) => {
  mkdirSync(join(project.dir, ".werk"), { recursive: true });
  writeFileSync(boardPath(), events.map((e) => `${JSON.stringify(e)}\n`).join(""));
};
const board = () => readFileSync(boardPath(), "utf8");
const doneTicket = (id: string) => [
  { type: "ticket.planned", id },
  { type: "ticket.moved", id, to: "building" },
  { type: "ticket.moved", id, to: "merging", actor: "loop" },
  { type: "ticket.merge", id },
];

test("43.1 a build miss on a done ticket is recorded and listed", async () => {
  seed(...doneTicket("app/01"));
  const rec = await werk("followup", "app/01", "--class", "build", "--found", "after-merge", "--why", "the link expires after 1 minute, the card says 15", "--catchable", "yes");
  expect(rec.code).toBe(0);
  expect(rec.stdout).toContain("recorded");
  const list = await werk("followup", "app/01", "--list");
  expect(list.code).toBe(0);
  const out = list.stdout;
  expect(out).toMatch(/^1\./m);
  expect(out).toMatch(/build/);
  expect(out).toMatch(/after.merge/);
  expect(out).toContain("the link expires after 1 minute, the card says 15");
  expect(out).toMatch(/catchable yes/);
});

test("43.2 a plan miss is recorded without a catchable answer", async () => {
  seed(...doneTicket("app/01"));
  const rec = await werk("followup", "app/01", "--class", "plan", "--found", "review", "--why", "no card said how long the link lasts");
  expect(rec.code).toBe(0);
  expect(rec.stdout).toContain("recorded");
  const out = (await werk("followup", "app/01", "--list")).stdout;
  expect(out).toMatch(/^1\./m);
  expect(out).toMatch(/plan/);
  expect(out).toMatch(/review/);
  expect(out).toContain("no card said how long the link lasts");
  expect(out).not.toMatch(/catchable/);
});

test("43.3 a wrong catchable answer is refused and nothing is recorded", async () => {
  seed(...doneTicket("app/01"));
  const before = board();
  const noAnswer = await werk("followup", "app/01", "--class", "build", "--found", "review", "--why", "the button label is wrong");
  expect(noAnswer.code).not.toBe(0);
  expect(noAnswer.stdout + noAnswer.stderr).toMatch(/build miss needs/);
  expect(noAnswer.stdout + noAnswer.stderr).toMatch(/catchable/);
  const extra = await werk("followup", "app/01", "--class", "plan", "--found", "review", "--why", "the card was silent", "--catchable", "no");
  expect(extra.code).not.toBe(0);
  expect(extra.stdout + extra.stderr).toMatch(/plan miss/);
  expect(extra.stdout + extra.stderr).toMatch(/catchable/);
  const list = await werk("followup", "app/01", "--list");
  expect(list.stdout.trim()).toBe("");
  expect(board()).toBe(before);
});

test("43.4 a ticket that is not done, or does not exist, is refused", async () => {
  seed({ type: "ticket.planned", id: "app/02" }, { type: "ticket.moved", id: "app/02", to: "building" });
  const before = board();
  const notDone = await werk("followup", "app/02", "--class", "build", "--found", "review", "--why", "rename the button", "--catchable", "no");
  expect(notDone.code).not.toBe(0);
  expect(notDone.stdout + notDone.stderr).toMatch(/not done/);
  const missing = await werk("followup", "app/99", "--class", "plan", "--found", "review", "--why", "missing rule");
  expect(missing.code).not.toBe(0);
  expect(missing.stdout + missing.stderr).toMatch(/does not exist|no ticket|not exist|unknown/i);
  const list = await werk("followup", "app/02", "--list");
  expect(list.stdout.trim()).toBe("");
  expect(board()).toBe(before);
});

test("43.5 the last correction of a record is the class in force", async () => {
  seed(...doneTicket("app/01"));
  await ok("followup", "app/01", "--class", "build", "--found", "after-merge", "--why", "the link lasts 1 minute", "--catchable", "yes");
  const fix = await werk("followup", "app/01", "--class", "plan", "--found", "after-merge", "--why", "the card never said 15 minutes", "--of", "1");
  expect(fix.code).toBe(0);
  const first = (await werk("followup", "app/01", "--list")).stdout.split("\n").filter((l) => l !== "");
  expect(first.length).toBe(2);
  expect(first[0]).toMatch(/^1\./);
  expect(first[0]).toMatch(/plan/);
  expect(first[0]).toMatch(/in force/);
  expect(first[1]).toMatch(/^2\./);
  expect(first[1]).toMatch(/correct/i);
  expect(first[1]).toMatch(/1/);
  const fix2 = await werk("followup", "app/01", "--class", "build", "--found", "after-merge", "--why", "the card does say 15 minutes", "--catchable", "yes", "--of", "1");
  expect(fix2.code).toBe(0);
  const second = (await werk("followup", "app/01", "--list")).stdout.split("\n").filter((l) => l !== "");
  expect(second[0]).toMatch(/^1\./);
  expect(second[0]).toMatch(/build/);
  expect(second[0]).toMatch(/in force/);
});

// ---- 30: ticket-check ----
const write = (path: string, text: string) => {
  mkdirSync(join(project.dir, path, ".."), { recursive: true });
  writeFileSync(join(project.dir, path), text);
};

type T = { title?: string; cites: string; blockedBy?: string; stories?: string; touches?: string | null; what?: string[] };
/** Header lines are 1-5, the blank line is 6, the What heading is 7, the blank is 8 and the text starts on line 9. */
function tk(t: T): string {
  const lines = [
    `title: ${t.title ?? "A person does a thing"}`,
    `cites: ${t.cites}`,
    `blocked_by: ${t.blockedBy ?? ""}`,
    `stories: ${t.stories ?? "1"}`,
    ...(t.touches === null ? [] : [`touches: ${t.touches ?? "map view"}`]),
    "",
    "## What to build",
    "",
    ...(t.what ?? ["The person does the thing and sees the result."]),
    "",
    "## Acceptance criteria",
    "",
    "- [ ] The result shows.",
    "",
    "## Checks",
    "",
    "- `make test`",
  ];
  return `${lines.join("\n")}\n`;
}
const SPEC2 = "# Spec\n\n## User stories\n\n1. As a person, I want a.\n2. As a person, I want b.\n";
const check = () => werk("ticket-check", "tickets", "--root", "root", "--spec", "spec.md");

/** A decided card with a kill criterion, under a parent when given. */
async function decideCard(id: string, parent?: string, ghost = false) {
  await ok("add", id, "--title", `Card ${id}`, "--why", "w", ...(parent ? ["--parent", parent] : []));
  await ok("edit", id, "--who", "me");
  await ok("kill", id, "--revisit");
  if (!parent) await ok("edit", id, "--no-basis", "top");
  if (!ghost) await ok("accept", id, "--actor", "you");
  await ok("status", id, "decided");
}
/** A root card with the named children decided. The root itself is reopened, so only the children are decided. */
async function rootWith(children: string[], ghosts: string[] = []) {
  await decideCard("root");
  for (const c of children) await decideCard(c, "root");
  for (const g of ghosts) await decideCard(g, "root", true);
  await ok("reopen", "root", "--reason", "invalidated");
}

test("30.1 a folder of correct tickets passes", async () => {
  await rootWith(["c1", "c2"]);
  write("spec.md", SPEC2);
  write("tickets/01-first.md", tk({ cites: "c1", stories: "1" }));
  write("tickets/02-second.md", tk({ cites: "c2", stories: "2", blockedBy: "1" }));
  const r = await check();
  const lines = r.stdout.split("\n").filter((l) => l !== "");
  expect(lines.slice(0, -1)).toEqual([]);
  expect(lines.at(-1)).toBe("2 tickets, 0 own-check failures, 0 failures, 2 decided cards, 2 stories");
  expect(r.code).toBe(0);
});

test("30.2 own-check failures name the ticket, the check and the field", async () => {
  await rootWith(["c1"]);
  write("spec.md", "## User stories\n\n1. a\n2. b\n3. c\n");
  write("tickets/01-ok.md", tk({ cites: "c1", stories: "1" }));
  // Lines 9 to 11 are plain text, so the path is on line 12 of the file.
  write("tickets/02-path.md", tk({ cites: "c1", stories: "2", what: ["Line nine.", "Line ten.", "Line eleven.", "Read docs/guide.md for the idea."] }));
  write("tickets/03-nolines.md", tk({ cites: "c1", stories: "3", touches: null }));
  const r = await check();
  const lines = r.stdout.split("\n").filter((l) => l !== "");
  const second = lines.find((l) => l.startsWith("02-path.md"));
  expect(second).toBeDefined();
  expect(second).toContain("no-file-paths");
  expect(second).toContain("docs/guide.md");
  expect(second).toContain("line 12");
  const third = lines.find((l) => l.startsWith("03-nolines.md"));
  expect(third).toBeDefined();
  expect(third).toContain("shape");
  expect(third).toContain("touches");
  expect(lines.some((l) => l.startsWith("01-ok.md"))).toBe(false);
  expect(lines.at(-1)).toMatch(/^3 tickets, 2 own-check failures/);
  expect(r.code).toBe(1);
});

test("30.3 an uncited decided card fails the set, and a ghost does not count", async () => {
  await rootWith(["real1", "real2"], ["ghosty"]);
  write("spec.md", "## User stories\n\n1. a\n");
  write("tickets/01-a.md", tk({ cites: "root, real1", stories: "1" }));
  const r = await check();
  const lines = r.stdout.split("\n").filter((l) => l !== "");
  const set = lines.filter((l) => l.startsWith("ticket set"));
  expect(set.length).toBe(1);
  expect(set[0]).toContain("real2");
  expect(r.stdout).not.toContain("ghosty");
  expect(lines.at(-1)).toMatch(/, 2 decided cards,/);
  expect(r.code).toBe(1);
});

test("30.4 a cycle in blocked_by names only the tickets on the cycle", async () => {
  await decideCard("root");
  write("spec.md", "## User stories\n\n1. a\n");
  write("tickets/01-a.md", tk({ cites: "root" }));
  write("tickets/02-b.md", tk({ cites: "root", blockedBy: "3" }));
  write("tickets/03-c.md", tk({ cites: "root", blockedBy: "2" }));
  write("tickets/04-d.md", tk({ cites: "root", blockedBy: "3" }));
  const r = await check();
  const lines = r.stdout.split("\n").filter((l) => l !== "");
  expect(lines.some((l) => l.startsWith("02-b.md") && l.includes("blocked_by"))).toBe(true);
  expect(lines.some((l) => l.startsWith("03-c.md") && l.includes("blocked_by"))).toBe(true);
  expect(lines.some((l) => l.startsWith("01-a.md"))).toBe(false);
  expect(lines.some((l) => l.startsWith("04-d.md"))).toBe(false);
  expect(r.code).toBe(1);
});

test("30.5 a spec with no User stories heading is a malformed call", async () => {
  await decideCard("root");
  write("spec.md", "# Spec\n\nJust words, no stories here.\n");
  write("tickets/01-a.md", tk({ cites: "root" }));
  const r = await check();
  expect(r.stderr + r.stdout).toMatch(/no "User stories" heading/);
  expect(r.stdout.trim()).toBe("");
  expect(r.code).toBe(2);
});
