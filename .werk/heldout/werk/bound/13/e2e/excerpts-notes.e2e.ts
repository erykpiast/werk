// Held-out steps 06.x (an excerpt ghost and its ✓) and 10.x (notes on a card's thread).
import { expect, type Page, test } from "@playwright/test";
import { chatLog, project, thread, typeNote, type Werk } from "./werk";

const notes = (p: Page) => thread(p).locator('[data-entry="note"]');
const CHECK = (p: Page) => p.getByRole("button", { name: /✓|accept/i });

/** A map with a decided card #retry-policy under #root, and a chat to quote from. */
function decidedCard(): Werk {
  const w = project();
  w.seed("node.added", { id: "root", kind: "card", title: "Root" });
  w.seed("node.added", {
    id: "retry-policy",
    kind: "card",
    title: "Payments retry three times",
    why: "Most failures pass on a retry",
    body: "The third failure stops.",
    parent: "root",
  });
  w.seed("node.decided", { id: "retry-policy" });
  chatLog(w.dir, "payments", [{ kind: "spoken", speaker: "person", text: "three retries are enough for payments" }]);
  return w;
}

test("06.1 a new excerpt for a card stages as a ghost and waits for the ✓", async ({ page: p }) => {
  const w = decidedCard();
  await w.serve();
  const out = w.ok("quote", "retry-policy", "payments", "three retries are enough");
  expect(out).toContain("proposed");
  expect(out).not.toContain("added");
  const ex = "retry-policy:ex0";

  await p.goto(`${w.url}/map/${ex}`);
  await expect(p.locator('[data-tag="proposed"]')).toBeVisible();
  await expect(p.locator(`article[data-card="${ex}"]`)).toHaveAttribute("data-proposed", "true");

  await p.goto(`${w.url}/map/retry-policy`);
  await expect(p.locator('[data-tag="status"]')).toHaveText("decided");
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Payments retry three times");
  await expect(p.locator('[data-field="body"]')).toContainText("The third failure stops.");
  // The link from the card to the excerpt shows as pending.
  const link = p.locator(`a[href="/map/${encodeURIComponent(ex)}"], a[href="/map/${ex}"]`);
  await expect(link).toHaveCount(1, { timeout: 5000 });
  await expect(link.locator("xpath=..")).toContainText(/proposed|pending/);
  // The excerpt waits for the ✓.
  await p.goto(`${w.url}/map/${ex}`);
  await expect(CHECK(p)).toBeVisible({ timeout: 5000 });
});

test("06.2 an accepted excerpt stops being a ghost and its link goes live", async ({ page: p }) => {
  const w = decidedCard();
  await w.serve();
  w.ok("quote", "retry-policy", "payments", "three retries are enough");
  const ex = "retry-policy:ex0";
  await p.goto(`${w.url}/map/${ex}`);
  await expect(p.locator('[data-tag="proposed"]')).toBeVisible();

  await CHECK(p).click({ timeout: 5000 });
  await expect(p.locator('[data-tag="proposed"]')).toHaveCount(0);
  await p.goto(`${w.url}/map/retry-policy`);
  const link = p.locator(`a[href="/map/${encodeURIComponent(ex)}"], a[href="/map/${ex}"]`);
  await expect(link).toHaveCount(1, { timeout: 5000 });
  await expect(link.locator("xpath=..")).not.toContainText(/proposed|pending/);
  expect(w.ok("show", "retry-policy")).toMatch(new RegExp(`-> supported_by\\s+${ex}\\s.*\\S\\s*$`, "m"));
  expect(w.ok("show", "retry-policy")).not.toContain("held");
});

test("10.1 an agent's note appears on the card's thread in the map", async ({ page: p }) => {
  const w = project();
  w.seed("node.added", { id: "root", kind: "card", title: "Root" });
  w.seed("node.added", { id: "auth-login", kind: "card", title: "Login uses magic links", parent: "root" });
  w.seed("node.decided", { id: "auth-login" });
  await w.serve();
  w.ok("say", "auth-login", "Should expired links show a retry button?");
  await p.goto(`${w.url}/map`);
  await p.getByRole("link", { name: /Login uses magic links/ }).click();
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Login uses magic links");
  const note = notes(p).filter({ hasText: "Should expired links show a retry button?" });
  await expect(note).toHaveCount(1);
  await expect(note).toContainText("agent");
});

test("10.2 the agent reads the person's notes in the inbox, after a position and capped by count", async ({
  page: p,
}) => {
  const w = project();
  w.seed("node.added", { id: "root", kind: "card", title: "Root" });
  w.seed("node.added", { id: "auth-login", kind: "card", title: "Login uses magic links", parent: "root" });
  await w.serve();
  await p.goto(`${w.url}/map/auth-login`);
  for (const text of ["first", "second", "third", "fourth"]) {
    await typeNote(p, text);
    await expect(notes(p).filter({ hasText: text })).toHaveCount(1);
  }
  const all = w.ok("inbox");
  const order = ["first", "second", "third", "fourth"].map((text) => all.indexOf(text));
  expect(order.every((at) => at >= 0)).toBe(true);
  expect([...order].sort((a, b) => a - b)).toEqual(order);
  const firstLine = all.split("\n").find((line, i, list) => line.includes("first") || list[i + 1]?.includes("first"));
  expect(all).toContain("auth-login");
  const position = /\b(\d+)\b/.exec(firstLine ?? "")?.[1] as string;
  expect(position).toBeDefined();
  const since = w.ok("inbox", "--since", position);
  expect(since).not.toContain("first");
  for (const text of ["second", "third", "fourth"]) expect(since).toContain(text);
  const capped = w.ok("inbox", "--since", position, "-n", "2");
  expect(capped).toContain("second");
  expect(capped).toContain("third");
  expect(capped).not.toContain("fourth");
  expect(capped).not.toContain("first");
});

test("10.3 a corrected ghost keeps its earlier notes, with one marker where the new words begin", async ({
  page: p,
}) => {
  const w = project();
  w.seed("node.added", { id: "root", kind: "card", title: "Root" });
  await w.serve();
  w.ok("add", "auth-retry", "--title", "Retry sends a new link", "--parent", "root");
  await p.goto(`${w.url}/map/auth-retry`);
  await expect(p.locator('[data-tag="proposed"]')).toBeVisible();
  await typeNote(p, "No — retry must reuse the same link");
  w.ok("say", "auth-retry", "Understood, I will correct it");
  w.ok("discard", "auth-retry");
  w.ok("add", "auth-retry", "--title", "Retry reuses the same link", "--parent", "root");
  await p.goto(`${w.url}/map/auth-retry`);
  const entries = thread(p).locator("[data-entry]");
  await expect(entries).toHaveCount(3);
  await expect(entries.nth(0)).toContainText("No — retry must reuse the same link");
  await expect(entries.nth(1)).toContainText("Understood, I will correct it");
  await expect(entries.nth(2)).toContainText("proposed again");
  await expect(thread(p).getByText("proposed again")).toHaveCount(1);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Retry reuses the same link");
  await typeNote(p, "Good, accept");
  await expect(entries).toHaveCount(4);
  await expect(entries.nth(3)).toContainText("Good, accept");
});

test("10.4 a note on a discarded ghost stays in the inbox and on the thread", async ({ page: p }) => {
  const w = project();
  w.seed("node.added", { id: "root", kind: "card", title: "Root" });
  await w.serve();
  w.ok("add", "cache-ttl", "--title", "The cache keeps an entry for 60 seconds", "--parent", "root");
  await p.goto(`${w.url}/map/cache-ttl`);
  await typeNote(p, "Why 60 seconds?");
  await expect(notes(p).filter({ hasText: "Why 60 seconds?" })).toHaveCount(1);
  w.ok("discard", "cache-ttl");
  expect(w.ok("inbox")).toMatch(/cache-ttl[\s\S]*Why 60 seconds\?/);
  w.ok("add", "cache-ttl", "--title", "The cache keeps an entry for 30 seconds", "--parent", "root");
  await p.goto(`${w.url}/map/cache-ttl`);
  const entries = thread(p).locator("[data-entry]");
  await expect(entries).toHaveCount(2);
  await expect(entries.nth(0)).toContainText("Why 60 seconds?");
  await expect(entries.nth(1)).toContainText("proposed again");
});

test("10.5 an agent writes a note on an excerpt", async ({ page: p }) => {
  const w = project();
  w.seed("node.added", { id: "root", kind: "card", title: "Root" });
  w.seed("node.added", {
    id: "src-rfc",
    kind: "source",
    title: "RFC 6749",
    url: "https://www.rfc-editor.org/rfc/rfc6749",
  });
  // Only a quote creates an excerpt, so the Given state holds the event a quote writes.
  w.seed("excerpt.quoted", {
    id: "src-rfc-quote",
    title: "The client MAY retry the request.",
    card: "root",
    conversation: "rfc-reading",
    session: "sess-1",
    message: 0,
    start: 0,
    end: 33,
    speaker: "person",
    said_at: "2026-10-01T10:00:00Z",
  });
  await w.serve();
  const run = w.werk("say", "src-rfc-quote", "This quote supports the retry decision");
  expect(run.code).toBe(0);
  await p.goto(`${w.url}/map/src-rfc-quote`);
  await expect(notes(p).filter({ hasText: "This quote supports the retry decision" })).toHaveCount(1);
});
