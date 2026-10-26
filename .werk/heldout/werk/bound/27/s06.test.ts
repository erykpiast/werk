import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cardRead } from "../src/serve/read-api.ts";
import { createProject, decidedEvents, logLines, mapOf, ok, type Project, seed, shape, werk } from "./support.ts";

let p: Project;
beforeEach(() => {
  p = createProject();
});
afterEach(() => p.dispose());

const setup = () => {
  seed(p, decidedEvents("x", { title: "We charge per seat" }));
  const dir = join(p.dir, ".werk", "chats");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "pricing.jsonl"),
    `${JSON.stringify({ speaker: "person", at: "10:02", session: "6ae61be7", kind: "spoken", text: "yes: seats are the unit we bill" })}\n`,
  );
};

test("06.1 a new excerpt stages as a ghost and waits for the check", async () => {
  setup();
  const before = mapOf(p).nodes.get("x");
  const r = await werk(p, "quote", "x", "pricing", "seats are the unit we bill");
  expect(r.code, r.stderr).toBe(0);
  expect(r.stdout).toContain("proposed");
  expect(r.stdout).not.toContain("added");
  const s = shape(p);
  const ex = s.nodes.find((n) => n.kind === "excerpt");
  expect(ex?.proposed).toBe(true);
  const edge = s.edges.find((e) => e.from === ex?.id || e.to === ex?.id);
  expect(edge?.held).toBe(true);
  const after = mapOf(p).nodes.get("x");
  expect(after?.status).toBe(before?.status);
  expect(after?.title).toBe(before?.title);
  expect(after?.why).toBe(before?.why);
  expect(after?.body).toBe(before?.body);
});

test("06.2 an accepted excerpt stops being a ghost and its link goes live", async () => {
  setup();
  await ok(p, "quote", "x", "pricing", "seats are the unit we bill");
  const id = shape(p).nodes.find((n) => n.kind === "excerpt")?.id as string;
  const n = logLines(p);
  await ok(p, "accept", id, "--actor", "you");
  expect(logLines(p)).toBe(n + 1);
  const s = shape(p);
  expect(s.nodes.find((x) => x.id === id)?.proposed).toBe(false);
  const edge = s.edges.find((e) => e.from === id || e.to === id);
  expect(edge?.held).toBe(false);
  const card = cardRead(mapOf(p), "x");
  expect(card?.neighbours.map((nb) => nb.id)).toContain(id);
  expect(card?.neighbours.find((nb) => nb.id === id)?.type).toBe("supported_by");
});
