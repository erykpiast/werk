// Held-out steps 10.1-10.5: notes on a card's thread, from the command line and from the map.
import { expect, type Page, test } from "@playwright/test";
import { project, stop } from "../e2e/project.ts";

test.afterEach(stop);

const thread = (p: Page) => p.locator('[data-section="thread"]');
const notes = (p: Page) => thread(p).locator('[data-entry="note"]');

async function typeNote(p: Page, text: string): Promise<void> {
  await p.getByRole("textbox", { name: "Note" }).fill(text);
  await p.getByRole("button", { name: "Add note" }).click();
  await expect(thread(p)).toContainText(text);
}

test("10.1 an agent's note appears on the card's thread in the map", async ({ page: p }) => {
  const w = await project();
  w.seed("node.added", { id: "auth-login", kind: "card", title: "Login uses magic links", parent: "root" });
  w.seed("node.decided", { id: "auth-login" });
  w.werk("say", "auth-login", "Should expired links show a retry button?");
  await p.goto(`${w.url}/map`);
  await p.getByText("Login uses magic links").first().click();
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Login uses magic links");
  const note = notes(p).filter({ hasText: "Should expired links show a retry button?" });
  await expect(note).toHaveCount(1);
  await expect(note).toContainText("agent");
});

test("10.2 the agent reads the inbox after a log position, capped by count", async ({ page: p }) => {
  const w = await project();
  w.seed("node.added", { id: "auth-login", kind: "card", title: "Login", parent: "root" });
  await p.goto(`${w.url}/map/auth-login`);
  for (const text of ["first", "second", "third", "fourth"]) await typeNote(p, text);
  const all = w.werk("inbox");
  const order = ["first", "second", "third", "fourth"].map((t) => all.indexOf(t));
  expect(order.every((i) => i >= 0)).toBe(true);
  expect([...order].sort((a, b) => a - b)).toEqual(order);
  const entries = [...all.matchAll(/^\[(\d+)\] #(\S+)/gm)];
  expect(entries).toHaveLength(4);
  expect(entries.every((e) => e[2] === "auth-login")).toBe(true);
  const first = entries[0]?.[1] as string;
  const since = w.werk("inbox", "--since", first);
  expect(since).not.toContain("first");
  for (const t of ["second", "third", "fourth"]) expect(since).toContain(t);
  const capped = w.werk("inbox", "--since", first, "-n", "2");
  expect(capped).toContain("second");
  expect(capped).toContain("third");
  expect(capped).not.toContain("fourth");
  expect(capped).not.toContain("first");
});

test("10.3 a corrected ghost keeps its earlier notes, with one marker where the new words begin", async ({
  page: p,
}) => {
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
  await expect(thread(p)).toContainText("No — retry must reuse the same link");
  await expect(thread(p)).toContainText("Understood, I will correct it");
  await expect(thread(p).locator('[data-entry="marker"]')).toHaveCount(1);
  await expect(thread(p).locator('[data-entry="marker"]')).toContainText("proposed again");
  const texts = await entries.allInnerTexts();
  const markerAt = texts.findIndex((t) => t.includes("proposed again"));
  expect(texts.findIndex((t) => t.includes("No — retry"))).toBeLessThan(markerAt);
  expect(texts.findIndex((t) => t.includes("Understood"))).toBeLessThan(markerAt);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Retry reuses the same link");
  await typeNote(p, "Good, accept");
  const after = await entries.allInnerTexts();
  expect(after.findIndex((t) => t.includes("Good, accept"))).toBeGreaterThan(
    after.findIndex((t) => t.includes("proposed again")),
  );
});

test("10.4 a note on a discarded ghost stays in the inbox and on the thread", async ({ page: p }) => {
  const w = await project();
  w.werk("add", "cache-ttl", "--title", "The cache keeps an entry for 60 seconds", "--parent", "root");
  await p.goto(`${w.url}/map/cache-ttl`);
  await typeNote(p, "Why 60 seconds?");
  w.werk("discard", "cache-ttl");
  expect(w.werk("inbox")).toMatch(/#cache-ttl[\s\S]*Why 60 seconds\?/);
  w.werk("add", "cache-ttl", "--title", "The cache keeps an entry for 60 seconds", "--parent", "root");
  await p.goto(`${w.url}/map/cache-ttl`);
  const entries = thread(p).locator("[data-entry]");
  await expect(thread(p).locator('[data-entry="marker"]')).toHaveCount(1);
  const texts = await entries.allInnerTexts();
  const marker = texts.findIndex((t) => t.includes("proposed again"));
  const note = texts.findIndex((t) => t.includes("Why 60 seconds?"));
  expect(note).toBeGreaterThanOrEqual(0);
  expect(note).toBeLessThan(marker);
});

test("10.5 an agent writes a note on an excerpt", async ({ page: p }) => {
  const w = await project();
  w.seed("node.added", { id: "src-rfc", kind: "source", title: "RFC 6749", url: "https://example.com/rfc" });
  w.seed("excerpt.quoted", {
    id: "src-rfc-quote",
    title: "The client MAY retry the request.",
    card: "root",
    conversation: "oauth",
    session: "s1",
    message: 0,
    start: 0,
    end: 33,
    speaker: "person",
    said_at: "t0",
  });
  w.werk("say", "src-rfc-quote", "This quote supports the retry decision");
  await p.goto(`${w.url}/map/src-rfc-quote`);
  await expect(notes(p).filter({ hasText: "This quote supports the retry decision" })).toHaveCount(1);
});
