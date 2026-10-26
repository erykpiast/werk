// Held-out steps 10.1 to 10.5: notes on a card's thread, the inbox, and the "proposed again" marker.
import { expect, type Page, test } from "@playwright/test";
import { project, stop } from "../e2e/project.ts";

test.afterEach(stop);

const thread = (p: Page) => p.locator('[data-section="thread"]');
const entries = (p: Page) => thread(p).locator("[data-entry]");
const notes = (p: Page) => thread(p).locator('[data-entry="note"]');

async function typeNote(p: Page, text: string): Promise<void> {
  await p.getByRole("textbox", { name: "Note" }).fill(text);
  await p.getByRole("button", { name: "Add note" }).click();
  await expect(notes(p).filter({ hasText: text })).toHaveCount(1);
}

test("10.1 an agent's note appears on the card's thread in the map", async ({ page: p }) => {
  const w = await project();
  w.seed("node.added", { id: "auth-login", kind: "card", title: "Login uses magic links", parent: "root" });
  w.seed("node.decided", { id: "auth-login" });
  w.werk("say", "auth-login", "Should expired links show a retry button?");

  await p.goto(`${w.url}/map`);
  await p.getByRole("link", { name: /Login uses magic links/ }).click();
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Login uses magic links");
  const note = notes(p).filter({ hasText: "Should expired links show a retry button?" });
  await expect(note).toHaveCount(1);
  await expect(note.locator('[data-role="author"]')).toHaveText("agent");
});

test("10.2 the agent reads the person's notes in the inbox, after a position and capped by count", async ({
  page: p,
}) => {
  const w = await project();
  w.seed("node.added", { id: "auth-login", kind: "card", title: "Login uses magic links", parent: "root" });
  await p.goto(`${w.url}/map/auth-login`);
  for (const text of ["first", "second", "third", "fourth"]) await typeNote(p, text);

  const all = w.werk("inbox");
  const order = ["first", "second", "third", "fourth"].map((text) => all.indexOf(text));
  expect(order.every((at) => at >= 0)).toBe(true);
  expect([...order].sort((a, b) => a - b)).toEqual(order);
  // Each note shows its card id and its log position.
  const found = [...all.matchAll(/\[(\d+)\]\s+#?auth-login\b[^\n]*\n\s*(first|second|third|fourth)\b/g)];
  expect(found.map((m) => m[2])).toEqual(["first", "second", "third", "fourth"]);
  const firstSeq = found[0]?.[1] as string;

  const since = w.werk("inbox", "--since", firstSeq);
  for (const text of ["second", "third", "fourth"]) expect(since).toContain(text);
  expect(since).not.toMatch(/\bfirst\b/);

  const capped = w.werk("inbox", "--since", firstSeq, "-n", "2");
  expect(capped).toContain("second");
  expect(capped).toContain("third");
  expect(capped).not.toContain("fourth");
  expect(capped).not.toMatch(/\bfirst\b/);
});

test("10.3 a corrected ghost keeps its earlier notes, with one marker where the new words begin", async ({
  page: p,
}) => {
  const w = await project();
  w.werk("add", "auth-retry", "--title", "Retry sends a new link", "--parent", "root");
  await p.goto(`${w.url}/map/auth-retry`);
  await expect(p.locator("article[data-card]")).toHaveAttribute("data-proposed", "true");
  await typeNote(p, "No — retry must reuse the same link");
  w.werk("say", "auth-retry", "Understood, I will correct it");

  w.werk("discard", "auth-retry");
  w.werk("add", "auth-retry", "--title", "Retry reuses the same link", "--parent", "root");
  await p.goto(`${w.url}/map/auth-retry`);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Retry reuses the same link");
  await expect(entries(p).nth(0)).toContainText("No — retry must reuse the same link");
  await expect(entries(p).nth(1)).toContainText("Understood, I will correct it");
  const markers = thread(p).locator('[data-entry="marker"]');
  await expect(markers).toHaveCount(1);
  await expect(markers).toContainText("proposed again");
  await expect(entries(p).nth(2)).toHaveAttribute("data-entry", "marker");
  await expect(entries(p)).toHaveCount(3);

  await typeNote(p, "Good, accept");
  await expect(entries(p)).toHaveCount(4);
  await expect(entries(p).nth(3)).toContainText("Good, accept");
});

test("10.4 a note on a discarded ghost stays in the inbox and on the thread", async ({ page: p }) => {
  const w = await project();
  w.werk("add", "cache-ttl", "--title", "Cache entries live 60 seconds", "--parent", "root");
  await p.goto(`${w.url}/map/cache-ttl`);
  await typeNote(p, "Why 60 seconds?");

  w.werk("discard", "cache-ttl");
  expect(w.werk("inbox")).toMatch(/#?cache-ttl[\s\S]*Why 60 seconds\?/);

  w.werk("add", "cache-ttl", "--title", "Cache entries live 30 seconds", "--parent", "root");
  await p.goto(`${w.url}/map/cache-ttl`);
  await expect(entries(p).nth(0)).toContainText("Why 60 seconds?");
  await expect(thread(p).locator('[data-entry="marker"]')).toHaveCount(1);
  await expect(entries(p).nth(1)).toHaveAttribute("data-entry", "marker");
  await expect(entries(p).nth(1)).toContainText("proposed again");
});

test("10.5 an agent writes a note on an excerpt", async ({ page: p }) => {
  const w = await project();
  w.seed("node.added", {
    id: "src-rfc",
    kind: "source",
    title: "RFC 6749",
    url: "https://www.rfc-editor.org/rfc/rfc6749",
  });
  w.seed("excerpt.quoted", {
    id: "src-rfc-quote",
    title: "The client MAY retry the request.",
    card: "root",
    conversation: "rfc",
    session: "s1",
    message: 0,
    start: 0,
    end: 33,
    speaker: "person",
    said_at: "t0",
  });
  // werk() throws on a non-zero exit, so a return means the command succeeded.
  w.werk("say", "src-rfc-quote", "This quote supports the retry decision");

  await p.goto(`${w.url}/map/src-rfc-quote`);
  await expect(p.getByRole("heading", { level: 1 })).toContainText("The client MAY retry the request.");
  await expect(notes(p).filter({ hasText: "This quote supports the retry decision" })).toHaveCount(1);
});
