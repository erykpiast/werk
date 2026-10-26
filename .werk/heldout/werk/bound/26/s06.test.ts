import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readMap } from "../src/map/log-store.ts";
import { renderCardPage } from "../src/serve/card-page.ts";
import { createProject, dec, type Project, runner, seed } from "./helpers.ts";

let project: Project;
beforeEach(() => {
  project = createProject();
});
afterEach(() => project.dispose());

function chat() {
  const dir = join(project.dir, ".werk", "chats");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "pricing.jsonl"),
    `${JSON.stringify({ speaker: "person", at: "10:02", session: "6ae61be7", kind: "spoken", text: "we bill per seat, always" })}\n`,
  );
}

test("06.1 a new excerpt stages as a ghost with a pending link", async () => {
  const w = runner(project);
  seed(project, dec("x", undefined, { title: "We charge per seat", body: "words of x" }));
  chat();
  const before = (await w("show", "x")).stdout;
  const q = await w("quote", "x", "pricing", "per seat");
  expect(q.code).toBe(0);
  expect(q.stdout).toContain("proposed");
  expect(q.stdout).not.toContain("added");
  const map = readMap(project.logPath).map;
  expect(map.nodes.get("x:ex0")?.proposed).toBe(true);
  expect(map.ghostEdges.some((e) => e.from === "x" && e.to === "x:ex0")).toBe(true);
  expect(map.edges.some((e) => e.to === "x:ex0")).toBe(false);
  const after = (await w("show", "x")).stdout;
  expect(after).toContain("x:ex0");
  expect(after).toMatch(/x:ex0.*\[proposed\]/);
  expect(after).toContain("[decided]");
  expect(after).toContain("words of x");
  expect(after.split("\n")[0]).toBe(before.split("\n")[0]);
});

test("06.2 an accepted excerpt is live without a second accept", async () => {
  const w = runner(project);
  seed(project, dec("x", undefined, { title: "We charge per seat" }));
  chat();
  await w("quote", "x", "pricing", "per seat");
  const acc = await w("accept", "x:ex0", "--actor", "you");
  expect(acc.code).toBe(0);
  const map = readMap(project.logPath).map;
  expect(map.nodes.get("x:ex0")?.proposed).toBe(false);
  expect(map.edges.some((e) => e.from === "x" && e.to === "x:ex0")).toBe(true);
  expect(map.ghostEdges.length).toBe(0);
  const shown = (await w("show", "x")).stdout;
  expect(shown).toMatch(/supported_by\s+x:ex0/);
  expect(shown).not.toMatch(/x:ex0.*\[(proposed|held)\]/);
  const html = renderCardPage(map, map.nodes.get("x") as never);
  expect(html).toContain("x:ex0");
});
