import { expect, type Page, test } from "@playwright/test";
import { project, stop } from "../e2e/project.ts";

test.afterEach(stop);

async function typeNote(p: Page, text: string): Promise<void> {
  await p.getByRole("textbox", { name: "Note" }).fill(text);
  await p.getByRole("button", { name: "Add note" }).click();
  await expect(p.getByRole("textbox", { name: "Note" })).toHaveValue("");
}
const thread = (p: Page) => p.locator('[data-section="thread"]');
const notes = (p: Page) => thread(p).locator('[data-entry="note"]');

test("10.1 agent note shows on thread, by agent", async ({ page: p }) => {
  const w = await project();
  w.seed("node.added", { id: "auth-login", kind: "card", title: "Login uses magic links", parent: "root" });
  w.seed("node.decided", { id: "auth-login" });
  w.werk("say", "auth-login", "Should expired links show a retry button?");
  await p.goto(`${w.url}/map`);
  await p.getByRole("link", { name: /Login uses magic links/ }).click();
  const note = notes(p).filter({ hasText: "Should expired links show a retry button?" });
  await expect(note).toHaveCount(1);
  await expect(note.locator('[data-role="author"]')).toHaveText("agent");
});

test("10.2 inbox order, since, cap", async ({ page: p }) => {
  const w = await project();
  w.seed("node.added", { id: "auth-login", kind: "card", title: "Login", parent: "root" });
  await p.goto(`${w.url}/map/auth-login`);
  for (const t of ["first", "second", "third", "fourth"]) await typeNote(p, t);
  const all = w.werk("inbox");
  const order = ["first", "second", "third", "fourth"].map((t) => all.indexOf(t));
  expect([...order].sort((a, b) => a - b)).toEqual(order);
  expect(order.every((i) => i >= 0)).toBe(true);
  expect(all).toContain("auth-login");
  const m = all.match(/\[(\d+)\][^\n]*\n[^\n]*first/);
  expect(m).not.toBeNull();
  const pos = m?.[1] as string;
  const since = w.werk("inbox", "--since", pos);
  expect(since).not.toContain("first");
  for (const t of ["second", "third", "fourth"]) expect(since).toContain(t);
  const cap = w.werk("inbox", "--since", pos, "-n", "2");
  expect(cap).toContain("second");
  expect(cap).toContain("third");
  expect(cap).not.toContain("fourth");
});

test("10.3 corrected ghost keeps notes and one marker", async ({ page: p }) => {
  const w = await project();
  w.werk("add", "auth-retry", "--title", "Retry sends a new link", "--parent", "root");
  await p.goto(`${w.url}/map/auth-retry`);
  await expect(p.locator('[data-tag="proposed"]')).toBeVisible();
  await typeNote(p, "No — retry must reuse the same link");
  w.werk("say", "auth-retry", "Understood, I will correct it");
  w.werk("discard", "auth-retry");
  w.werk("add", "auth-retry", "--title", "Retry reuses the same link", "--parent", "root");
  await p.goto(`${w.url}/map/auth-retry`);
  const entries = thread(p).locator("[data-entry]");
  await expect(entries).toHaveCount(3);
  await expect(entries.nth(0)).toContainText("No — retry must reuse the same link");
  await expect(entries.nth(1)).toContainText("Understood, I will correct it");
  await expect(entries.nth(2)).toContainText("proposed again");
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Retry reuses the same link");
  await typeNote(p, "Good, accept");
  await expect(entries).toHaveCount(4);
  await expect(entries.nth(3)).toContainText("Good, accept");
  await expect(entries.nth(2)).toContainText("proposed again");
  await expect(thread(p).locator('[data-entry="marker"]')).toHaveCount(1);
});

test("10.4 note on discarded ghost stays", async ({ page: p }) => {
  const w = await project();
  w.werk("add", "cache-ttl", "--title", "TTL is 60 seconds", "--parent", "root");
  await p.goto(`${w.url}/map/cache-ttl`);
  await typeNote(p, "Why 60 seconds?");
  w.werk("discard", "cache-ttl");
  const inbox = w.werk("inbox");
  expect(inbox).toContain("cache-ttl");
  expect(inbox).toContain("Why 60 seconds?");
  w.werk("add", "cache-ttl", "--title", "TTL is 30 seconds", "--parent", "root");
  await p.goto(`${w.url}/map/cache-ttl`);
  const entries = thread(p).locator("[data-entry]");
  await expect(entries).toHaveCount(2);
  await expect(entries.nth(0)).toContainText("Why 60 seconds?");
  await expect(entries.nth(1)).toContainText("proposed again");
});

test("10.5 agent note on excerpt", async ({ page: p }) => {
  const w = await project();
  w.seed("node.added", { id: "src-rfc", kind: "source", title: "RFC 6749", url: "https://x.example/rfc" });
  w.seed("excerpt.quoted", {
    id: "src-rfc-quote", title: "The client MAY retry.", card: "root", conversation: "oauth",
    session: "s1", message: 0, start: 0, end: 21, speaker: "person", said_at: "t0",
  });
  const out = w.werk("say", "src-rfc-quote", "This quote supports the retry decision");
  expect(out).toContain("written");
  await p.goto(`${w.url}/map/src-rfc-quote`);
  await expect(notes(p).filter({ hasText: "This quote supports the retry decision" })).toHaveCount(1);
});
