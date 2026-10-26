// Held-out binder tests, group D (browser): a card's thread (10.x).
import { mkdirSync, writeFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { project, stop } from "../e2e/project.ts";

test.afterEach(stop);

const thread = (p: Page) => p.locator('[data-section="thread"]');

async function typeNote(p: Page, text: string): Promise<void> {
  await p.getByRole("textbox", { name: "Note" }).fill(text);
  await p.getByRole("button", { name: "Add note" }).click();
  await expect(thread(p)).toContainText(text);
}

test("10.1 an agent's note appears on the card's thread in the map", async ({ page: p }) => {
  const w = await project();
  w.seed("node.added", {
    id: "auth-login",
    kind: "card",
    title: "Login uses magic links",
    parent: "root",
    status: "decided",
    who: "me",
  });
  w.werk("say", "auth-login", "Should expired links show a retry button?");
  await p.goto(`${w.url}/map`);
  await p.getByText("Login uses magic links").first().click();
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Login uses magic links");
  const note = thread(p).locator("[data-entry]").filter({ hasText: "Should expired links show a retry button?" });
  await expect(note).toHaveCount(1);
  await expect(note).toContainText("agent");
});

test("10.2 the agent reads the person's notes in the inbox, after a position and capped", async ({ page: p }) => {
  const w = await project();
  w.seed("node.added", { id: "auth-login", kind: "card", title: "Login", parent: "root" });
  await p.goto(`${w.url}/map/auth-login`);
  for (const t of ["first", "second", "third", "fourth"]) await typeNote(p, t);

  const all = w.werk("inbox");
  const order = ["first", "second", "third", "fourth"].map((t) => all.indexOf(t));
  expect(order.every((i) => i >= 0)).toBe(true);
  expect([...order].sort((a, b) => a - b)).toEqual(order);
  const heads = [...all.matchAll(/\[(\d+)\]\s+#auth-login/g)];
  expect(heads).toHaveLength(4);
  const firstPos = (/\[(\d+)\]\s+#auth-login[^\n]*\n\s+first/.exec(all) ?? [])[1] as string;
  expect(firstPos).toBeDefined();

  const since = w.werk("inbox", "--since", firstPos);
  expect(since).not.toMatch(/\bfirst\b/);
  for (const t of ["second", "third", "fourth"]) expect(since).toContain(t);
  const capped = w.werk("inbox", "--since", firstPos, "-n", "2");
  expect(capped).toContain("second");
  expect(capped).toContain("third");
  expect(capped).not.toContain("fourth");
  expect(capped).not.toMatch(/\bfirst\b/);
});

test("10.3 a corrected ghost keeps its earlier notes, with one marker", async ({ page: p }) => {
  const w = await project();
  w.werk("add", "auth-retry", "--title", "Retry sends a new link", "--parent", "root");
  await p.goto(`${w.url}/map/auth-retry`);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Retry sends a new link");
  await typeNote(p, "No — retry must reuse the same link");
  w.werk("say", "auth-retry", "Understood, I will correct it");
  w.werk("discard", "auth-retry");
  w.werk("add", "auth-retry", "--title", "Retry reuses the same link", "--parent", "root");
  await p.goto(`${w.url}/map/auth-retry`);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Retry reuses the same link");
  const text = await thread(p).innerText();
  const a = text.indexOf("No — retry must reuse the same link");
  const b = text.indexOf("Understood, I will correct it");
  const m = text.indexOf("proposed again");
  expect(a).toBeGreaterThanOrEqual(0);
  expect(b).toBeGreaterThan(a);
  expect(m).toBeGreaterThan(b);
  expect(text.split("proposed again").length - 1).toBe(1);
  await typeNote(p, "Good, accept");
  const after = await thread(p).innerText();
  expect(after.indexOf("Good, accept")).toBeGreaterThan(after.indexOf("proposed again"));
});

test("10.4 a note on a discarded ghost stays in the inbox and on the thread", async ({ page: p }) => {
  const w = await project();
  w.werk("add", "cache-ttl", "--title", "Cache keeps entries 60 seconds", "--parent", "root");
  await p.goto(`${w.url}/map/cache-ttl`);
  await typeNote(p, "Why 60 seconds?");
  w.werk("discard", "cache-ttl");
  expect(w.werk("inbox")).toMatch(/#cache-ttl[\s\S]*Why 60 seconds\?/);
  w.werk("add", "cache-ttl", "--title", "Cache keeps entries 30 seconds", "--parent", "root");
  await p.goto(`${w.url}/map/cache-ttl`);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Cache keeps entries 30 seconds");
  const text = await thread(p).innerText();
  expect(text.indexOf("Why 60 seconds?")).toBeGreaterThanOrEqual(0);
  expect(text.indexOf("proposed again")).toBeGreaterThan(text.indexOf("Why 60 seconds?"));
  expect(text.split("proposed again").length - 1).toBe(1);
});

test("10.5 an agent writes a note on an excerpt", async ({ page: p }) => {
  const w = await project(undefined, ({ dir }) => {
    mkdirSync(`${dir}/.werk/chats`, { recursive: true });
    writeFileSync(
      `${dir}/.werk/chats/oauth.jsonl`,
      `${JSON.stringify({ speaker: "person", at: "t0", session: "s1", kind: "spoken", text: "The client MAY retry the request." })}\n`,
    );
  });
  w.werk(
    "add",
    "src-rfc",
    "--kind",
    "source",
    "--title",
    "RFC 6749",
    "--url",
    "https://www.rfc-editor.org/rfc/rfc6749",
  );
  // The excerpt id comes from the quote; the step's name "#src-rfc-quote" maps to the quoted excerpt.
  const out = w.werk("quote", "root", "oauth", "MAY retry the request");
  const ex = /^(\S+):/.exec(out)?.[1] as string;
  w.werk("say", ex, "This quote supports the retry decision");
  await p.goto(`${w.url}/map/${ex}`);
  await expect(thread(p)).toContainText("This quote supports the retry decision");
});
