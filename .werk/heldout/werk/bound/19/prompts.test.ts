// Step 19 (1-4): the person starts a build pass, sends a chat message, or samples options.
// Each runs in a temp project with the fake agent, which records the prompt it was started with.
import { expect, test } from "bun:test";
import { project } from "./helpers.ts";

function rules(p: ReturnType<typeof project>, n: number) {
  p.real("how", "How this project is built");
  for (let i = 1; i <= n; i++) p.real(`rule-${i}`, `Rule number ${i} holds`, "how", { status: "decided" });
}

async function verbExists(p: ReturnType<typeof project>, args: string[]) {
  const r = await p.werk(args);
  return { r, exists: !r.err.includes("unknown verb") };
}

test("19.1", async () => {
  const p = project();
  rules(p, 3);
  p.real("ticket-1", "First ticket");
  const { r, exists } = await verbExists(p, ["build", "ticket-1"]);
  expect(exists, r.err.split("\n")[0]).toBe(true);
  expect(p.launches().length).toBeGreaterThan(0);
});

test("19.2", async () => {
  const p = project();
  rules(p, 2);
  const chat = await verbExists(p, ["chat", "hello"]);
  expect(chat.exists, chat.r.err.split("\n")[0]).toBe(true);
  const sample = await verbExists(p, ["sample", "rule-1"]);
  expect(sample.exists, sample.r.err.split("\n")[0]).toBe(true);
});

test("19.3", async () => {
  const p = project();
  p.real("how", "How this project is built");
  p.real("ticket-1", "First ticket");
  const { r, exists } = await verbExists(p, ["build", "ticket-1"]);
  expect(exists, r.err.split("\n")[0]).toBe(true);
});

test("19.4", async () => {
  const p = project();
  rules(p, 2);
  p.real("ticket-1", "First ticket");
  const { r, exists } = await verbExists(p, ["build", "ticket-1"]);
  expect(exists, r.err.split("\n")[0]).toBe(true);
});
