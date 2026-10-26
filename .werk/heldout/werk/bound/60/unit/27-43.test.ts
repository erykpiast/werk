import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createProject, type Project } from "../../src/test-env/project.ts";
setDefaultTimeout(40000);

const CLI = join(import.meta.dir, "..", "..", "src", "cli.ts");
let project: Project;
beforeEach(() => {
  project = createProject();
});
afterEach(() => project.dispose());
const werk = (...args: string[]) => project.run(["bun", CLI, ...args]);
const boardPath = () => join(project.dir, ".werk", "board.jsonl");
const seed = (...events: object[]) => {
  mkdirSync(join(project.dir, ".werk"), { recursive: true });
  writeFileSync(boardPath(), events.map((e) => `${JSON.stringify(e)}\n`).join(""));
};
const boardText = () => (existsSync(boardPath()) ? readFileSync(boardPath(), "utf8") : "");
const lines = () => boardText().split("\n").filter(Boolean);
const planned = (id: string) => ({ type: "ticket.planned", id, title: `T ${id}` });
const toDone = (id: string) => [
  { type: "ticket.moved", id, to: "building", actor: "loop" },
  { type: "ticket.moved", id, to: "merging", actor: "loop" },
  { type: "ticket.moved", id, to: "done", actor: "loop" },
];

describe("27", () => {
  test("27.1 archive blocked ticket, restore to same column/reason", async () => {
    seed(planned("auth/01"));
    const mv = await werk("ticket", "move", "auth/01", "blocked", "--reason", "waits for the token API");
    expect(mv.code).toBe(0);
    expect((await werk("ticket", "archive", "auth/01")).code).toBe(0);
    const list = await werk("ticket", "list");
    expect(list.stdout).toContain("auth/01");
    expect(list.stdout).toContain("archived");
    expect(list.stdout).toContain("blocked");
    expect(list.stdout).toContain("waits for the token API");
    const before = lines().length;
    expect((await werk("ticket", "restore", "01", "--actor", "you")).code).toBe(0);
    expect(lines().length).toBe(before + 1);
    expect(JSON.parse(lines().at(-1) as string)).toMatchObject({ type: "ticket.restored", actor: "you" });
    const after = await werk("ticket", "list");
    expect(after.stdout).toContain("blocked");
    expect(after.stdout).toContain("waits for the token API");
    expect(project.events()).toEqual([]);
  });

  test("27.2 move without reason refused", async () => {
    seed(planned("auth/01"));
    const before = boardText();
    const r = await werk("ticket", "move", "auth/01", "blocked");
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("reason");
    expect(boardText()).toBe(before);
    expect((await werk("ticket", "list")).stdout).toContain("ready");
  });

  test("27.3 restore of non-archived or unknown ticket changes nothing", async () => {
    seed(planned("auth/02"));
    const before = boardText();
    expect((await werk("ticket", "restore", "02")).code).toBe(1);
    expect(boardText()).toBe(before);
    expect((await werk("ticket", "restore", "99")).code).toBe(1);
    expect(boardText()).toBe(before);
  });

  test("27.4 done ticket cannot be archived", async () => {
    seed(planned("auth/03"), ...toDone("auth/03"));
    const before = boardText();
    const r = await werk("ticket", "archive", "auth/03");
    expect(r.code).not.toBe(0);
    expect(r.stderr.toLowerCase()).toContain("done");
    expect(boardText()).toBe(before);
    const list = await werk("ticket", "list");
    expect(list.stdout).toContain("done");
    expect(list.stdout).not.toContain("archived");
  });

  test("27.5 listing shows columns its events lead to", async () => {
    seed(planned("auth/01"), planned("auth/02"), planned("auth/03"));
    expect((await werk("ticket", "move", "auth/02", "blocked", "--reason", "needs api")).code).toBe(0);
    expect((await werk("ticket", "archive", "auth/03")).code).toBe(0);
    const list = (await werk("ticket", "list")).stdout;
    expect(list).toMatch(/auth\/01.*ready/);
    expect(list).toMatch(/auth\/02.*blocked.*needs api/);
    expect(list).toMatch(/auth\/03.*archived/);
    for (const l of lines()) expect(JSON.parse(l).actor).toBeTruthy();
  });
});

describe("43", { timeout: 40000 }, () => {
  const fu = (...a: string[]) => werk("followup", "app/01", ...a);
  test("43.1 build miss recorded and listed", async () => {
    seed(planned("app/01"), ...toDone("app/01"));
    const r = await fu("--class", "build", "--found", "after-merge", "--why", "the link expires after 1 minute, the card says 15", "--catchable", "yes");
    expect(r.stdout).toContain("recorded");
    const list = (await fu("--list")).stdout;
    expect(list).toContain("1");
    expect(list).toContain("build");
    expect(list).toContain("after-merge");
    expect(list).toContain("the link expires after 1 minute, the card says 15");
    expect(list).toMatch(/could catch: yes/);
  });
  test("43.2 plan miss without catchable", async () => {
    seed(planned("app/01"), ...toDone("app/01"));
    const r = await fu("--class", "plan", "--found", "review", "--why", "no card said how long the link lasts");
    expect(r.stdout).toContain("recorded");
    const list = (await fu("--list")).stdout;
    expect(list).toContain("plan");
    expect(list).toContain("review");
    expect(list).toContain("no card said how long the link lasts");
    expect(list).not.toContain("catch");
  });
  test("43.3 wrong catchable refused", async () => {
    seed(planned("app/01"), ...toDone("app/01"));
    const a = await fu("--class", "build", "--found", "review", "--why", "the button label is wrong");
    expect(a.code).not.toBe(0);
    expect(a.stderr).toContain("catchable");
    const b = await fu("--class", "plan", "--found", "review", "--why", "the card was silent", "--catchable", "no");
    expect(b.code).not.toBe(0);
    expect(b.stderr).toContain("catchable");
    expect((await fu("--list")).stdout.trim()).toBe("");
  });
  test("43.4 not done or missing refused", async () => {
    seed(planned("app/02"), { type: "ticket.moved", id: "app/02", to: "building", actor: "loop" });
    const a = await werk("followup", "app/02", "--class", "build", "--found", "review", "--why", "rename the button", "--catchable", "no");
    expect(a.code).not.toBe(0);
    expect(a.stderr).toContain("not done");
    const b = await werk("followup", "app/99", "--class", "plan", "--found", "review", "--why", "missing rule");
    expect(b.code).not.toBe(0);
    expect(b.stderr).toContain("no ticket");
    expect((await werk("followup", "app/02", "--list")).stdout.trim()).toBe("");
  });
  test("43.5 last correction is class in force", async () => {
    seed(planned("app/01"), ...toDone("app/01"), {
      type: "ticket.followup_recorded", id: "app/01", class: "build", found: "after-merge", why: "orig", catchable: true,
    });
    await fu("--class", "plan", "--found", "after-merge", "--why", "the card never said 15 minutes", "--of", "1");
    const l1 = (await fu("--list")).stdout;
    expect(l1).toMatch(/1\. corrected by 2, in force: plan miss/);
    expect(l1).toMatch(/correction of 1/);
    await fu("--class", "build", "--found", "after-merge", "--why", "the card does say 15 minutes", "--catchable", "yes", "--of", "1");
    const l2 = (await fu("--list")).stdout;
    
    expect(l2).toMatch(/1\. corrected by 3, in force: build miss/);
  });
});
