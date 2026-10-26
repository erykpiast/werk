import { afterEach, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cardRead, shapeRead } from "../../src/serve/read-api.ts";
import { decided, mapOf, mk, type Project } from "./h.ts";

let p: Project | undefined;
afterEach(() => p?.dispose());

function chat(project: Project) {
  const dir = join(project.dir, ".werk", "chats");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "pricing.jsonl"),
    `${JSON.stringify({ speaker: "person", at: "10:02", session: "6ae61be7", kind: "spoken", text: "we bill per seat" })}\n`,
  );
}

test("06.1 + 06.2 excerpt stages as ghost, accept makes it live", async () => {
  const { project, werk } = mk(decided("x", { title: "We charge per seat", why: "because" }));
  p = project;
  chat(project);
  const cardBefore = (await werk("show", "x")).stdout;
  const q = await werk("quote", "x", "pricing", "bill per seat");
  expect(q.code).toBe(0);
  expect(q.stdout).toContain("proposed");
  expect(q.stdout).not.toContain("added");
  // the map: ghost node, held (pending) edge, card unchanged
  let m = mapOf(project);
  expect(m.nodes.get("x:ex0")?.proposed).toBe(true);
  expect(m.edges.some((e) => e.to === "x:ex0" || e.from === "x:ex0")).toBe(false);
  expect(m.ghostEdges.some((e) => e.from === "x" && e.to === "x:ex0" && e.type === "supported_by")).toBe(true);
  expect(shapeRead(m).edges.find((e) => e.to === "x:ex0")?.held).toBe(true);
  const shown = (await werk("show", "x:ex0")).stdout;
  expect(shown).toContain("proposed");
  expect(m.nodes.get("x")?.status).toBe("decided");
  expect(m.nodes.get("x")?.title).toBe("We charge per seat");
  expect((await werk("show", "x")).stdout.split("\n")[0]).toBe(cardBefore.split("\n")[0]);

  // 06.2: the person accepts
  const a = await werk("accept", "x:ex0", "--actor", "you");
  expect(a.code).toBe(0);
  m = mapOf(project);
  expect(m.nodes.get("x:ex0")?.proposed).toBe(false);
  expect(m.ghostEdges.length).toBe(0);
  expect(m.edges.some((e) => e.from === "x" && e.to === "x:ex0" && e.type === "supported_by")).toBe(true);
  const view = cardRead(m, "x");
  expect(view?.neighbours.some((n) => n.id === "x:ex0" && n.type === "supported_by")).toBe(true);
  const cli = (await werk("show", "x")).stdout;
  expect(cli).toContain("Say:\n  person: bill per seat");
  expect(cli).not.toContain("proposed");
});
