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
const raw = () => readFileSync(boardPath(), "utf8");
const events = () =>
  raw()
    .split("\n")
    .filter((l) => l !== "")
    .map((l) => JSON.parse(l));
const listed = async () => (await werk("ticket", "list")).stdout;
const lineOf = (text: string, id: string) =>
  text.split("\n").find((l) => l.includes(id)) ?? "";

test("27.1 archive a blocked ticket and restore it to the same column and reason", async () => {
  seed({ type: "ticket.planned", id: "auth/01", title: "T" });
  const decisionBefore = "";
  const moved = await werk(
    "ticket",
    "move",
    "auth/01",
    "blocked",
    "--reason",
    "waits for the token API",
  );
  const archived = await werk("ticket", "archive", "auth/01");
  const list1 = await listed();
  expect({ moved: moved.code, archived: archived.code }).toEqual({
    moved: 0,
    archived: 0,
  });
  expect(lineOf(list1, "auth/01")).toContain("archived");
  expect(lineOf(list1, "auth/01")).toContain("blocked");
  expect(lineOf(list1, "auth/01")).toContain("waits for the token API");
  const before = events().length;
  const restored = await werk("ticket", "restore", "01", "--actor", "you");
  expect(restored.code).toBe(0);
  const list2 = await listed();
  expect(lineOf(list2, "auth/01")).toContain("blocked");
  expect(lineOf(list2, "auth/01")).not.toContain("archived");
  expect(lineOf(list2, "auth/01")).toContain("waits for the token API");
  const evs = events();
  expect(evs.length).toBe(before + 1);
  expect(evs.at(-1)).toMatchObject({ type: "ticket.restored", actor: "you" });
  expect(decisionBefore).toBe("");
});

test("27.2 a move to blocked without a reason is refused", async () => {
  seed({ type: "ticket.planned", id: "auth/01", title: "T" });
  const before = raw();
  const r = await werk("ticket", "move", "auth/01", "blocked");
  expect(r.code).not.toBe(0);
  expect(r.stderr).toMatch(/reason/);
  expect(lineOf(await listed(), "auth/01")).toContain("ready");
  expect(raw()).toBe(before);
});

test("27.3 restoring a ticket that is not archived changes nothing", async () => {
  seed({ type: "ticket.planned", id: "auth/02", title: "T" });
  const before = raw();
  const a = await werk("ticket", "restore", "02");
  expect(a.code).toBe(1);
  expect(raw()).toBe(before);
  const b = await werk("ticket", "restore", "99");
  expect(b.code).toBe(1);
  expect(raw()).toBe(before);
});

test("27.4 a done ticket cannot be archived", async () => {
  seed(
    { type: "ticket.planned", id: "auth/03", title: "T" },
    { type: "ticket.moved", id: "auth/03", to: "building" },
    { type: "ticket.moved", id: "auth/03", to: "merging", actor: "loop" },
    { type: "ticket.merge", id: "auth/03" },
  );
  const before = raw();
  const r = await werk("ticket", "archive", "auth/03");
  expect(r.code).not.toBe(0);
  expect(r.stderr).toMatch(/done/);
  expect(r.stderr).toMatch(/archiv/);
  const l = lineOf(await listed(), "auth/03");
  expect(l).toContain("done");
  expect(l).not.toContain("archived");
  expect(raw()).toBe(before);
});

test("27.5 the listing shows every ticket in the column its events lead to", async () => {
  seed(
    { type: "ticket.planned", id: "auth/01", title: "A" },
    { type: "ticket.planned", id: "auth/02", title: "B" },
    { type: "ticket.planned", id: "auth/03", title: "C" },
  );
  await werk("ticket", "move", "auth/02", "blocked", "--reason", "needs x");
  await werk("ticket", "archive", "auth/03");
  const out = await listed();
  expect(lineOf(out, "auth/01")).toContain("ready");
  expect(lineOf(out, "auth/02")).toContain("blocked");
  expect(lineOf(out, "auth/02")).toContain("needs x");
  expect(lineOf(out, "auth/03")).toContain("archived");
  for (const e of events().slice(3)) expect(e.actor).toBeTruthy();
});
