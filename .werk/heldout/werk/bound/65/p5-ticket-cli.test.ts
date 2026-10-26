import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createProject, type Project } from "../src/test-env/project.ts";

const CLI = join(import.meta.dir, "..", "src", "cli.ts");
let project: Project;
beforeEach(() => {
  project = createProject();
});
afterEach(() => project.dispose());
const werk = (...args: string[]) => project.run(["bun", CLI, ...args]);
const boardPath = () => join(project.dir, ".werk", "board.jsonl");
const seed = (...events: unknown[]) => {
  mkdirSync(join(project.dir, ".werk"), { recursive: true });
  writeFileSync(
    boardPath(),
    events.map((e) => `${JSON.stringify(e)}\n`).join(""),
  );
};
const board = () => readFileSync(boardPath(), "utf8");
const boardLines = () =>
  board()
    .split("\n")
    .filter((l) => l !== "")
    .map((l) => JSON.parse(l));
const decisionLog = () => {
  try {
    return readFileSync(project.logPath, "utf8");
  } catch {
    return "";
  }
};
const ok = (r: { code: number; stderr: string; stdout: string }, what: string) =>
  expect(r.code, `${what}: exit ${r.code}: ${r.stderr}${r.stdout}`).toBe(0);

test("27.1 archive a blocked ticket and restore it to the same column and reason", async () => {
  seed({ type: "ticket.planned", id: "auth/01", title: "T1" });
  writeFileSync(project.logPath, "");
  const logBefore = decisionLog();
  ok(
    await werk("ticket", "move", "auth/01", "blocked", "--reason", "waits for the token API"),
    "ticket move",
  );
  ok(await werk("ticket", "archive", "auth/01"), "ticket archive");
  const listed = await werk("ticket", "list");
  ok(listed, "ticket list");
  expect(listed.stdout).toContain("auth/01");
  expect(listed.stdout).toMatch(/archived/i);
  expect(listed.stdout).toContain("blocked");
  expect(listed.stdout).toContain("waits for the token API");
  const before = boardLines().length;
  ok(await werk("ticket", "restore", "01", "--actor", "you"), "ticket restore");
  const after = await werk("ticket", "list");
  expect(after.stdout).toContain("blocked");
  expect(after.stdout).toContain("waits for the token API");
  expect(after.stdout).not.toMatch(/archived/i);
  const added = boardLines().slice(before);
  expect(added).toHaveLength(1);
  expect(added[0]).toMatchObject({ type: "ticket.restored", actor: "you" });
  expect(decisionLog()).toBe(logBefore);
});

test("27.2 a move without a reason is refused", async () => {
  seed({ type: "ticket.planned", id: "auth/01", title: "T1" });
  const before = board();
  const r = await werk("ticket", "move", "auth/01", "blocked");
  expect(r.code, r.stderr).not.toBe(0);
  expect(r.stderr).toMatch(/reason/i);
  expect(r.stderr).not.toMatch(/needs the subverb restore/);
  const listed = await werk("ticket", "list");
  ok(listed, "ticket list");
  expect(listed.stdout).toMatch(/ready[\s\S]*auth\/01|auth\/01[\s\S]*ready/);
  expect(board()).toBe(before);
});

test("27.3 restoring a ticket that is not archived, or not on the board, changes nothing", async () => {
  seed({ type: "ticket.planned", id: "auth/02", title: "T2" });
  const before = board();
  const a = await werk("ticket", "restore", "02");
  expect(a.code, a.stderr).toBe(1);
  expect(board()).toBe(before);
  const b = await werk("ticket", "restore", "99");
  expect(b.code, b.stderr).toBe(1);
  expect(board()).toBe(before);
});

test("27.4 a done ticket cannot be archived", async () => {
  seed(
    { type: "ticket.planned", id: "auth/03", title: "T3" },
    { type: "ticket.moved", id: "auth/03", to: "building", actor: "you" },
    { type: "ticket.moved", id: "auth/03", to: "merging", actor: "loop" },
    { type: "ticket.merge", id: "auth/03" },
  );
  const before = board();
  const r = await werk("ticket", "archive", "auth/03");
  expect(r.code, r.stderr).not.toBe(0);
  expect(r.stderr).toMatch(/done/i);
  expect(r.stderr).not.toMatch(/needs the subverb restore/);
  const listed = await werk("ticket", "list");
  ok(listed, "ticket list");
  expect(listed.stdout).toContain("done");
  expect(listed.stdout).not.toMatch(/archived/i);
  expect(board()).toBe(before);
});

test("27.5 the listing shows every ticket in the column its events lead to", async () => {
  seed(
    { type: "ticket.planned", id: "auth/01", title: "T1", actor: "plan" },
    { type: "ticket.planned", id: "auth/02", title: "T2", actor: "plan" },
    { type: "ticket.planned", id: "auth/03", title: "T3", actor: "plan" },
  );
  ok(await werk("ticket", "move", "auth/02", "blocked", "--reason", "needs input"), "move");
  ok(await werk("ticket", "archive", "auth/03"), "archive");
  const listed = await werk("ticket", "list");
  ok(listed, "ticket list");
  const lineOf = (id: string) =>
    listed.stdout.split("\n").find((l) => l.includes(id)) ?? "";
  expect(lineOf("auth/01")).toMatch(/ready/);
  expect(lineOf("auth/02")).toMatch(/blocked/);
  expect(lineOf("auth/02")).toContain("needs input");
  expect(lineOf("auth/03")).toMatch(/archived/i);
  for (const e of boardLines()) expect(typeof e.actor).toBe("string");
});
