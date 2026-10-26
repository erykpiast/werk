// Held-out steps 06.1, 06.2, 10.1-10.5, 12.5 in a real browser.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { project, stop, type Werk } from "../e2e/project.ts";

test.afterEach(stop);

const thread = (p: Page) => p.locator('[data-section="thread"]');
const notes = (p: Page) => thread(p).locator('[data-entry="note"]');
const said = (p: Page) => p.locator('[data-section="say"] [data-link="supported_by"]');

async function typeNote(p: Page, text: string) {
  await p.getByRole("textbox", { name: "Note" }).fill(text);
  await p.getByRole("button", { name: "Add note" }).click();
  await expect(p.getByRole("textbox", { name: "Note" })).toHaveValue("");
}

function chat(w: Werk, name: string, rows: object[]) {
  mkdirSync(join(w.dir, ".werk", "chats"), { recursive: true });
  writeFileSync(join(w.dir, ".werk", "chats", `${name}.jsonl`), rows.map((r) => `${JSON.stringify(r)}\n`).join(""));
}

async function decidedWithChat(): Promise<Werk> {
  const w = await project();
  w.seed("node.added", {
    id: "retention",
    kind: "card",
    title: "Logs are kept for a year",
    why: "Audits look back twelve months",
    body: "Each log file is deleted after one year",
    parent: "root",
  });
  w.seed("node.decided", { id: "retention" });
  chat(w, "audit", [{ speaker: "person", at: "t9", session: "s7", kind: "spoken", text: "auditors ask for twelve months of logs" }]);
  return w;
}

test("06.1 a new excerpt stages as a ghost and waits for the check mark", async ({ page: p }) => {
  const w = await decidedWithChat();
  const out = w.werk("quote", "retention", "audit", "twelve months of logs");
  expect(out).toContain("proposed");
  expect(out).not.toContain("added");
  await p.goto(`${w.url}/map/retention`);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Logs are kept for a year");
  await expect(p.locator('[data-tag="status"]')).toHaveText("decided");
  await expect(p.locator('[data-field="why"]')).toContainText("Audits look back twelve months");
  await expect(p.locator('[data-field="body"]')).toContainText("Each log file is deleted after one year");
  const row = said(p);
  await expect(row).toHaveCount(1);
  await expect(row).toHaveAttribute("data-pending", "true");
  await row.getByRole("link").click();
  await expect(p.locator("article[data-card]")).toHaveAttribute("data-proposed", "true");
  await expect(p.locator('[data-tag="proposed"]')).toBeVisible();
  await expect(p.getByRole("button", { name: /accept/i })).toBeVisible();
});

test("06.2 an accepted excerpt stops being a ghost and its link goes live", async ({ page: p }) => {
  const w = await decidedWithChat();
  w.werk("quote", "retention", "audit", "twelve months of logs");
  await p.goto(`${w.url}/map/retention:ex0`);
  await expect(p.locator("article[data-card]")).toHaveAttribute("data-proposed", "true");
  await p.getByRole("button", { name: /accept/i }).click();
  await expect(p.locator("article[data-card]")).toHaveAttribute("data-proposed", "false");
  await p.goto(`${w.url}/map/retention`);
  const row = said(p);
  await expect(row).toContainText("twelve months of logs");
  await expect(row).toHaveAttribute("data-pending", "false");
  expect(w.werk("show", "retention")).not.toContain("held");
});

test("10.1 an agent's note appears on the card's thread", async ({ page: p }) => {
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

test("10.2 the inbox after a log position, capped by count", async ({ page: p }) => {
  const w = await project();
  w.seed("node.added", { id: "auth-login", kind: "card", title: "Login uses magic links", parent: "root" });
  await p.goto(`${w.url}/map/auth-login`);
  for (const t of ["first", "second", "third", "fourth"]) await typeNote(p, t);
  const all = w.werk("inbox");
  const order = ["first", "second", "third", "fourth"].map((t) => all.indexOf(t));
  expect(order.every((i) => i >= 0)).toBe(true);
  expect([...order].sort((a, b) => a - b)).toEqual(order);
  const entries = [...all.matchAll(/^\[(\d+)\] #(\S+).*\n\s+(\S+)$/gm)].map(([, seq, id, text]) => ({ seq, id, text }));
  expect(entries.map((e) => e.text)).toEqual(["first", "second", "third", "fourth"]);
  expect(entries.every((e) => e.id === "auth-login")).toBe(true);
  const first = entries[0]?.seq as string;
  const since = w.werk("inbox", "--since", first);
  for (const t of ["second", "third", "fourth"]) expect(since).toContain(t);
  expect(since).not.toContain("first");
  const capped = w.werk("inbox", "--since", first, "-n", "2");
  expect(capped).toContain("second");
  expect(capped).toContain("third");
  expect(capped).not.toContain("fourth");
  expect(capped).not.toContain("first");
});

test("10.3 a corrected ghost keeps its notes with one proposed-again marker", async ({ page: p }) => {
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
  await expect(entries.nth(0)).toContainText("No — retry must reuse the same link");
  await expect(entries.nth(1)).toContainText("Understood, I will correct it");
  const markers = thread(p).locator('[data-entry="marker"]');
  await expect(markers).toHaveCount(1);
  await expect(markers).toContainText("proposed again");
  await expect(entries).toHaveCount(3);
  await expect(entries.nth(2)).toHaveAttribute("data-entry", "marker");
  await typeNote(p, "Good, accept");
  await expect(entries).toHaveCount(4);
  await expect(entries.nth(3)).toContainText("Good, accept");
});

test("10.4 a note on a discarded ghost stays in the inbox and on the thread", async ({ page: p }) => {
  const w = await project();
  w.werk("add", "cache-ttl", "--title", "Entries live 60 seconds", "--parent", "root");
  await p.goto(`${w.url}/map/cache-ttl`);
  await typeNote(p, "Why 60 seconds?");
  w.werk("discard", "cache-ttl");
  expect(w.werk("inbox")).toMatch(/#cache-ttl[\s\S]*Why 60 seconds\?/);
  w.werk("add", "cache-ttl", "--title", "Entries live 30 seconds", "--parent", "root");
  await p.goto(`${w.url}/map/cache-ttl`);
  const entries = thread(p).locator("[data-entry]");
  await expect(entries).toHaveCount(2);
  await expect(entries.nth(0)).toContainText("Why 60 seconds?");
  await expect(entries.nth(1)).toHaveAttribute("data-entry", "marker");
  await expect(entries.nth(1)).toContainText("proposed again");
});

test("10.5 an agent writes a note on an excerpt", async ({ page: p }) => {
  const w = await project();
  w.seed("node.added", { id: "src-rfc", kind: "source", title: "RFC 6749", url: "https://www.rfc-editor.org/rfc/rfc6749" });
  chat(w, "oauth", [{ speaker: "person", at: "t0", session: "s1", kind: "spoken", text: "The client MAY retry the request." }]);
  // The excerpt id is set by the step, so it is seeded as the quote event that a quote writes.
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

test("12.5 the excerpt follows the fate of its citing card", async ({ page: p }) => {
  const w = await project();
  chat(w, "plan", [
    { speaker: "person", at: "t0", session: "s1", kind: "spoken", text: "the reader comes first" },
    { speaker: "agent", at: "t1", session: "s1", kind: "spoken", text: "then the writer follows" },
  ]);
  w.werk("add", "reader", "--title", "Reader first", "--parent", "root");
  w.werk("add", "writer", "--title", "Writer second", "--parent", "root");
  w.werk("quote", "reader", "plan", "reader comes first");
  w.werk("quote", "writer", "plan", "writer follows");
  w.werk("discard", "reader");
  await p.goto(`${w.url}/map/reader`);
  await expect(p.locator("[data-missing]")).toBeVisible();
  await p.goto(`${w.url}/map/reader:ex0`);
  await expect(p.locator("[data-missing]")).toBeVisible();
  await p.goto(`${w.url}/map/writer`);
  await p.getByRole("button", { name: /accept/i }).click();
  await expect(p.locator("article[data-card]")).toHaveAttribute("data-proposed", "false");
  await p.goto(`${w.url}/map/writer:ex0`);
  await expect(p.locator("article[data-card]")).toHaveAttribute("data-proposed", "false");
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("writer follows");
  const ptr = (n: string) => p.locator(`[data-field="pointer"] [data-pointer="${n}"] dd`);
  await expect(ptr("speaker")).toHaveText("agent");
  await expect(ptr("said-at")).toHaveText("t1");
  await expect(ptr("session")).toHaveText("s1");
  await expect(ptr("message")).toHaveText("1");
  await expect(ptr("span")).toHaveText("9..23");
  expect(readFileSync(join(w.dir, ".werk", "log.jsonl"), "utf8")).toContain("writer follows");
});
