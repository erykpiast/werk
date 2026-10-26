// Held-out steps 10.1-10.5: notes on a card's thread, in a real browser and on the command line.
import { readFileSync } from "node:fs";
import { join } from "node:path";
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
  await p
    .getByRole("link", { name: /Login uses magic links/ })
    .first()
    .click();
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Login uses magic links");
  const note = notes(p).filter({ hasText: "Should expired links show a retry button?" });
  await expect(note).toHaveCount(1);
  await expect(note).toContainText("agent");
});

test("10.2 the inbox reads the person's notes after a position, capped by count", async ({ page: p }) => {
  const w = await project();
  w.seed("node.added", { id: "auth-login", kind: "card", title: "Login uses magic links", parent: "root" });
  await p.goto(`${w.url}/map/auth-login`);
  for (const t of ["first", "second", "third", "fourth"]) await typeNote(p, t);

  const all = w.werk("inbox");
  const order = ["first", "second", "third", "fourth"].map((t) => all.indexOf(t));
  for (const i of order) expect(i).toBeGreaterThanOrEqual(0);
  expect([...order].sort((a, b) => a - b)).toEqual(order);
  // Each note carries its card id and its log position; read "first"'s position from the log.
  const log = readFileSync(join(w.dir, ".werk", "log.jsonl"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { seq: number; type: string; payload: { text?: string } });
  const firstSeq = log.find((e) => e.type === "note.added" && e.payload.text === "first")?.seq;
  expect(firstSeq).toBeDefined();
  const firstBlock = all.slice(0, all.indexOf("first"));
  expect(firstBlock).toContain("auth-login");
  expect(firstBlock).toContain(String(firstSeq));

  const since = w.werk("inbox", "--since", String(firstSeq));
  expect(since).not.toContain("first");
  for (const t of ["second", "third", "fourth"]) expect(since).toContain(t);
  const capped = w.werk("inbox", "--since", String(firstSeq), "-n", "2");
  expect(capped).toContain("second");
  expect(capped).toContain("third");
  expect(capped).not.toContain("fourth");
  expect(capped).not.toContain("first");
});

test("10.3 a corrected ghost keeps its earlier notes, with one marker", async ({ page: p }) => {
  const w = await project();
  w.werk("add", "auth-retry", "--title", "Retry sends a new link", "--parent", "root");
  await p.goto(`${w.url}/map/auth-retry`);
  await expect(p.locator('[data-tag="proposed"]')).toBeVisible();
  await typeNote(p, "No — retry must reuse the same link");
  w.werk("say", "auth-retry", "Understood, I will correct it");
  w.werk("discard", "auth-retry");
  w.werk("add", "auth-retry", "--title", "Retry reuses the same link", "--parent", "root");

  await p.goto(`${w.url}/map/auth-retry`);
  await expect(thread(p)).toContainText("No — retry must reuse the same link");
  await expect(thread(p)).toContainText("Understood, I will correct it");
  const markers = thread(p).locator('[data-entry="marker"]');
  await expect(markers).toHaveCount(1);
  await expect(markers).toContainText("proposed again");
  const texts = await entries(p).allTextContents();
  const mi = texts.findIndex((t) => t.includes("proposed again"));
  expect(texts.findIndex((t) => t.includes("No — retry must reuse"))).toBeLessThan(mi);
  expect(texts.findIndex((t) => t.includes("Understood, I will correct it"))).toBeLessThan(mi);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Retry reuses the same link");

  await typeNote(p, "Good, accept");
  const after = await entries(p).allTextContents();
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
  expect(w.werk("inbox")).toMatch(/cache-ttl[\s\S]*Why 60 seconds\?/);

  w.werk("add", "cache-ttl", "--title", "The cache keeps an entry for 30 seconds", "--parent", "root");
  await p.goto(`${w.url}/map/cache-ttl`);
  const markers = thread(p).locator('[data-entry="marker"]');
  await expect(markers).toHaveCount(1);
  const texts = await entries(p).allTextContents();
  const ni = texts.findIndex((t) => t.includes("Why 60 seconds?"));
  expect(ni).toBeGreaterThanOrEqual(0);
  expect(ni).toBeLessThan(texts.findIndex((t) => t.includes("proposed again")));
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
