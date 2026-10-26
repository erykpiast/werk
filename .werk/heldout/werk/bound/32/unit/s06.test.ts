import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { werkHarness } from "./h.ts";

const { project, werk, decide } = werkHarness();

async function withChat() {
  await decide("auth", { title: "Auth", why: "Because" });
  const dir = join(dirname(project().logPath), "chats");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "talk.jsonl"),
    `${JSON.stringify({ kind: "spoken", speaker: "you", at: "2026-01-01T00:00:00Z", session: "s1", text: "We want magic links for login" })}\n`,
  );
}

const head = (text: string) => text.split("\n\nSay:")[0]?.trim();

test("06.1 a new excerpt stages as a ghost with a pending link; the card is unchanged", async () => {
  await withChat();
  const before = (await werk("show", "auth")).stdout;
  const q = await werk("quote", "auth", "talk", "magic links");
  expect(q.code).toBe(0);
  expect(q.stdout).toContain("proposed");
  expect(q.stdout).not.toMatch(/\badded\b/);
  const ex = (await werk("show", "auth:ex0")).stdout;
  expect(ex).toMatch(/excerpt auth:ex0.*proposed/);
  const card = (await werk("show", "auth")).stdout;
  expect(card).toMatch(/Say:\n\s+you: magic links\s+proposed/);
  expect(card).toContain("[decided]");
  expect(head(card)).toBe(head(before));
});

test("06.2 an accepted excerpt is no ghost and its link is live without a second accept", async () => {
  await withChat();
  await werk("quote", "auth", "talk", "magic links");
  const n = project().events().length;
  const acc = await werk("accept", "auth:ex0", "--actor", "you");
  expect(acc.code).toBe(0);
  expect(project().events().length).toBe(n + 1);
  const ex = (await werk("show", "auth:ex0")).stdout;
  expect(ex).not.toContain("proposed");
  const card = (await werk("show", "auth")).stdout;
  expect(card).toMatch(/Say:\n\s+you: magic links\n?$/m);
  expect(card).not.toContain("proposed");
});
