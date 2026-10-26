import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { served, stop, type Werk } from "./e2e-project.ts";

test.afterEach(stop);

const thread = (p: Page) => p.locator('[data-section="thread"]');
const notes = (p: Page) => thread(p).locator('[data-entry="note"]');
const evidence = (p: Page) => p.locator('[data-section="evidence"] [data-link="supported_by"]');

async function typeNote(p: Page, text: string): Promise<void> {
  await p.getByRole("textbox", { name: "Note" }).fill(text);
  await p.getByRole("button", { name: "Add note" }).click();
  await expect(p.getByRole("textbox", { name: "Note" })).toHaveValue("");
  await expect(notes(p).filter({ hasText: text })).toHaveCount(1);
}

function conversation(w: Werk): void {
  mkdirSync(join(w.dir, ".werk", "chats"), { recursive: true });
  const line = {
    speaker: "person",
    at: "2026-02-01T10:00:00Z",
    session: "s1",
    kind: "spoken",
    text: "we bill per seat, never per call",
  };
  writeFileSync(join(w.dir, ".werk", "chats", "pricing.jsonl"), `${JSON.stringify(line)}\n`);
}

async function decidedBilling(): Promise<Werk> {
  const w = await served();
  w.seed("node.added", {
    id: "billing",
    kind: "card",
    title: "We bill per seat",
    why: "Seats are what customers count.",
    parent: "root",
  });
  w.seed("node.decided", { id: "billing" });
  conversation(w);
  return w;
}

test("06.1 a new excerpt for a card stages as a ghost and waits for the ✓", async ({ page: p }) => {
  const w = await decidedBilling();
  const out = w.werk("quote", "billing", "pricing", "we bill per seat");
  expect(out).toContain("proposed");
  expect(out).not.toContain("added");

  await p.goto(`${w.url}/map/billing:ex0`);
  await expect(p.locator("article[data-card]")).toHaveAttribute("data-proposed", "true");
  await expect(p.locator('[data-tag="proposed"]')).toBeVisible();
  await expect(p.getByRole("button", { name: /accept/i })).toBeVisible();

  await p.goto(`${w.url}/map/billing`);
  const row = evidence(p);
  await expect(row).toHaveCount(1);
  await expect(row).toHaveAttribute("data-pending", "true");
  await expect(row.locator('[data-mark="pending"]')).toBeVisible();
  await expect(p.locator('article [data-tag="status"]')).toHaveText("decided");
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("We bill per seat");
  await expect(p.locator('[data-field="why"]')).toContainText("Seats are what customers count.");
  await expect(p.locator('article [data-tag="proposed"]')).toHaveCount(0);
  await expect(p.locator('article [data-tag="pending"]')).toHaveCount(0);
});

test("06.2 an accepted excerpt stops being a ghost and its link goes live", async ({ page: p }) => {
  const w = await decidedBilling();
  w.werk("quote", "billing", "pricing", "we bill per seat");
  await p.goto(`${w.url}/map/billing:ex0`);
  await expect(p.locator("article[data-card]")).toHaveAttribute("data-proposed", "true");

  await p.getByRole("button", { name: /accept/i }).click();
  await expect(p.locator("article[data-card]")).toHaveAttribute("data-proposed", "false");
  await expect(p.locator('[data-tag="proposed"]')).toHaveCount(0);

  await p.goto(`${w.url}/map/billing`);
  const row = evidence(p);
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("we bill per seat");
  await expect(row).toHaveAttribute("data-pending", "false");
  await expect(row.locator('[data-mark="pending"]')).toHaveCount(0);
  await expect(p.getByRole("button", { name: /accept/i })).toHaveCount(0);
});

test("10.1 an agent's note appears on the card's thread in the map", async ({ page: p }) => {
  const w = await served();
  w.seed("node.added", { id: "auth-login", kind: "card", title: "Login uses magic links", parent: "root" });
  w.seed("node.decided", { id: "auth-login" });
  w.werk("say", "auth-login", "Should expired links show a retry button?");

  await p.goto(`${w.url}/map`);
  await p.getByRole("link", { name: /Login uses magic links/ }).click();
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Login uses magic links");
  const note = notes(p).filter({ hasText: "Should expired links show a retry button?" });
  await expect(note).toHaveCount(1);
  await expect(note.locator('[data-role="author"]')).toHaveText(/agent/i);
});

test("10.2 the agent reads the person's notes in the inbox, after a log position and capped by count", async ({
  page: p,
}) => {
  const w = await served();
  w.seed("node.added", { id: "auth-login", kind: "card", title: "Login uses magic links", parent: "root" });
  await p.goto(`${w.url}/map/auth-login`);
  for (const text of ["first", "second", "third", "fourth"]) await typeNote(p, text);

  const all = w.werk("inbox");
  const order = ["first", "second", "third", "fourth"].map((text) => all.search(new RegExp(`^\\s*${text}\\s*$`, "m")));
  expect(order.every((at) => at >= 0)).toBe(true);
  expect([...order].sort((a, b) => a - b)).toEqual(order);
  // Each note shows its card id and its log position.
  const heads = [...all.matchAll(/^\[(\d+)\]\s+#?(\S+)/gm)];
  expect(heads.length).toBe(4);
  expect(heads.every((head) => head[2] === "auth-login")).toBe(true);
  const firstSeq = heads[0]?.[1] as string;

  const since = w.werk("inbox", "--since", firstSeq);
  expect(since).not.toMatch(/^\s*first\s*$/m);
  for (const text of ["second", "third", "fourth"]) expect(since).toMatch(new RegExp(`^\\s*${text}\\s*$`, "m"));

  const capped = w.werk("inbox", "--since", firstSeq, "-n", "2");
  expect(capped).toMatch(/^\s*second\s*$/m);
  expect(capped).toMatch(/^\s*third\s*$/m);
  expect(capped).not.toMatch(/^\s*(first|fourth)\s*$/m);
});

test("10.3 a corrected ghost keeps its earlier notes, with one marker where the new words begin", async ({
  page: p,
}) => {
  const w = await served();
  w.werk("add", "auth-retry", "--title", "Retry sends a new link", "--parent", "root");
  await p.goto(`${w.url}/map/auth-retry`);
  await expect(p.locator('article [data-tag="proposed"]')).toBeVisible();
  await typeNote(p, "No — retry must reuse the same link");
  w.werk("say", "auth-retry", "Understood, I will correct it");

  w.werk("discard", "auth-retry");
  w.werk("add", "auth-retry", "--title", "Retry reuses the same link", "--parent", "root");
  await p.goto(`${w.url}/map/auth-retry`);
  const entries = thread(p).locator("[data-entry]");
  await expect(entries).toHaveCount(3);
  await expect(entries.nth(0)).toContainText("No — retry must reuse the same link");
  await expect(entries.nth(1)).toContainText("Understood, I will correct it");
  await expect(entries.nth(2)).toHaveAttribute("data-entry", "marker");
  await expect(entries.nth(2)).toContainText("proposed again");
  await expect(thread(p).getByText("proposed again")).toHaveCount(1);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Retry reuses the same link");

  await typeNote(p, "Good, accept");
  await expect(entries).toHaveCount(4);
  await expect(entries.nth(3)).toContainText("Good, accept");
});

test("10.4 a note on a discarded ghost stays in the inbox and on the thread", async ({ page: p }) => {
  const w = await served();
  w.werk("add", "cache-ttl", "--title", "Cache entries live 60 seconds", "--parent", "root");
  await p.goto(`${w.url}/map/cache-ttl`);
  await typeNote(p, "Why 60 seconds?");

  w.werk("discard", "cache-ttl");
  const inbox = w.werk("inbox");
  expect(inbox).toContain("Why 60 seconds?");
  expect(inbox).toMatch(/cache-ttl/);

  w.werk("add", "cache-ttl", "--title", "Cache entries live 30 seconds", "--parent", "root");
  await p.goto(`${w.url}/map/cache-ttl`);
  const entries = thread(p).locator("[data-entry]");
  await expect(entries).toHaveCount(2);
  await expect(entries.nth(0)).toContainText("Why 60 seconds?");
  await expect(entries.nth(1)).toHaveAttribute("data-entry", "marker");
  await expect(entries.nth(1)).toContainText("proposed again");
});

test("10.5 an agent writes a note on an excerpt", async ({ page: p }) => {
  const w = await served();
  w.seed("node.added", { id: "retry", kind: "card", title: "Retry reuses the link", parent: "root" });
  w.seed("node.added", { id: "src-rfc", kind: "source", title: "RFC on retries", url: "https://example.invalid/rfc" });
  w.seed("edge.added", { from: "retry", to: "src-rfc", type: "supported_by" });
  w.seed("excerpt.quoted", {
    id: "src-rfc-quote",
    title: "a retry must not change the request",
    card: "retry",
    conversation: "rfc",
    session: "s1",
    message: 0,
    start: 0,
    end: 35,
    speaker: "person",
    said_at: "2026-02-01T10:00:00Z",
  });
  const run = w.run("say", "src-rfc-quote", "This quote supports the retry decision");
  expect(run.code).toBe(0);

  await p.goto(`${w.url}/map/src-rfc-quote`);
  await expect(p.locator("article[data-card]")).toBeVisible();
  await expect(notes(p).filter({ hasText: "This quote supports the retry decision" })).toHaveCount(1);
});
