import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { project, stop, type Werk } from "../e2e/project.ts";

test.afterEach(stop);

const real = (w: Pick<Werk, "seed">, id: string, title: string, parent = "root", extra: Record<string, unknown> = {}) =>
  w.seed("node.added", { id, kind: "card", title, parent, why: `why ${id}`, ...extra });
const thread = (p: Page) => p.locator('[data-section="thread"]');
const notes = (p: Page) => thread(p).locator('[data-entry="note"]');
async function typeNote(p: Page, text: string) {
  await p.getByRole("textbox", { name: "Note" }).fill(text);
  await p.getByRole("button", { name: "Add note" }).click();
  await expect(p.getByRole("textbox", { name: "Note" })).toHaveValue("");
}

test("[10.1] an agent's note shows on the card's thread", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    real(d, "auth-login", "Login uses magic links");
    d.seed("node.decided", { id: "auth-login" });
  });
  w.werk("say", "auth-login", "Should expired links show a retry button?");
  await p.goto(`${w.url}/map`);
  await p.locator('a[data-tile="auth-login"]').click();
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Login uses magic links");
  const n = notes(p).filter({ hasText: "Should expired links show a retry button?" });
  await expect(n).toHaveCount(1);
  await expect(n.locator('[data-role="author"]')).toHaveText("agent");
});

test("[10.2] the inbox reads notes typed in the map", async ({ page: p }) => {
  const w = await project(undefined, (d) => real(d, "auth-login", "Login"));
  await p.goto(`${w.url}/map/auth-login`);
  for (const t of ["first", "second", "third", "fourth"]) await typeNote(p, t);
  const all = w.werk("inbox");
  console.log(all);
  const entries = [...all.matchAll(/^\[(\d+)\] #(\S+)[^\n]*\n\s+(\S+)$/gm)].map(([, seq, id, text]) => ({ seq: seq as string, id, text }));
  expect(entries.map((e) => e.text)).toEqual(["first", "second", "third", "fourth"]);
  expect(entries.every((e) => e.id === "auth-login")).toBe(true);
  const first = entries[0]?.seq as string;
  const since = w.werk("inbox", "--since", first);
  expect(since).not.toContain("first");
  for (const t of ["second", "third", "fourth"]) expect(since).toContain(t);
  const capped = w.werk("inbox", "--since", first, "-n", "2");
  expect(capped).toContain("second");
  expect(capped).toContain("third");
  expect(capped).not.toContain("fourth");
});

test("[10.3] a corrected ghost keeps its notes, one marker", async ({ page: p }) => {
  const w = await project();
  w.werk("add", "auth-retry", "--title", "Retry sends a new link", "--why", "w", "--parent", "root");
  await p.goto(`${w.url}/map/auth-retry`);
  await expect(p.locator('[data-tag="proposed"]')).toBeVisible();
  await typeNote(p, "No — retry must reuse the same link");
  w.werk("say", "auth-retry", "Understood, I will correct it");
  await expect(notes(p)).toHaveCount(2);
  w.werk("discard", "auth-retry");
  w.werk("add", "auth-retry", "--title", "Retry reuses the same link", "--why", "w", "--parent", "root");
  await p.goto(`${w.url}/map/auth-retry`);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Retry reuses the same link");
  const entries = thread(p).locator("[data-entry]");
  await expect(entries).toHaveCount(3);
  await expect(entries.nth(0)).toContainText("No — retry must reuse the same link");
  await expect(entries.nth(1)).toContainText("Understood, I will correct it");
  await expect(entries.nth(2)).toContainText("proposed again");
  await expect(thread(p).getByText("proposed again")).toHaveCount(1);
  await typeNote(p, "Good, accept");
  const after = thread(p).locator("[data-entry]");
  await expect(after).toHaveCount(4);
  await expect(after.nth(2)).toContainText("proposed again");
  await expect(after.nth(3)).toContainText("Good, accept");
});

test("[10.4] a note on a discarded ghost stays in the inbox and on the thread", async ({ page: p }) => {
  const w = await project();
  w.werk("add", "cache-ttl", "--title", "TTL is 60 seconds", "--why", "w", "--parent", "root");
  await p.goto(`${w.url}/map/cache-ttl`);
  await typeNote(p, "Why 60 seconds?");
  w.werk("discard", "cache-ttl");
  const inbox = w.werk("inbox");
  expect(inbox).toContain("Why 60 seconds?");
  expect(inbox).toContain("cache-ttl");
  w.werk("add", "cache-ttl", "--title", "TTL is 60 seconds", "--why", "w", "--parent", "root");
  await p.goto(`${w.url}/map/cache-ttl`);
  const entries = thread(p).locator("[data-entry]");
  await expect(entries).toHaveCount(2);
  await expect(entries.nth(0)).toContainText("Why 60 seconds?");
  await expect(entries.nth(1)).toContainText("proposed again");
});

test("[10.5] an agent's note on an excerpt", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    real(d, "rfc-card", "RFC card");
    d.seed("node.added", { id: "src-rfc", kind: "source", title: "The RFC" });
    d.seed("excerpt.quoted", {
      id: "src-rfc-quote",
      card: "rfc-card",
      title: "retry with backoff",
      conversation: "c",
      session: "s",
      message: 0,
      start: 0,
      end: 18,
      speaker: "you",
      said_at: "t",
    });
    d.seed("change.accepted", { id: "src-rfc-quote" });
  });
  const out = w.werk("say", "src-rfc-quote", "This quote supports the retry decision");
  console.log(out);
  await p.goto(`${w.url}/map/src-rfc-quote`);
  await expect(notes(p).filter({ hasText: "This quote supports the retry decision" })).toHaveCount(1);
});
