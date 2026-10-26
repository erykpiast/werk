import { expect, type Page, test } from "@playwright/test";
import { project, stop } from "../e2e/project.ts";

test.afterEach(stop);

async function typeNote(p: Page, text: string): Promise<void> {
  await p.getByRole("textbox", { name: "Note" }).fill(text);
  await p.getByRole("button", { name: "Add note" }).click();
  await expect(p.getByRole("textbox", { name: "Note" })).toHaveValue("");
}

const thread = (p: Page) => p.locator('[data-section="thread"]');
const notes = (p: Page) => thread(p).locator('[data-entry="note"]');

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
  await expect(note.locator('[data-role="author"]')).toHaveText("agent");
});

test("10.3 a corrected ghost keeps its earlier notes, with one marker where the new words begin", async ({
  page: p,
}) => {
  const w = await project();
  w.werk(
    "add",
    "auth-retry",
    "--title",
    "Retry sends a new link",
    "--body",
    "Retry sends a new link",
    "--parent",
    "root",
  );
  await p.goto(`${w.url}/map/auth-retry`);
  await expect(p.locator('[data-tag="proposed"]')).toBeVisible();
  await typeNote(p, "No — retry must reuse the same link");
  w.werk("say", "auth-retry", "Understood, I will correct it");

  w.werk("discard", "auth-retry");
  w.werk(
    "add",
    "auth-retry",
    "--title",
    "Retry reuses the same link",
    "--body",
    "Retry reuses the same link",
    "--parent",
    "root",
  );
  await p.goto(`${w.url}/map/auth-retry`);
  const entries = thread(p).locator("[data-entry]");
  await expect(entries).toHaveCount(3);
  await expect(entries.nth(0)).toContainText("No — retry must reuse the same link");
  await expect(entries.nth(1)).toContainText("Understood, I will correct it");
  await expect(entries.nth(2)).toHaveAttribute("data-entry", "marker");
  await expect(entries.nth(2)).toContainText("proposed again");
  await expect(thread(p).locator('[data-entry="marker"]')).toHaveCount(1);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Retry reuses the same link");
  await expect(p.locator('[data-tag="proposed"]')).toBeVisible();

  await typeNote(p, "Good, accept");
  await expect(entries).toHaveCount(4);
  await expect(entries.nth(3)).toContainText("Good, accept");
  await expect(entries.nth(3)).toHaveAttribute("data-entry", "note");
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
  await expect(entries).toHaveCount(2);
  await expect(entries.nth(0)).toContainText("Why 60 seconds?");
  await expect(entries.nth(1)).toHaveAttribute("data-entry", "marker");
  await expect(entries.nth(1)).toContainText("proposed again");
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
  // The command throws when it does not exit 0.
  w.werk("say", "src-rfc-quote", "This quote supports the retry decision");

  await p.goto(`${w.url}/map/src-rfc-quote`);
  await expect(p.locator('[data-tag="kind"]')).toHaveText("excerpt");
  await expect(notes(p).filter({ hasText: "This quote supports the retry decision" })).toHaveCount(1);
});
