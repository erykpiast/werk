// Held-out: steps 06.1, 06.2, 10.1, 10.3, 10.5.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { closeAll, type Down, live } from "./live.ts";

test.afterEach(closeAll);

function decidedWithChat(d: Down): void {
  d.seed("node.added", {
    id: "billing",
    kind: "card",
    title: "We bill per seat",
    body: "One seat, one fee.",
    parent: "root",
  });
  d.seed("node.decided", { id: "billing" });
  mkdirSync(join(d.dir, ".werk", "chats"));
  const line = { speaker: "person", at: "t0", session: "s1", kind: "spoken", text: "seats are the unit we bill" };
  writeFileSync(join(d.dir, ".werk", "chats", "pricing.jsonl"), `${JSON.stringify(line)}\n`);
}

const said = (p: Page) => p.locator('[data-section="say"] [data-link="supported_by"]');
const thread = (p: Page) => p.locator('[data-section="thread"]');
const notes = (p: Page) => thread(p).locator('[data-entry="note"]');

async function typeNote(p: Page, text: string): Promise<void> {
  await p.getByRole("textbox", { name: "Note" }).fill(text);
  await p.getByRole("button", { name: "Add note" }).click();
  await expect(p.getByRole("textbox", { name: "Note" })).toHaveValue("");
}

test("06.1 a new excerpt for a card stages as a ghost and waits for the ✓", async ({ page: p }) => {
  const w = await live("Root", decidedWithChat);
  const out = w.werk("quote", "billing", "pricing", "seats are the unit");
  expect(out).toContain("proposed");
  expect(out).not.toContain("added");

  await p.goto(`${w.url}/map/billing`);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("We bill per seat");
  await expect(p.locator('[data-tag="status"]')).toHaveText("decided");
  await expect(p.locator('[data-field="body"]')).toHaveText("One seat, one fee.");
  const row = said(p);
  await expect(row).toHaveCount(1);
  await expect(row).toHaveAttribute("data-pending", "true");
  await expect(row.locator('[data-mark="pending"]')).toBeVisible();

  await row.getByRole("link").click();
  await expect(p.locator("article[data-card]")).toHaveAttribute("data-proposed", "true");
  await expect(p.locator('[data-tag="proposed"]')).toBeVisible();
  await expect(p.getByRole("button", { name: /accept/i })).toBeVisible();
});

test("06.2 an accepted excerpt stops being a ghost and its link goes live", async ({ page: p }) => {
  const w = await live("Root", decidedWithChat);
  w.werk("quote", "billing", "pricing", "seats are the unit");
  await p.goto(`${w.url}/map/billing`);
  await said(p).getByRole("link").click();
  await expect(p.locator('[data-tag="proposed"]')).toBeVisible();
  await p.getByRole("button", { name: /accept/i }).click();
  await expect(p.locator("article[data-card]")).toHaveAttribute("data-proposed", "false");
  await expect(p.locator('[data-tag="proposed"]')).toHaveCount(0);

  await p.goto(`${w.url}/map/billing`);
  const row = said(p);
  await expect(row).toContainText("seats are the unit");
  await expect(row).toHaveAttribute("data-pending", "false");
  await expect(row.locator('[data-mark="pending"]')).toHaveCount(0);
  expect(w.werk("show", "billing")).not.toContain("held");
  // Exactly one accept event: no second accept was needed for the link.
  expect(w.lines().filter((l) => JSON.parse(l).type === "change.accepted")).toHaveLength(1);
});

test("10.1 an agent's note appears on the card's thread in the map", async ({ page: p }) => {
  const w = await live("Root", (d) => {
    d.seed("node.added", { id: "auth-login", kind: "card", title: "Login uses magic links", parent: "root" });
    d.seed("node.decided", { id: "auth-login" });
  });
  w.werk("say", "auth-login", "Should expired links show a retry button?");
  await p.goto(`${w.url}/map`);
  await p
    .getByRole("link", { name: /Login uses magic links/ })
    .first()
    .click();
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Login uses magic links");
  const note = notes(p).filter({ hasText: "Should expired links show a retry button?" });
  await expect(note).toHaveCount(1);
  await expect(note.locator('[data-role="author"]')).toHaveText("agent");
});

test("10.3 a corrected ghost keeps its earlier notes, with one marker where the new words begin", async ({
  page: p,
}) => {
  const w = await live();
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

test("10.5 an agent writes a note on an excerpt", async ({ page: p }) => {
  const w = await live("Root", (d) => {
    d.seed("node.added", { id: "src-rfc", kind: "source", title: "RFC 6749", url: "https://example.com/rfc6749" });
    d.seed("excerpt.quoted", {
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
  });
  const r = w.run("say", "src-rfc-quote", "This quote supports the retry decision");
  expect(r.code).toBe(0);
  await p.goto(`${w.url}/map/src-rfc-quote`);
  await expect(notes(p).filter({ hasText: "This quote supports the retry decision" })).toHaveCount(1);
});
