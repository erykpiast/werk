// Held-out steps 06.x and 10.x in a real browser.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { project, stop, type Werk } from "../../e2e/project.ts";

test.afterEach(stop);

const thread = (p: Page) => p.locator('[data-section="thread"]');
const notes = (p: Page) => thread(p).locator('[data-entry="note"]');
const logLines = (w: Werk) =>
  readFileSync(join(w.dir, ".werk", "log.jsonl"), "utf8")
    .split("\n")
    .filter(Boolean);

async function typeNote(p: Page, text: string): Promise<void> {
  await p.getByRole("textbox", { name: "Note" }).fill(text);
  await p.getByRole("button", { name: "Add note" }).click();
  await expect(p.getByRole("textbox", { name: "Note" })).toHaveValue("");
}

async function decidedWithChat(): Promise<Werk> {
  const w = await project();
  w.seed("node.added", { id: "billing", kind: "card", title: "We bill per seat", parent: "root", body: "Seat body." });
  w.seed("node.decided", { id: "billing" });
  mkdirSync(join(w.dir, ".werk", "chats"));
  const line = { speaker: "person", at: "t0", session: "s1", kind: "spoken", text: "seats are the unit we bill" };
  writeFileSync(join(w.dir, ".werk", "chats", "pricing.jsonl"), `${JSON.stringify(line)}\n`);
  return w;
}

test("06.1 a new excerpt stages as a ghost and waits for the check mark", async ({ page: p }) => {
  const w = await decidedWithChat();
  const out = w.werk("quote", "billing", "pricing", "seats are the unit");
  expect(out).toContain("proposed");
  expect(out).not.toContain("added");

  await p.goto(`${w.url}/map/billing`);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("We bill per seat");
  await expect(p.locator('[data-tag="status"]')).toHaveText("decided");
  await expect(p.getByText("Seat body.")).toBeVisible();
  const row = p.locator('[data-link="supported_by"]').filter({ hasText: "seats are the unit" });
  await expect(row).toHaveCount(1);
  await expect(row.locator('[data-mark="pending"]')).toBeVisible();

  await row.getByRole("link").click();
  await expect(p.locator('[data-tag="proposed"]')).toBeVisible();
  await expect(p.getByRole("button", { name: /accept|✓/i })).toBeVisible();
});

test("06.2 an accepted excerpt stops being a ghost and its link goes live", async ({ page: p }) => {
  const w = await decidedWithChat();
  w.werk("quote", "billing", "pricing", "seats are the unit");
  await p.goto(`${w.url}/map/billing`);
  const pending = p.locator('[data-link="supported_by"]').filter({ hasText: "seats are the unit" });
  await pending.getByRole("link").click();
  await expect(p.locator('[data-tag="proposed"]')).toBeVisible();
  await p.getByRole("button", { name: /accept|✓/i }).click();
  await expect(p.locator('[data-tag="proposed"]')).toHaveCount(0);

  await p.goto(`${w.url}/map/billing`);
  const row = p.locator('[data-section="say"] [data-link="supported_by"]').filter({ hasText: "seats are the unit" });
  await expect(row).toHaveCount(1);
  await expect(row.locator('[data-mark="pending"]')).toHaveCount(0);
  expect(w.werk("show", "billing")).not.toContain("held");
});

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

test("10.2 the inbox reads the person's notes after a log position, capped by count", async ({ page: p }) => {
  const w = await project();
  w.seed("node.added", { id: "auth-login", kind: "card", title: "Login uses magic links", parent: "root" });
  await p.goto(`${w.url}/map/auth-login`);
  for (const text of ["first", "second", "third", "fourth"]) await typeNote(p, text);

  const all = w.werk("inbox");
  const order = ["first", "second", "third", "fourth"].map((t) => all.indexOf(t));
  expect(order.every((i) => i >= 0)).toBe(true);
  expect([...order].sort((a, b) => a - b)).toEqual(order);
  const seqOf = (t: string) => {
    const ev = logLines(w)
      .map((l) => JSON.parse(l))
      .find((e) => JSON.stringify(e.payload).includes(`"${t}"`));
    return String(ev?.seq);
  };
  for (const t of ["first", "second", "third", "fourth"]) {
    const entry = new RegExp(`^.*\\b${seqOf(t)}\\b.*#auth-login.*\\n\\s+${t}$`, "m");
    expect(all).toMatch(entry);
  }
  const since = w.werk("inbox", "--since", seqOf("first"));
  expect(since).not.toContain("first");
  for (const t of ["second", "third", "fourth"]) expect(since).toContain(t);
  const capped = w.werk("inbox", "--since", seqOf("first"), "-n", "2");
  expect(capped).toContain("second");
  expect(capped).toContain("third");
  expect(capped).not.toContain("fourth");
  expect(capped).not.toContain("first");
});

test("10.3 a corrected ghost keeps its earlier notes with one marker", async ({ page: p }) => {
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
  await expect(entries.nth(0)).toContainText("No — retry must reuse the same link");
  await expect(entries.nth(1)).toContainText("Understood, I will correct it");
  await expect(thread(p).locator('[data-entry="marker"]')).toHaveCount(1);
  await expect(entries.nth(2)).toContainText("proposed again");
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Retry reuses the same link");
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
  w.werk("add", "cache-ttl", "--title", "The cache keeps an entry for 60 seconds", "--parent", "root");
  await p.goto(`${w.url}/map/cache-ttl`);
  const entries = thread(p).locator("[data-entry]");
  await expect(entries.nth(0)).toContainText("Why 60 seconds?");
  await expect(entries.nth(1)).toHaveAttribute("data-entry", "marker");
  await expect(thread(p).locator('[data-entry="marker"]')).toHaveCount(1);
});

test("10.5 an agent writes a note on an excerpt", async ({ page: p }) => {
  const w = await project();
  w.seed("node.added", { id: "src-rfc", kind: "source", title: "RFC 6749", url: "https://example.com/rfc" });
  mkdirSync(join(w.dir, ".werk", "chats"));
  const line = {
    speaker: "person",
    at: "t0",
    session: "s1",
    kind: "spoken",
    text: "The client MAY retry the request.",
  };
  writeFileSync(join(w.dir, ".werk", "chats", "oauth.jsonl"), `${JSON.stringify(line)}\n`);
  // The excerpt id comes from the quote verb; the step names it src-rfc-quote, so the excerpt is seeded under that id.
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
