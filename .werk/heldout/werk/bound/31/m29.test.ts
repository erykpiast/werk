import { afterEach, beforeEach, expect, test } from "bun:test";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { readBoard } from "../src/board/log-store.ts";
import { card, createProject, decided, ev, type Project, werk } from "./support.ts";

let p: Project;
beforeEach(() => {
  p = createProject();
  mkdirSync(join(p.dir, ".werk"), { recursive: true });
});
afterEach(() => p.dispose());

const boardPath = () => join(p.dir, ".werk", "board.jsonl");
const seedBoard = (...events: unknown[]) =>
  appendFileSync(boardPath(), events.map((e) => `${JSON.stringify(e)}\n`).join(""));

function subtree() {
  decided(p, "root", "Root");
  decided(p, "cited", "Cited card", { parent: "root", body: "old body" });
}

test("29.1 a second plan extends the spec and continues the ticket numbers", async () => {
  subtree();
  seedBoard(
    { type: "ticket.planned", id: "run1/01", title: "One" },
    { type: "ticket.planned", id: "run1/02", title: "Two" },
    { type: "ticket.planned", id: "run1/03", title: "Three" },
  );
  decided(p, "added", "Added card", { parent: "root" });
  const r = await werk(p, "plan", "root");
  expect(r.code, `plan exit ${r.code}: ${r.stderr}`).toBe(0);
  const b = readBoard(boardPath());
  expect(b.tickets.has("run1/04")).toBe(true);
});

test("29.2 an unneeded open ticket is archived by the re-plan", async () => {
  subtree();
  seedBoard({ type: "ticket.planned", id: "run1/01", title: "Delivers cited" });
  ev(p, { type: "node.removed", id: "cited" });
  const r = await werk(p, "plan", "root");
  expect(r.code, `plan exit ${r.code}: ${r.stderr}`).toBe(0);
  expect(readBoard(boardPath()).tickets.get("run1/01")?.archived).toBe(true);
});

test("29.3 retitling a cited card blocks the ready ticket", async () => {
  subtree();
  seedBoard({ type: "ticket.planned", id: "run1/01", title: "Cites cited" });
  const a = await werk(p, "propose", "cited", "--title", "A new title");
  expect(a.code, a.stderr).toBe(0);
  const b = await werk(p, "accept", "cited", "--actor", "you");
  expect(b.code, b.stderr).toBe(0);
  const t = readBoard(boardPath()).tickets.get("run1/01");
  expect(t?.column, "ticket column after the retitle").toBe("blocked");
  expect(t?.reason).toContain("cited");
  expect(t?.reason).toContain("title");
});

test("29.4 a body change blocks the ready ticket, a note does not", async () => {
  subtree();
  seedBoard({ type: "ticket.planned", id: "run1/01", title: "Cites cited" });
  const n = await werk(p, "say", "cited", "a note");
  expect(n.code, n.stderr).toBe(0);
  expect(readBoard(boardPath()).tickets.get("run1/01")?.column).toBe("ready");
  const a = await werk(p, "propose", "cited", "--ops", JSON.stringify([{ tag: "elaborated", old: "old body", new: "new body" }]));
  expect(a.code, a.stderr).toBe(0);
  const b = await werk(p, "accept", "cited", "--actor", "you");
  expect(b.code, b.stderr).toBe(0);
  const t = readBoard(boardPath()).tickets.get("run1/01");
  expect(t?.column, "ticket column after the body change").toBe("blocked");
  expect(t?.reason).toContain("body");
});

test("29.5 a card added under a planned subtree reports a failed check", async () => {
  subtree();
  seedBoard({ type: "ticket.planned", id: "run1/01", title: "Cites cited" });
  card(p, "fresh", "Fresh card", { parent: "root" });
  const r = await werk(p, "plan", "root");
  const out = `${r.stdout}\n${r.stderr}`;
  expect(r.code, `plan exit ${r.code}: ${out}`).toBe(0);
  expect(out).toContain("cards-cited");
  expect(out).toContain("fresh");
});
