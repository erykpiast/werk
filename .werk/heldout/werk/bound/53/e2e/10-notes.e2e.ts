// 10.1 - 10.5: notes on a card's thread, between the agent's command line and the person's map.
import { expect, type Page, test } from "@playwright/test";
import { cleanup, project } from "./harness";

test.afterEach(cleanup);

const thread = (p: Page) => p.locator('[data-section="thread"]');
const entries = (p: Page) => thread(p).locator("[data-entry]");
const notes = (p: Page) => thread(p).locator('[data-entry="note"]');

async function typeNote(p: Page, text: string): Promise<void> {
  const box = p.getByRole("textbox", { name: "Note" });
  await box.fill(text);
  await p.getByRole("button", { name: "Add note" }).click();
  await expect(notes(p).filter({ hasText: text })).toHaveCount(1);
}

test("10.1 an agent's note appears on the card's thread in the map", async ({ page: p }) => {
  const w = await project();
  w.seed("node.added", { id: "auth-login", kind: "card", title: "Login uses magic links", status: "decided", who: "me", parent: "root" });
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

  const parse = (out: string) =>
    [...out.matchAll(/^\[(\d+)\] #(\S+).*\n\s+(.+)$/gm)].map(([, seq, id, text]) => ({ seq, id, text }));
  const all = parse(w.werk("inbox"));
  expect(all.map((e) => e.text)).toEqual(["first", "second", "third", "fourth"]);
  expect(all.every((e) => e.id === "auth-login")).toBe(true);
  const first = all[0]?.seq as string;
  expect(parse(w.werk("inbox", "--since", first)).map((e) => e.text)).toEqual(["second", "third", "fourth"]);
  expect(parse(w.werk("inbox", "--since", first, "-n", "2")).map((e) => e.text)).toEqual(["second", "third"]);
});

test("10.3 a corrected ghost keeps its earlier notes, with one marker where the new words begin", async ({ page: p }) => {
  const w = await project();
  w.werk("add", "auth-retry", "--title", "Retry sends a new link", "--parent", "root");
  await p.goto(`${w.url}/map/auth-retry`);
  await expect(p.locator('article[data-card="auth-retry"]')).toHaveAttribute("data-proposed", "true");
  await typeNote(p, "No — retry must reuse the same link");
  w.werk("say", "auth-retry", "Understood, I will correct it");

  w.werk("discard", "auth-retry");
  w.werk("add", "auth-retry", "--title", "Retry reuses the same link", "--parent", "root");
  await p.goto(`${w.url}/map/auth-retry`);
  await expect(entries(p)).toHaveCount(3);
  await expect(entries(p).nth(0)).toContainText("No — retry must reuse the same link");
  await expect(entries(p).nth(1)).toContainText("Understood, I will correct it");
  await expect(entries(p).nth(2)).toContainText("proposed again");
  await expect(thread(p).getByText("proposed again")).toHaveCount(1);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Retry reuses the same link");

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
  const inbox = w.werk("inbox");
  expect(inbox).toMatch(/#cache-ttl[^\n]*\n\s+Why 60 seconds\?/);

  w.werk("add", "cache-ttl", "--title", "Cache entries live 30 seconds", "--parent", "root");
  await p.goto(`${w.url}/map/cache-ttl`);
  await expect(entries(p)).toHaveCount(2);
  await expect(entries(p).nth(0)).toContainText("Why 60 seconds?");
  await expect(entries(p).nth(1)).toContainText("proposed again");
});

test("10.5 an agent writes a note on an excerpt", async ({ page: p }) => {
  const w = await project();
  w.seed("node.added", { id: "src-rfc", kind: "source", title: "RFC 6749", url: "https://www.rfc-editor.org/rfc/rfc6749" });
  // Only a quote creates an excerpt, so the excerpt enters the log as the event a quote writes.
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
    said_at: "2026-10-01T10:00:00Z",
  });
  const r = w.run("say", "src-rfc-quote", "This quote supports the retry decision");
  expect(r.code, r.err).toBe(0);
  await p.goto(`${w.url}/map/src-rfc-quote`);
  await expect(notes(p).filter({ hasText: "This quote supports the retry decision" })).toHaveCount(1);
});
