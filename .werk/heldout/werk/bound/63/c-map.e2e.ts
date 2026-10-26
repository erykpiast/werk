// Held-out steps 06.1, 06.2, 10.1-10.5: excerpts and notes in the map page.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { project, stop, type Werk } from "../e2e/project.ts";

test.afterEach(stop);

const thread = (p: Page) => p.locator('[data-section="thread"]');
const notes = (p: Page) => thread(p).locator('[data-entry="note"]');
const evidence = (p: Page) => p.locator('[data-section="evidence"] [data-link="supported_by"]');

async function typeNote(p: Page, text: string): Promise<void> {
  await p.getByRole("textbox", { name: "Note" }).fill(text);
  await p.getByRole("button", { name: "Add note" }).click();
  await expect(p.getByRole("textbox", { name: "Note" })).toHaveValue("");
}

async function decidedWithChat(): Promise<Werk> {
  const w = await project();
  w.seed("node.added", { id: "billing", kind: "card", title: "We bill per seat", why: "Seats track value", parent: "root" });
  w.seed("node.decided", { id: "billing" });
  mkdirSync(join(w.dir, ".werk", "chats"));
  const line = { speaker: "person", at: "t0", session: "s1", kind: "spoken", text: "seats are the unit we bill" };
  writeFileSync(join(w.dir, ".werk", "chats", "pricing.jsonl"), `${JSON.stringify(line)}\n`);
  return w;
}

test("06.1 a new excerpt for a card stages as a ghost and waits for the check mark", async ({ page: p }) => {
  const w = await decidedWithChat();
  const showBefore = w.werk("show", "billing").split("\n").slice(0, 3).join("\n");
  const out = w.werk("quote", "billing", "pricing", "seats are the unit");
  expect(out).toContain("proposed");
  expect(out).not.toContain("added");

  await p.goto(`${w.url}/map/billing`);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("We bill per seat");
  await expect(p.locator('[data-tag="status"]')).toHaveText("decided");
  const row = evidence(p);
  await expect(row).toHaveCount(1);
  await expect(row).toHaveAttribute("data-pending", "true");
  await expect(row).toContainText("pending");
  expect(w.werk("show", "billing").split("\n").slice(0, 3).join("\n")).toBe(showBefore);

  await row.getByRole("link").click();
  await expect(p.locator("article[data-card]")).toHaveAttribute("data-proposed", "true");
  await expect(p.locator('[data-tag="proposed"]')).toBeVisible();
  await expect(p.getByRole("button", { name: /accept/i })).toBeVisible();
});

test("06.2 an accepted excerpt stops being a ghost and its link goes live", async ({ page: p }) => {
  const w = await decidedWithChat();
  w.werk("quote", "billing", "pricing", "seats are the unit");
  await p.goto(`${w.url}/map/billing:ex0`);
  await expect(p.locator('[data-tag="proposed"]')).toBeVisible();
  await p.getByRole("button", { name: /accept/i }).click();
  await expect(p.locator('[data-tag="proposed"]')).toHaveCount(0);
  await expect(p.locator("article[data-card]")).toHaveAttribute("data-proposed", "false");

  await p.goto(`${w.url}/map/billing`);
  const row = evidence(p);
  await expect(row).toContainText("seats are the unit");
  await expect(row).toHaveAttribute("data-pending", "false");
  expect(w.werk("show", "billing")).not.toContain("held");
});

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
  await expect(note).toContainText("agent");
});

test("10.2 the agent reads the person's notes in the inbox, after a position and capped", async ({ page: p }) => {
  const w = await project();
  w.seed("node.added", { id: "auth-login", kind: "card", title: "Login uses magic links", parent: "root" });
  await p.goto(`${w.url}/map/auth-login`);
  for (const text of ["first", "second", "third", "fourth"]) await typeNote(p, text);

  const all = w.werk("inbox");
  const order = ["first", "second", "third", "fourth"].map((t) => all.indexOf(t));
  expect(order.every((i) => i >= 0)).toBe(true);
  expect([...order].sort((a, b) => a - b)).toEqual(order);
  const entries = [...all.matchAll(/^\[(\d+)\] #(\S+)/gm)];
  expect(entries).toHaveLength(4);
  expect(entries.every((e) => e[2] === "auth-login")).toBe(true);
  const firstSeq = entries[0]?.[1] as string;
  const since = w.werk("inbox", "--since", firstSeq);
  expect(since).not.toMatch(/\bfirst\b/);
  for (const t of ["second", "third", "fourth"]) expect(since).toContain(t);
  const capped = w.werk("inbox", "--since", firstSeq, "-n", "2");
  expect(capped).toContain("second");
  expect(capped).toContain("third");
  expect(capped).not.toContain("fourth");
  expect(capped).not.toMatch(/\bfirst\b/);
});

test("10.3 a corrected ghost keeps its earlier notes, with one marker where the new words begin", async ({ page: p }) => {
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
  await expect(thread(p).getByText("proposed again")).toHaveCount(1);
  await typeNote(p, "Good, accept");
  await expect(entries).toHaveCount(4);
  await expect(entries.nth(3)).toContainText("Good, accept");
});

test("10.4 a note on a discarded ghost stays in the inbox and on the thread", async ({ page: p }) => {
  const w = await project();
  w.werk("add", "cache-ttl", "--title", "The cache keeps an entry for 60 seconds", "--parent", "root");
  await p.goto(`${w.url}/map/cache-ttl`);
  await typeNote(p, "Why 60 seconds?");
  w.werk("discard", "cache-ttl");
  expect(w.werk("inbox")).toMatch(/#cache-ttl[\s\S]*Why 60 seconds\?/);
  w.werk("add", "cache-ttl", "--title", "The cache keeps an entry for 30 seconds", "--parent", "root");
  await p.goto(`${w.url}/map/cache-ttl`);
  const entries = thread(p).locator("[data-entry]");
  await expect(entries).toHaveCount(2);
  await expect(entries.nth(0)).toContainText("Why 60 seconds?");
  await expect(entries.nth(1)).toContainText("proposed again");
});

test("10.5 an agent writes a note on an excerpt", async ({ page: p }) => {
  const w = await project();
  w.seed("node.added", { id: "src-rfc", kind: "source", title: "RFC 6749", url: "https://www.rfc-editor.org/rfc/rfc6749" });
  // The Given state is seeded into the log: an excerpt taken from the source, quoted for the root card.
  w.seed("excerpt.quoted", {
    id: "src-rfc-quote", title: "The client MAY retry the request.", card: "root", conversation: "oauth",
    session: "s1", message: 0, start: 0, end: 33, speaker: "person", said_at: "t0",
  });
  const id = "src-rfc-quote";
  const said = w.werk("say", id, "This quote supports the retry decision");
  expect(said.length).toBeGreaterThan(0);
  await p.goto(`${w.url}/map/${id}`);
  await expect(notes(p).filter({ hasText: "This quote supports the retry decision" })).toHaveCount(1);
});
