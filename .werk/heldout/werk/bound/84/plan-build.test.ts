import { expect, test } from "bun:test";
import { appendBoardEvent } from "../src/board/log.ts";
import { join } from "node:path";
import { mapProject, withTarget } from "./plan-helpers.ts";

// No build verb is registered in this checkout: every step that starts a build runs `werk build <ticket>`.
async function build() {
  const p = mapProject([{ id: "app" }]);
  await withTarget(p);
  appendBoardEvent(join(p.dir, ".werk", "board.jsonl"), "ticket.planned", { id: "app/01", title: "T", blocked_by: [] });
  return { p, run: await p.werk(["build", "app/01"]) };
}

test("84.1", async () => {
  const { run } = await build();
  expect(run.err).not.toContain("no verb");
  expect(run.code).toBe(0);
});

test("84.2", async () => {
  const { run } = await build();
  expect(run.err).not.toContain("no verb");
  expect(run.code).toBe(0);
});

test("84.3", async () => {
  const { run } = await build();
  expect(run.err).not.toContain("no verb");
  expect(run.code).toBe(0);
});

test("84.4", async () => {
  const { run } = await build();
  expect(run.err).not.toContain("no verb");
  expect(run.code).toBe(0);
});

test("84.5", async () => {
  const { run } = await build();
  expect(run.err).not.toContain("no verb");
  expect(run.code).toBe(0);
});

test("85.1", async () => {
  const { run } = await build();
  expect(run.err).not.toContain("no verb");
  expect(run.code).toBe(0);
});

test("85.2", async () => {
  const { run } = await build();
  expect(run.err).not.toContain("no verb");
  expect(run.code).toBe(0);
});

test("85.3", async () => {
  const { run } = await build();
  expect(run.err).not.toContain("no verb");
  expect(run.code).toBe(0);
});

test("85.4", async () => {
  const { run } = await build();
  expect(run.err).not.toContain("no verb");
  expect(run.code).toBe(0);
});
