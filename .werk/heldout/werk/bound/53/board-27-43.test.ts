import { expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createProject, lines, type Project, werk } from "./support.ts";

const boardPath = (p: Project) => join(p.dir, ".werk", "board.jsonl");
const board = (p: Project) =>
  existsSync(boardPath(p)) ? readFileSync(boardPath(p), "utf8") : "";
const writeBoard = (p: Project, events: unknown[]) => {
  mkdirSync(join(p.dir, ".werk"), { recursive: true });
  writeFileSync(boardPath(p), `${events.map((e) => JSON.stringify(e)).join("\n")}\n`);
};
const planned = (id: string, title = `Ticket ${id}`) => ({ type: "ticket.planned", id, title });
const done = (id: string) => [
  planned(id),
  { type: "ticket.moved", id, to: "building", actor: "loop" },
  { type: "ticket.moved", id, to: "merging", actor: "loop" },
  { type: "ticket.merge", id },
];

async function withBoard<T>(events: unknown[], body: (p: Project) => Promise<T>) {
  const p = createProject();
  try {
    writeBoard(p, events);
    return await body(p);
  } finally {
    await p.dispose();
  }
}

test("27.1 archive a blocked ticket and restore it to the same column and reason", async () => {
  await withBoard([planned("auth/01")], async (p) => {
    const move = await werk(p, "ticket", "move", "auth/01", "blocked", "--reason", "waits for the token API");
    expect(move.stderr).toBe("");
    expect(move.code).toBe(0);
    expect((await werk(p, "ticket", "archive", "auth/01")).code).toBe(0);
    const list = (await werk(p, "ticket", "list")).stdout;
    expect(list).toMatch(/auth\/01.*archived/);
    expect(list).toContain("blocked");
    expect(list).toContain("waits for the token API");
    const before = lines(board(p)).length;
    expect((await werk(p, "ticket", "restore", "01", "--actor", "you")).code).toBe(0);
    const after = (await werk(p, "ticket", "list")).stdout;
    expect(after).toMatch(/blocked[\s\S]*auth\/01/);
    expect(after).toContain("waits for the token API");
    expect(lines(board(p)).length).toBe(before + 1);
    expect(JSON.parse(lines(board(p)).at(-1) as string).actor).toBe("you");
  });
});

test("27.2 a move without a reason is refused", async () => {
  await withBoard([planned("auth/01")], async (p) => {
    const before = board(p);
    const r = await werk(p, "ticket", "move", "auth/01", "blocked");
    expect(r.code).not.toBe(0);
    expect(r.stderr).toMatch(/reason/);
    const list = (await werk(p, "ticket", "list")).stdout;
    expect(list).toMatch(/auth\/01.*ready/);
    expect(board(p)).toBe(before);
  });
});

test("27.3 restoring a ticket that is not archived changes nothing", async () => {
  await withBoard([planned("auth/02")], async (p) => {
    const before = board(p);
    const first = await werk(p, "ticket", "restore", "02");
    expect(first.code).toBe(1);
    expect(board(p)).toBe(before);
    const second = await werk(p, "ticket", "restore", "99");
    expect(second.code).toBe(1);
    expect(board(p)).toBe(before);
  });
});

test("27.4 a done ticket cannot be archived", async () => {
  await withBoard(done("auth/03"), async (p) => {
    const before = board(p);
    const r = await werk(p, "ticket", "archive", "auth/03");
    expect(r.code).not.toBe(0);
    expect(r.stderr).toMatch(/done/);
    expect(r.stderr).toMatch(/archiv/);
    const list = (await werk(p, "ticket", "list")).stdout;
    expect(list).toMatch(/auth\/03.*done/);
    expect(list).not.toMatch(/auth\/03.*archived/);
    expect(board(p)).toBe(before);
  });
});

test("27.5 the board listing shows every ticket in the column its events lead to", async () => {
  await withBoard([planned("auth/01"), planned("auth/02"), planned("auth/03")], async (p) => {
    expect((await werk(p, "ticket", "move", "auth/02", "blocked", "--reason", "needs a key")).code).toBe(0);
    expect((await werk(p, "ticket", "archive", "auth/03")).code).toBe(0);
    const list = (await werk(p, "ticket", "list")).stdout;
    expect(list).toMatch(/auth\/01.*ready/);
    expect(list).toMatch(/auth\/02.*blocked.*needs a key/);
    expect(list).toMatch(/auth\/03.*archived/);
    for (const l of lines(board(p))) expect(JSON.parse(l).actor).toBeTruthy();
  });
});

const FOLLOW = ["followup", "app/01"];

test("43.1 a build miss on a done ticket is recorded and listed", async () => {
  await withBoard(done("app/01"), async (p) => {
    const rec = await werk(p, ...FOLLOW, "--class", "build", "--found", "after-merge", "--why", "the link expires after 1 minute, the card says 15", "--catchable", "yes");
    expect(rec.code, rec.stderr).toBe(0);
    expect(rec.stdout).toContain("recorded");
    const list = (await werk(p, ...FOLLOW, "--list")).stdout;
    expect(list).toMatch(/record 1|^1\b|#1|\b1\b/);
    expect(list).toContain("build");
    expect(list).toMatch(/after.merge/);
    expect(list).toContain("the link expires after 1 minute, the card says 15");
    expect(list).toMatch(/catch[^\n]*yes/i);
  });
});

test("43.2 a plan miss is recorded without a catchable answer", async () => {
  await withBoard(done("app/01"), async (p) => {
    const rec = await werk(p, ...FOLLOW, "--class", "plan", "--found", "review", "--why", "no card said how long the link lasts");
    expect(rec.code, rec.stderr).toBe(0);
    expect(rec.stdout).toContain("recorded");
    const list = (await werk(p, ...FOLLOW, "--list")).stdout;
    expect(list).toContain("plan");
    expect(list).toMatch(/review/);
    expect(list).toContain("no card said how long the link lasts");
    expect(list).not.toMatch(/catch/i);
  });
});

test("43.3 a wrong catchable answer is refused and nothing is recorded", async () => {
  await withBoard(done("app/01"), async (p) => {
    const a = await werk(p, ...FOLLOW, "--class", "build", "--found", "review", "--why", "the button label is wrong");
    expect(a.code).not.toBe(0);
    expect(a.stderr).toMatch(/build miss needs (the )?catchable answer/);
    const b = await werk(p, ...FOLLOW, "--class", "plan", "--found", "review", "--why", "the card was silent", "--catchable", "no");
    expect(b.code).not.toBe(0);
    expect(b.stderr).toMatch(/plan miss has no catchable answer|does not take a catchable answer/);
    const list = await werk(p, ...FOLLOW, "--list");
    expect(list.stdout.trim()).toBe("");
  });
});

test("43.4 a ticket that is not done, or does not exist, is refused", async () => {
  await withBoard(
    [planned("app/02"), { type: "ticket.moved", id: "app/02", to: "building", actor: "loop" }],
    async (p) => {
      const a = await werk(p, "followup", "app/02", "--class", "build", "--found", "review", "--why", "rename the button", "--catchable", "no");
      expect(a.code).not.toBe(0);
      expect(a.stderr).toMatch(/not done/);
      const b = await werk(p, "followup", "app/99", "--class", "plan", "--found", "review", "--why", "missing rule");
      expect(b.code).not.toBe(0);
      expect(b.stderr).toMatch(/no ticket app\/99|does not exist/);
      const list = await werk(p, "followup", "app/02", "--list");
      expect(list.stdout.trim()).toBe("");
    },
  );
});

test("43.5 the last correction of a record is the class in force", async () => {
  await withBoard(done("app/01"), async (p) => {
    expect((await werk(p, ...FOLLOW, "--class", "build", "--found", "after-merge", "--why", "the link expires", "--catchable", "yes")).code).toBe(0);
    const c1 = await werk(p, ...FOLLOW, "--class", "plan", "--found", "after-merge", "--why", "the card never said 15 minutes", "--of", "1");
    expect(c1.code, c1.stderr).toBe(0);
    const l1 = (await werk(p, ...FOLLOW, "--list")).stdout;
    expect(l1).toMatch(/1[^\n]*plan[^\n]*in force|in force[^\n]*plan/);
    expect(l1).toMatch(/corrects[^\n]*1|1[^\n]*correct/i);
    const c2 = await werk(p, ...FOLLOW, "--class", "build", "--found", "after-merge", "--why", "the card does say 15 minutes", "--catchable", "yes", "--of", "1");
    expect(c2.code, c2.stderr).toBe(0);
    const l2 = (await werk(p, ...FOLLOW, "--list")).stdout;
    expect(l2).toMatch(/1[^\n]*build[^\n]*in force|in force[^\n]*build/);
  });
});
