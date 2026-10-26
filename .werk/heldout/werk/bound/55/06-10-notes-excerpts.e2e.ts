// Scenarios 06.x (excerpt ghost and ✓) and 10.x (notes on a thread), in a real browser on a real server.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { cleanup, type Proj, project } from "./e2e-harness.ts";

test.afterEach(cleanup);

const thread = (p: Page) => p.locator('[data-section="thread"]');
const entries = (p: Page) => thread(p).locator("[data-entry]");
const notes = (p: Page) => thread(p).locator('[data-entry="note"]');

async function typeNote(p: Page, text: string) {
  const box = p.getByRole("textbox").last();
  await box.fill(text);
  await p.getByRole("button", { name: /note|send|add/i }).last().click();
  await expect(notes(p).filter({ hasText: text })).toHaveCount(1);
}

function withDecidedCard(): Proj {
  const w = project();
  w.seed("node.added", { id: "root", kind: "card", title: "Root" });
  w.seed("node.added", { id: "billing", kind: "card", title: "We bill per seat", body: "One seat is one user.", parent: "root" });
  w.seed("node.decided", { id: "billing" });
  mkdirSync(join(w.dir, ".werk", "chats"));
  writeFileSync(
    join(w.dir, ".werk", "chats", "pricing.jsonl"),
    `${JSON.stringify({ speaker: "person", at: "2026-01-01T09:00:00Z", session: "s1", kind: "spoken", text: "seats are the unit we bill" })}\n`,
  );
  return w;
}

test("06.1 a new excerpt for a card stages as a ghost and waits for the ✓", async ({ page: p }) => {
  const w = withDecidedCard();
  const out = w.werk("quote", "billing", "pricing", "seats are the unit");
  expect(out).toContain("proposed");
  expect(out).not.toContain("added");
  const s = await w.serve();

  await p.goto(`${s.url}/map/billing`);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("We bill per seat");
  await expect(p.locator('[data-tag="status"]')).toHaveText("decided");
  await expect(p.locator('[data-field="body"]')).toContainText("One seat is one user.");
  await expect(p.locator('article [data-tag="proposed"], article [data-tag="pending"]')).toHaveCount(0);
  const row = p.locator('[data-section="evidence"] li').filter({ hasText: "seats are the unit" });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("pending");

  await p.goto(`${s.url}/map/billing:ex0`);
  await expect(p.locator("article[data-card]")).toHaveAttribute("data-proposed", "true");
  await expect(p.getByRole("button", { name: /accept/i })).toBeVisible();
});

test("06.2 an accepted excerpt stops being a ghost and its link goes live", async ({ page: p }) => {
  const w = withDecidedCard();
  w.werk("quote", "billing", "pricing", "seats are the unit");
  const s = await w.serve();
  await p.goto(`${s.url}/map/billing:ex0`);
  await expect(p.locator("article[data-card]")).toHaveAttribute("data-proposed", "true");
  await p.getByRole("button", { name: /accept/i }).click();
  await expect(p.locator("article[data-card]")).toHaveAttribute("data-proposed", "false");
  await expect(p.getByRole("button", { name: /accept/i })).toHaveCount(0);

  await p.goto(`${s.url}/map/billing`);
  const row = p.locator('[data-section="evidence"] li').filter({ hasText: "seats are the unit" });
  await expect(row).toHaveCount(1);
  await expect(row).not.toContainText("pending");
  expect(w.werk("show", "billing")).not.toContain("held");
});

test("10.1 an agent's note appears on the card's thread in the map", async ({ page: p }) => {
  const w = project();
  w.seed("node.added", { id: "root", kind: "card", title: "Root" });
  w.seed("node.added", { id: "auth-login", kind: "card", title: "Login uses magic links", parent: "root" });
  w.seed("node.decided", { id: "auth-login" });
  w.werk("say", "auth-login", "Should expired links show a retry button?");
  const s = await w.serve();
  await p.goto(`${s.url}/map`);
  await p.getByRole("link", { name: /Login uses magic links/ }).click();
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Login uses magic links");
  const note = notes(p).filter({ hasText: "Should expired links show a retry button?" });
  await expect(note).toHaveCount(1);
  await expect(note).toContainText("agent");
});

test("10.2 the agent reads the person's notes in the inbox, after a log position and capped by count", async ({ page: p }) => {
  const w = project();
  w.seed("node.added", { id: "root", kind: "card", title: "Root" });
  w.seed("node.added", { id: "auth-login", kind: "card", title: "Login uses magic links", parent: "root" });
  const s = await w.serve();
  await p.goto(`${s.url}/map/auth-login`);
  for (const text of ["first", "second", "third", "fourth"]) await typeNote(p, text);

  const all = w.werk("inbox");
  const order = ["first", "second", "third", "fourth"].map((t) => all.indexOf(t));
  expect(order.every((i) => i >= 0)).toBe(true);
  expect([...order].sort((a, b) => a - b)).toEqual(order);
  expect(all).toContain("auth-login");
  const pos = /\[(\d+)\][^\n]*\n\s*first/.exec(all)?.[1];
  expect(pos).toBeDefined();
  const since = w.werk("inbox", "--since", pos as string);
  expect(since).not.toContain("first");
  for (const t of ["second", "third", "fourth"]) expect(since).toContain(t);
  const capped = w.werk("inbox", "--since", pos as string, "-n", "2");
  expect(capped).toContain("second");
  expect(capped).toContain("third");
  expect(capped).not.toContain("fourth");
  expect(capped).not.toContain("first");
});

test("10.3 a corrected ghost keeps its earlier notes, with one marker where the new words begin", async ({ page: p }) => {
  const w = project();
  w.seed("node.added", { id: "root", kind: "card", title: "Root" });
  w.werk("add", "auth-retry", "--title", "Retry sends a new link", "--parent", "root");
  const s = await w.serve();
  await p.goto(`${s.url}/map/auth-retry`);
  await expect(p.locator("article[data-card]")).toHaveAttribute("data-proposed", "true");
  await typeNote(p, "No — retry must reuse the same link");
  w.werk("say", "auth-retry", "Understood, I will correct it");
  w.werk("discard", "auth-retry");
  w.werk("add", "auth-retry", "--title", "Retry reuses the same link", "--parent", "root");
  await p.goto(`${s.url}/map/auth-retry`);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Retry reuses the same link");
  await expect(entries(p)).toHaveCount(3);
  await expect(entries(p).nth(0)).toContainText("No — retry must reuse the same link");
  await expect(entries(p).nth(1)).toContainText("Understood, I will correct it");
  await expect(entries(p).nth(2)).toContainText("proposed again");
  await expect(thread(p).getByText("proposed again")).toHaveCount(1);
  await typeNote(p, "Good, accept");
  await expect(entries(p)).toHaveCount(4);
  await expect(entries(p).nth(3)).toContainText("Good, accept");
});

test("10.4 a note on a discarded ghost stays in the inbox and on the thread", async ({ page: p }) => {
  const w = project();
  w.seed("node.added", { id: "root", kind: "card", title: "Root" });
  w.werk("add", "cache-ttl", "--title", "Cache entries live 60 seconds", "--parent", "root");
  const s = await w.serve();
  await p.goto(`${s.url}/map/cache-ttl`);
  await typeNote(p, "Why 60 seconds?");
  w.werk("discard", "cache-ttl");
  const inbox = w.werk("inbox");
  expect(inbox).toContain("Why 60 seconds?");
  expect(inbox).toContain("cache-ttl");
  w.werk("add", "cache-ttl", "--title", "Cache entries live 30 seconds", "--parent", "root");
  await p.goto(`${s.url}/map/cache-ttl`);
  await expect(entries(p)).toHaveCount(2);
  await expect(entries(p).nth(0)).toContainText("Why 60 seconds?");
  await expect(entries(p).nth(1)).toContainText("proposed again");
});

test("10.5 an agent writes a note on an excerpt", async ({ page: p }) => {
  const w = project();
  w.seed("node.added", { id: "root", kind: "card", title: "Root" });
  w.seed("node.added", { id: "src-rfc", kind: "source", title: "RFC 6749", url: "https://www.rfc-editor.org/rfc/rfc6749" });
  w.seed("node.added", { id: "retry", kind: "card", title: "Clients retry", parent: "root" });
  w.seed("edge.added", { from: "retry", to: "src-rfc", type: "supported_by" });
  w.seed("excerpt.quoted", {
    id: "src-rfc-quote",
    title: "The client MAY retry the request",
    card: "retry",
    conversation: "rfc",
    session: "s1",
    message: 0,
    start: 0,
    end: 32,
    speaker: "person",
    said_at: "2026-01-01T09:00:00Z",
  });
  w.werk("show", "src-rfc-quote");
  const run = w.tryWerk("say", "src-rfc-quote", "This quote supports the retry decision");
  expect(run.code).toBe(0);
  const s = await w.serve();
  await p.goto(`${s.url}/map/src-rfc-quote`);
  await expect(notes(p).filter({ hasText: "This quote supports the retry decision" })).toHaveCount(1);
});
