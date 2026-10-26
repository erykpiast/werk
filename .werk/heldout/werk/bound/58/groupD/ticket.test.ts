import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createProject, type Project } from "../../src/test-env/project.ts";

const CLI = join(import.meta.dir, "..", "..", "src", "cli.ts");
let project: Project;
beforeEach(() => {
  project = createProject();
});
afterEach(() => project.dispose());
const werk = (...args: string[]) => project.run(["bun", CLI, ...args]);
const boardPath = () => join(project.dir, ".werk", "board.jsonl");
const seed = (...events: unknown[]) => {
  mkdirSync(join(project.dir, ".werk"), { recursive: true });
  writeFileSync(boardPath(), events.map((e) => `${JSON.stringify(e)}\n`).join(""));
};
const raw = () => readFileSync(boardPath(), "utf8");
const lines = () => raw().trim().split("\n");
const decisionLog = () => {
  try { return readFileSync(project.logPath, "utf8"); } catch { return ""; }
};

test("27.1 archive blocked ticket and restore", async () => {
  seed({ type: "ticket.planned", id: "auth/01", title: "T" });
  const decisions = decisionLog();
  const mv = await werk("ticket", "move", "auth/01", "blocked", "--reason", "waits for the token API");
  expect(mv.code, mv.stderr).toBe(0);
  const ar = await werk("ticket", "archive", "auth/01");
  expect(ar.code, ar.stderr).toBe(0);
  const list = await werk("ticket", "list");
  expect(list.stdout).toContain("auth/01");
  expect(list.stdout).toContain("archived");
  expect(list.stdout).toContain("blocked");
  expect(list.stdout).toContain("waits for the token API");
  const before = lines().length;
  const rs = await werk("ticket", "restore", "01", "--actor", "you");
  expect(rs.code, rs.stderr).toBe(0);
  expect(lines().length).toBe(before + 1);
  expect(JSON.parse(lines().at(-1) as string).actor).toBe("you");
  const list2 = await werk("ticket", "list");
  expect(list2.stdout).toContain("blocked");
  expect(list2.stdout).not.toContain("archived");
  expect(decisionLog()).toBe(decisions);
});

test("27.2 move without reason refused", async () => {
  seed({ type: "ticket.planned", id: "auth/01", title: "T" });
  const before = raw();
  const mv = await werk("ticket", "move", "auth/01", "blocked");
  expect(mv.code).not.toBe(0);
  expect(mv.stderr.toLowerCase()).toContain("reason");
  const list = await werk("ticket", "list");
  expect(list.stdout).toContain("ready");
  expect(raw()).toBe(before);
});

test("27.3 restore of non-archived or unknown changes nothing", async () => {
  seed({ type: "ticket.planned", id: "auth/02", title: "T" });
  const before = raw();
  const a = await werk("ticket", "restore", "02");
  expect(a.code).toBe(1);
  expect(raw()).toBe(before);
  const b = await werk("ticket", "restore", "99");
  expect(b.code).toBe(1);
  expect(raw()).toBe(before);
});

test("27.4 done ticket cannot be archived", async () => {
  seed(
    { type: "ticket.planned", id: "auth/03", title: "T" },
    { type: "ticket.moved", id: "auth/03", to: "building" },
    { type: "ticket.moved", id: "auth/03", to: "merging", actor: "loop" },
    { type: "ticket.merge", id: "auth/03" },
  );
  const before = raw();
  const r = await werk("ticket", "archive", "auth/03");
  expect(r.code).not.toBe(0);
  expect(r.stderr.toLowerCase()).toContain("done");
  expect(r.stderr.toLowerCase()).toContain("archive");
  const list = await werk("ticket", "list");
  expect(list.stdout).toContain("done");
  expect(list.stdout).not.toContain("archived");
  expect(raw()).toBe(before);
});

test("27.5 board listing", async () => {
  seed(
    { type: "ticket.planned", id: "auth/01", title: "A" },
    { type: "ticket.planned", id: "auth/02", title: "B" },
    { type: "ticket.planned", id: "auth/03", title: "C" },
  );
  const m = await werk("ticket", "move", "auth/02", "blocked", "--reason", "why not");
  expect(m.code, m.stderr).toBe(0);
  const a = await werk("ticket", "archive", "auth/03");
  expect(a.code, a.stderr).toBe(0);
  const list = await werk("ticket", "list");
  expect(list.code, list.stderr).toBe(0);
  const out = list.stdout.split("\n");
  expect(out.find((l) => l.includes("auth/01"))).toContain("ready");
  const l2 = out.find((l) => l.includes("auth/02")) ?? "";
  expect(l2).toContain("blocked");
  expect(l2).toContain("why not");
  expect(out.find((l) => l.includes("auth/03"))).toContain("archived");
  for (const l of lines()) expect(JSON.parse(l).actor).toBeTruthy();
});
