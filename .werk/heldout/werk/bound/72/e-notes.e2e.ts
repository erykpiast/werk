// Held-out steps 10.x: notes on a card's thread, between the agent's command line and the person's page.
import { expect, type Page, test } from "@playwright/test";
import { project, stop } from "../e2e/project.ts";

test.afterEach(stop);

async function typeNote(p: Page, text: string): Promise<void> {
  await p.getByRole("textbox", { name: "Note" }).fill(text);
  await p.getByRole("button", { name: "Add note" }).click();
  await expect(p.getByRole("textbox", { name: "Note" })).toHaveValue("");
}

const thread = (p: Page) => p.locator('[data-section="thread"]');
const entries = (p: Page) => thread(p).locator("[data-entry]");

test("10.1 an agent's note appears on the card's thread in the map", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    d.seed("node.added", {
      id: "auth-login",
      kind: "card",
      title: "Login uses magic links",
      parent: "root",
      status: "decided",
    });
  });
  w.werk("say", "auth-login", "Should expired links show a retry button?");
  await p.goto(`${w.url}/map`);
  await p
    .getByRole("link", { name: /Login uses magic links/ })
    .first()
    .click();
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Login uses magic links");
  const note = thread(p)
    .locator('[data-entry="note"]')
    .filter({ hasText: "Should expired links show a retry button?" });
  await expect(note).toHaveCount(1);
  await expect(note).toContainText("agent");
});

test("10.2 the inbox reads the person's notes after a position, capped by count", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
    d.seed("node.added", { id: "auth-login", kind: "card", title: "Login uses magic links", parent: "root" });
  });
  await p.goto(`${w.url}/map/auth-login`);
  for (const text of ["first", "second", "third", "fourth"]) await typeNote(p, text);
  await expect(thread(p).locator('[data-entry="note"]')).toHaveCount(4);

  const all = w.werk("inbox");
  const order = ["first", "second", "third", "fourth"].map((t) => all.search(new RegExp(`\\b${t}\\b`)));
  expect(order.every((i) => i >= 0)).toBe(true);
  expect([...order].sort((a, b) => a - b)).toEqual(order);
  // Each note shows its card id and its log position: a line with #auth-login and a number before each note.
  const blocks = [...all.matchAll(/^.*?(\d+).*#auth-login.*\n\s+(first|second|third|fourth)$/gm)];
  expect(blocks.map((m) => m[2])).toEqual(["first", "second", "third", "fourth"]);
  const firstPos = blocks[0]?.[1] as string;
  const since = w.werk("inbox", "--since", firstPos);
  expect(since).not.toMatch(/\bfirst\b/);
  for (const t of ["second", "third", "fourth"]) expect(since).toContain(t);
  const capped = w.werk("inbox", "--since", firstPos, "-n", "2");
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
  await expect(p.locator('[data-tag="proposed"]').first()).toBeVisible();
  await typeNote(p, "No — retry must reuse the same link");
  w.werk("say", "auth-retry", "Understood, I will correct it");
  w.werk("discard", "auth-retry");
  w.werk("add", "auth-retry", "--title", "Retry reuses the same link", "--parent", "root");
  await p.goto(`${w.url}/map/auth-retry`);
  const list = entries(p);
  await expect(list.nth(0)).toContainText("No — retry must reuse the same link");
  await expect(list.nth(1)).toContainText("Understood, I will correct it");
  await expect(thread(p).locator('[data-entry="marker"]')).toHaveCount(1);
  await expect(list.nth(2)).toHaveAttribute("data-entry", "marker");
  await expect(list.nth(2)).toContainText("proposed again");
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Retry reuses the same link");
  await typeNote(p, "Good, accept");
  await expect(list).toHaveCount(4);
  await expect(list.nth(3)).toContainText("Good, accept");
});

test("10.4 a note on a discarded ghost stays in the inbox and on the thread", async ({ page: p }) => {
  const w = await project();
  w.werk("add", "cache-ttl", "--title", "Keep entries 60 seconds", "--parent", "root");
  await p.goto(`${w.url}/map/cache-ttl`);
  await typeNote(p, "Why 60 seconds?");
  w.werk("discard", "cache-ttl");
  expect(w.werk("inbox")).toMatch(/#cache-ttl[\s\S]*Why 60 seconds\?/);
  w.werk("add", "cache-ttl", "--title", "Keep entries 30 seconds", "--parent", "root");
  await p.goto(`${w.url}/map/cache-ttl`);
  const list = entries(p);
  await expect(list).toHaveCount(2);
  await expect(list.nth(0)).toContainText("Why 60 seconds?");
  await expect(list.nth(1)).toHaveAttribute("data-entry", "marker");
  await expect(list.nth(1)).toContainText("proposed again");
});

test("10.5 an agent writes a note on an excerpt", async ({ page: p }) => {
  const w = await project(undefined, (d) => {
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
  w.werk("say", "src-rfc-quote", "This quote supports the retry decision");
  await p.goto(`${w.url}/map/src-rfc-quote`);
  await expect(
    thread(p).locator('[data-entry="note"]').filter({ hasText: "This quote supports the retry decision" }),
  ).toHaveCount(1);
});
