import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decided, ghost } from "../src/map/mark-fixtures.ts";
import { ticket } from "../src/tickets/fixtures.ts";
import {
  boardLines,
  boardPath,
  cli,
  createProject,
  type Project,
  seedBoard,
  seedLog,
  SLOW,
} from "./support.ts";

let project: Project;
let werk: ReturnType<typeof cli>;
beforeEach(() => {
  project = createProject();
  werk = cli(project);
});
afterEach(() => project.dispose());

const write = (path: string, text: string) => {
  mkdirSync(join(project.dir, path, ".."), { recursive: true });
  writeFileSync(join(project.dir, path), text);
};
const boardText = () => readFileSync(boardPath(project), "utf8");

// ---------- 27 (board command line) ----------

test("27.1 archive a blocked ticket and restore it to the same column and reason", async () => {
  seedBoard(project, { type: "ticket.planned", id: "auth/01", title: "T" });
  const move = await werk("ticket", "move", "auth/01", "blocked", "--reason", "waits for the token API");
  expect(move.code).toBe(0);
  const arch = await werk("ticket", "archive", "auth/01");
  expect(arch.code).toBe(0);
  const list = (await werk("ticket", "list")).stdout;
  expect(list).toContain("auth/01");
  expect(list).toMatch(/archived/);
  expect(list).toContain("waits for the token API");
  const decisionBefore = project.events().length;
  const restore = await werk("ticket", "restore", "01", "--actor", "you");
  expect(restore.code).toBe(0);
  const list2 = (await werk("ticket", "list")).stdout;
  expect(list2).toMatch(/blocked/);
  expect(list2).toContain("waits for the token API");
  expect(boardLines(project).filter((l) => l.includes("ticket.restored"))).toHaveLength(1);
  expect(project.events()).toHaveLength(decisionBefore);
}, SLOW);

test("27.2 a move without a reason is refused", async () => {
  seedBoard(project, { type: "ticket.planned", id: "auth/01", title: "T" });
  const before = boardText();
  const r = await werk("ticket", "move", "auth/01", "blocked");
  expect(r.code).not.toBe(0);
  expect(r.stderr).toMatch(/reason/);
  expect((await werk("ticket", "list")).stdout).toMatch(/ready/);
  expect(boardText()).toBe(before);
}, SLOW);

test("27.3 restoring a ticket that is not archived, or not on the board, changes nothing", async () => {
  seedBoard(project, { type: "ticket.planned", id: "auth/02", title: "T" });
  const before = boardText();
  const a = await werk("ticket", "restore", "02");
  expect(a.code).toBe(1);
  expect(boardText()).toBe(before);
  const b = await werk("ticket", "restore", "99");
  expect(b.code).toBe(1);
  expect(boardText()).toBe(before);
}, SLOW);

test("27.4 a done ticket cannot be archived", async () => {
  seedBoard(
    project,
    { type: "ticket.planned", id: "auth/03" },
    { type: "ticket.moved", id: "auth/03", to: "building" },
    { type: "ticket.moved", id: "auth/03", to: "merging", actor: "loop" },
    { type: "ticket.merge", id: "auth/03" },
  );
  const before = boardText();
  const r = await werk("ticket", "archive", "auth/03");
  expect(r.code).not.toBe(0);
  expect(r.stderr).toMatch(/done/);
  expect(boardText()).toBe(before);
  const list = (await werk("ticket", "list")).stdout;
  expect(list).toMatch(/done/);
  expect(list).not.toMatch(/archived/);
}, SLOW);

test("27.5 the listing shows every ticket in the column its events lead to", async () => {
  seedBoard(
    project,
    { type: "ticket.planned", id: "auth/01" },
    { type: "ticket.planned", id: "auth/02" },
    { type: "ticket.planned", id: "auth/03" },
  );
  expect((await werk("ticket", "move", "auth/02", "blocked", "--reason", "needs api")).code).toBe(0);
  expect((await werk("ticket", "archive", "auth/03")).code).toBe(0);
  const list = (await werk("ticket", "list")).stdout;
  expect(list).toMatch(/auth\/01.*ready/);
  expect(list).toMatch(/auth\/02.*blocked.*needs api/);
  expect(list).toMatch(/auth\/03.*archived/);
  for (const line of boardLines(project).slice(3)) expect(JSON.parse(line).actor).toBeTruthy();
}, SLOW);

// ---------- 43 follow-up ----------

const done = [
  { type: "ticket.planned", id: "app/01" },
  { type: "ticket.moved", id: "app/01", to: "building" },
  { type: "ticket.moved", id: "app/01", to: "merging", actor: "loop" },
  { type: "ticket.merge", id: "app/01" },
];

test("43.1 a build miss on a done ticket is recorded and listed", async () => {
  seedBoard(project, ...done);
  const r = await werk("followup", "app/01", "--class", "build", "--found", "after-merge", "--why", "the link expires after 1 minute, the card says 15", "--catchable", "yes");
  expect(r.code).toBe(0);
  expect(r.stdout.toLowerCase()).toContain("recorded");
  const list = (await werk("followup", "app/01", "--list")).stdout;
  expect(list).toMatch(/1/);
  expect(list).toMatch(/build/);
  expect(list).toMatch(/after.merge/);
  expect(list).toContain("the link expires after 1 minute, the card says 15");
  expect(list).toMatch(/could catch: yes/);
}, SLOW);

test("43.2 a plan miss is recorded without a catchable answer", async () => {
  seedBoard(project, ...done);
  const r = await werk("followup", "app/01", "--class", "plan", "--found", "review", "--why", "no card said how long the link lasts");
  expect(r.code).toBe(0);
  expect(r.stdout.toLowerCase()).toContain("recorded");
  const list = (await werk("followup", "app/01", "--list")).stdout;
  expect(list).toMatch(/plan/);
  expect(list).toMatch(/review/);
  expect(list).toContain("no card said how long the link lasts");
  expect(list).not.toMatch(/could catch/);
}, SLOW);

test("43.3 a wrong catchable answer is refused and nothing is recorded", async () => {
  seedBoard(project, ...done);
  const a = await werk("followup", "app/01", "--class", "build", "--found", "review", "--why", "the button label is wrong");
  expect(a.code).not.toBe(0);
  expect(a.stderr).toMatch(/build miss needs (a|the) catchable/i);
  const b = await werk("followup", "app/01", "--class", "plan", "--found", "review", "--why", "the card was silent", "--catchable", "no");
  expect(b.code).not.toBe(0);
  expect(b.stderr).toMatch(/plan miss (has no|does not take) (a |the )?catchable/i);
  const list = await werk("followup", "app/01", "--list");
  expect(list.stdout).not.toMatch(/build|plan/);
  expect(boardLines(project)).toHaveLength(done.length);
}, SLOW);

test("43.4 a ticket that is not done, or does not exist, is refused", async () => {
  seedBoard(project, ...done, { type: "ticket.planned", id: "app/02" }, { type: "ticket.moved", id: "app/02", to: "building" });
  const a = await werk("followup", "app/02", "--class", "build", "--found", "review", "--why", "rename the button", "--catchable", "no");
  expect(a.code).not.toBe(0);
  expect(a.stderr).toMatch(/not done/);
  const b = await werk("followup", "app/99", "--class", "plan", "--found", "review", "--why", "missing rule");
  expect(b.code).not.toBe(0);
  expect(b.stderr).toMatch(/does not exist|no ticket|not on the board|unknown/i);
  const list = await werk("followup", "app/02", "--list");
  expect(list.stdout).not.toMatch(/build|plan/);
}, SLOW);

test("43.5 the last correction of a record is the class in force", async () => {
  seedBoard(project, ...done);
  await werk("followup", "app/01", "--class", "build", "--found", "after-merge", "--why", "link expires", "--catchable", "yes");
  const a = await werk("followup", "app/01", "--class", "plan", "--found", "after-merge", "--why", "the card never said 15 minutes", "--of", "1");
  expect(a.code).toBe(0);
  const l1 = (await werk("followup", "app/01", "--list")).stdout;
  expect(l1).toMatch(/1.*plan/);
  expect(l1).toMatch(/correct/i);
  const b = await werk("followup", "app/01", "--class", "build", "--found", "after-merge", "--why", "the card does say 15 minutes", "--catchable", "yes", "--of", "1");
  expect(b.code).toBe(0);
  const l2 = (await werk("followup", "app/01", "--list")).stdout;
  expect(l2.split("\n")[0]).toMatch(/1/);
  expect(l2).toMatch(/in force.*build|build.*in force/i);
}, SLOW);

// ---------- 30 ticket-check ----------

const SPEC = "# Spec\n\n## User stories\n\n1. As a person, I want a.\n2. As a person, I want b.\n";
const check = () => werk("ticket-check", "tickets", "--root", "root", "--spec", "spec.md");

test("30.1 a folder of correct tickets passes", async () => {
  seedLog(project, decided("root"), decided("a", { parent: "root" }), decided("b", { parent: "root" }), { type: "node.reopened", id: "root", at: "2026-10-10T09:00:00.000Z" });
  write("spec.md", SPEC);
  write("tickets/01-a.md", ticket({ cites: "a", stories: "1" }));
  write("tickets/02-b.md", ticket({ cites: "b", stories: "2", blockedBy: "1" }));
  const r = await check();
  expect(r.code).toBe(0);
  const lines = r.stdout.trim().split("\n");
  expect(lines).toHaveLength(1);
  expect(lines[0]).toContain("2 tickets, 0 own-check failures, 0 failures");
  expect(lines[0]).toMatch(/\d+ decided cards, 2 stories/);
  // the step names "2 decided cards": two decided cards under the root
  expect(lines[0]).toContain("2 decided cards");
}, SLOW);

test("30.2 own-check failures name the ticket, the check and the field", async () => {
  seedLog(project, decided("root"));
  write("spec.md", SPEC);
  write("tickets/01-a.md", ticket({ cites: "root", stories: "1,2" }));
  write(
    "tickets/02-b.md",
    ticket({ cites: "root", what: "first line\nsecond line\nthird line\nsee src/loop.ts here" }),
  );
  write("tickets/03-c.md", ticket({ cites: "root", touches: null }));
  const r = await check();
  expect(r.code).toBe(1);
  expect(r.stdout).toMatch(/02-b\.md: no-file-paths: .*src\/loop\.ts \(line 12\)/);
  expect(r.stdout).toMatch(/03-c\.md: shape: touches/);
  expect(r.stdout).not.toMatch(/^01-a\.md:/m);
  const last = r.stdout.trim().split("\n").at(-1) as string;
  expect(last).toContain("3 tickets, 2 own-check failures");
}, SLOW);

test("30.3 an uncited decided card fails the set, and a ghost does not count", async () => {
  seedLog(
    project,
    decided("root"),
    decided("a", { parent: "root" }),
    decided("c", { parent: "root" }),
    // ghost: a decided card that was proposed again as a ghost
    decided("gh", { parent: "root" }),
    { type: "node.reopened", id: "gh", at: "2026-10-10T09:00:00.000Z" },
  );
  write("spec.md", SPEC);
  write("tickets/01-a.md", ticket({ cites: "root, a", stories: "1" }));
  write("tickets/02-b.md", ticket({ cites: "root, a", stories: "2" }));
  const r = await check();
  expect(r.code).toBe(1);
  const setLines = r.stdout.split("\n").filter((l) => l.startsWith("ticket set"));
  expect(setLines.some((l) => l.includes("c"))).toBe(true);
  expect(r.stdout).not.toMatch(/\bgh\b/);
}, SLOW);

test("30.4 a cycle in blocked_by names only the tickets on the cycle", async () => {
  seedLog(project, decided("root"));
  write("spec.md", "## User stories\n\n1. a\n");
  write("tickets/01-a.md", ticket({ cites: "root", stories: "1" }));
  write("tickets/02-b.md", ticket({ cites: "root", blockedBy: "3" }));
  write("tickets/03-c.md", ticket({ cites: "root", blockedBy: "2" }));
  write("tickets/04-d.md", ticket({ cites: "root", blockedBy: "3" }));
  const r = await check();
  expect(r.code).toBe(1);
  expect(r.stdout).toMatch(/02-b\.md: blocked_by/);
  expect(r.stdout).toMatch(/03-c\.md: blocked_by/);
  expect(r.stdout).not.toMatch(/^01-a\.md:/m);
  expect(r.stdout).not.toMatch(/^04-d\.md:/m);
}, SLOW);

test("30.5 a spec with no User stories heading is a malformed call", async () => {
  seedLog(project, decided("root"));
  write("spec.md", "# Spec\n\nNothing here.\n");
  write("tickets/01-a.md", ticket({ cites: "root" }));
  const r = await check();
  expect(r.code).toBe(2);
  expect(r.stderr).toContain("User stories");
  expect(r.stdout).toBe("");
}, SLOW);
