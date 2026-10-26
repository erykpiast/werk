import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { project, stop } from "../e2e/project.ts";

test.afterEach(stop);

async function typeNote(p: Page, text: string) {
  await p.getByRole("textbox", { name: "Note" }).fill(text);
  await p.getByRole("button", { name: "Add note" }).click();
  await expect(p.getByRole("textbox", { name: "Note" })).toHaveValue("");
}
const thread = (p: Page) => p.locator('[data-section="thread"]');
const notes = (p: Page) => thread(p).locator('[data-entry="note"]');

test("[10.1] an agent's note appears on the card's thread in the map", async ({ page: p }) => {
  const w = await project();
  w.seed("node.added", { id: "auth-login", kind: "card", title: "Login uses magic links", parent: "root", status: "decided", who: "me" });
  w.werk("say", "auth-login", "Should expired links show a retry button?");
  await p.goto(`${w.url}/map`);
  await p.getByRole("link", { name: /Login uses magic links/ }).click();
  const note = notes(p).filter({ hasText: "Should expired links show a retry button?" });
  await expect(note).toHaveCount(1);
  await expect(note.locator('[data-role="author"]')).toHaveText("agent");
});

test("[10.2] the agent reads the person's notes in the inbox, after a log position, capped by count", async ({ page: p }) => {
  const w = await project();
  w.seed("node.added", { id: "auth-login", kind: "card", title: "Login", parent: "root" });
  await p.goto(`${w.url}/map/auth-login`);
  for (const t of ["first", "second", "third", "fourth"]) await typeNote(p, t);
  const out = w.werk("inbox");
  const entries = [...out.matchAll(/\[(\d+)\]\s+#?(\S+)[^\n]*\n\s+(\S+)/g)].map((m) => ({ seq: m[1], id: m[2], text: m[3] }));
  expect(entries.map((e) => e.text)).toEqual(["first", "second", "third", "fourth"]);
  expect(entries.every((e) => e.id.includes("auth-login"))).toBe(true);
  const first = entries[0]?.seq as string;
  const a = w.werk("inbox", "--since", first);
  expect(a).toContain("second");
  expect(a).toContain("third");
  expect(a).toContain("fourth");
  expect(a).not.toContain("first");
  const b = w.werk("inbox", "--since", first, "-n", "2");
  expect(b).toContain("second");
  expect(b).toContain("third");
  expect(b).not.toContain("fourth");
  expect(b).not.toContain("first");
});

test("[10.3] a corrected ghost keeps its earlier notes, with one marker where the new words begin", async ({ page: p }) => {
  const w = await project();
  w.werk("add", "auth-retry", "--title", "Retry sends a new link", "--parent", "root");
  await p.goto(`${w.url}/map/auth-retry`);
  await expect(p.locator('[data-tag="proposed"]')).toBeVisible();
  await typeNote(p, "No — retry must reuse the same link");
  w.werk("say", "auth-retry", "Understood, I will correct it");
  w.werk("discard", "auth-retry");
  w.werk("add", "auth-retry", "--title", "Retry reuses the same link", "--parent", "root");
  await p.goto(`${w.url}/map/auth-retry`);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Retry reuses the same link");
  const entries = thread(p).locator("[data-entry]");
  await expect(entries).toHaveCount(3);
  await expect(entries.nth(0)).toContainText("No — retry must reuse the same link");
  await expect(entries.nth(1)).toContainText("Understood, I will correct it");
  await expect(entries.nth(2)).toContainText("proposed again");
  await expect(thread(p).locator('[data-entry="marker"]')).toHaveCount(1);
  await typeNote(p, "Good, accept");
  await expect(entries).toHaveCount(4);
  await expect(entries.nth(3)).toContainText("Good, accept");
});

test("[10.4] a note on a discarded ghost stays in the inbox and on the thread", async ({ page: p }) => {
  const w = await project();
  w.werk("add", "cache-ttl", "--title", "The cache keeps an entry for 60 seconds", "--parent", "root");
  await p.goto(`${w.url}/map/cache-ttl`);
  await typeNote(p, "Why 60 seconds?");
  w.werk("discard", "cache-ttl");
  expect(w.werk("inbox")).toMatch(/cache-ttl[\s\S]*Why 60 seconds\?/);
  w.werk("add", "cache-ttl", "--title", "The cache keeps an entry for 30 seconds", "--parent", "root");
  await p.goto(`${w.url}/map/cache-ttl`);
  const entries = thread(p).locator("[data-entry]");
  await expect(entries).toHaveCount(2);
  await expect(entries.nth(0)).toContainText("Why 60 seconds?");
  await expect(entries.nth(1)).toContainText("proposed again");
});

test("[10.5] an agent writes a note on an excerpt", async ({ page: p }) => {
  const w = await project();
  w.seed("node.added", { id: "src-rfc", kind: "source", title: "RFC 6749", url: "https://x" });
  mkdirSync(join(w.dir, ".werk", "chats"), { recursive: true });
  writeFileSync(join(w.dir, ".werk", "chats", "oauth.jsonl"), `${JSON.stringify({ speaker: "person", at: "t", session: "s", kind: "spoken", text: "The client MAY retry the request." })}\n`);
  w.werk("quote", "root", "oauth", "MAY retry");
  // The excerpt "#src-rfc-quote" of the step: here, the excerpt that the quote wrote.
  const out = w.werk("say", "root:ex0", "This quote supports the retry decision");
  expect(out).toContain("written");
  await p.goto(`${w.url}/map/root:ex0`);
  await expect(p.locator('[data-tag="kind"]')).toHaveText("excerpt");
  await expect(notes(p).filter({ hasText: "This quote supports the retry decision" })).toHaveCount(1);
});

test("[06.2] an accepted excerpt stops being a ghost and its link goes live", async ({ page: p }) => {
  const w = await project();
  w.seed("node.added", { id: "billing", kind: "card", title: "We bill per seat", parent: "root", status: "decided", who: "me" });
  mkdirSync(join(w.dir, ".werk", "chats"), { recursive: true });
  writeFileSync(join(w.dir, ".werk", "chats", "pricing.jsonl"), `${JSON.stringify({ speaker: "person", at: "t0", session: "s1", kind: "spoken", text: "seats are the unit we bill" })}\n`);
  w.werk("quote", "billing", "pricing", "seats are the unit");
  await p.goto(`${w.url}/map/billing:ex0`);
  await expect(p.locator('[data-tag="proposed"]')).toBeVisible();
  await p.getByRole("button", { name: /accept/i }).click();
  await expect(p.locator('[data-tag="proposed"]')).toHaveCount(0);
  await p.goto(`${w.url}/map/billing`);
  const row = p.locator('[data-section="say"] [data-link="supported_by"]');
  await expect(row).toContainText("seats are the unit");
  await expect(row).toHaveAttribute("data-pending", "false");
  expect(w.werk("show", "billing")).not.toContain("held");
});
