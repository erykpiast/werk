import { expect, type Page, test } from "@playwright/test";
import { project, stop } from "../e2e/project.ts";

test.afterEach(stop);

async function typeNote(p: Page, text: string) {
  await p.getByRole("textbox", { name: "Note" }).fill(text);
  await p.getByRole("button", { name: "Add note" }).click();
  await expect(p.getByRole("textbox", { name: "Note" })).toHaveValue("");
}
const thread = (p: Page) => p.locator('[data-section="thread"]');

test("10.1 agent note appears on card thread", async ({ page: p }) => {
  const w = await project();
  w.seed("node.added", { id: "auth-login", kind: "card", title: "Login uses magic links", parent: "root" });
  w.seed("node.decided", { id: "auth-login" });
  w.werk("say", "auth-login", "Should expired links show a retry button?");
  await p.goto(`${w.url}/map`);
  await p.getByText("Login uses magic links").first().click();
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Login uses magic links");
  const note = thread(p).locator("[data-entry]").filter({ hasText: "Should expired links show a retry button?" });
  await expect(note).toHaveCount(1);
  await expect(note).toContainText("agent");
});

test("10.2 inbox since and -n", async ({ page: p }) => {
  const w = await project();
  w.seed("node.added", { id: "auth-login", kind: "card", title: "Login uses magic links", parent: "root" });
  await p.goto(`${w.url}/map/auth-login`);
  for (const t of ["first", "second", "third", "fourth"]) await typeNote(p, t);
  const out = w.werk("inbox");
  const words = ["first", "second", "third", "fourth"];
  const idx = words.map((t) => out.search(new RegExp(`\\b${t}\\b`)));
  expect(idx.every((i) => i >= 0)).toBe(true);
  expect([...idx].sort((a, b) => a - b)).toEqual(idx);
  // each note shows its card id and log position
  const blocks = out.split(/\n(?=\S)/).filter((b) => words.some((t) => b.includes(t)));
  expect(blocks.length).toBe(4);
  for (const b of blocks) {
    expect(b).toContain("auth-login");
    expect(b).toMatch(/\d+/);
  }
  const firstPos = /(\d+)/.exec(blocks[0] as string)?.[1] as string;
  const since = w.werk("inbox", "--since", firstPos);
  expect(since).not.toMatch(/\bfirst\b/);
  for (const t of ["second", "third", "fourth"]) expect(since).toContain(t);
  const capped = w.werk("inbox", "--since", firstPos, "-n", "2");
  expect(capped).toContain("second");
  expect(capped).toContain("third");
  expect(capped).not.toContain("fourth");
  expect(capped).not.toMatch(/\bfirst\b/);
});

test("10.3 corrected ghost keeps notes with one marker", async ({ page: p }) => {
  const w = await project();
  w.werk("add", "auth-retry", "--title", "Retry sends a new link", "--parent", "root");
  await p.goto(`${w.url}/map/auth-retry`);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Retry sends a new link");
  await typeNote(p, "No — retry must reuse the same link");
  w.werk("say", "auth-retry", "Understood, I will correct it");
  w.werk("discard", "auth-retry");
  w.werk("add", "auth-retry", "--title", "Retry reuses the same link", "--parent", "root");
  await p.goto(`${w.url}/map/auth-retry`);
  const entries = thread(p).locator("[data-entry]");
  await expect(entries.filter({ hasText: "No — retry must reuse the same link" })).toHaveCount(1);
  await expect(entries.filter({ hasText: "Understood, I will correct it" })).toHaveCount(1);
  const markers = thread(p).getByText("proposed again");
  await expect(markers).toHaveCount(1);
  const texts = await entries.allInnerTexts();
  const iA = texts.findIndex((t) => t.includes("No — retry"));
  const iB = texts.findIndex((t) => t.includes("Understood"));
  const iM = texts.findIndex((t) => t.includes("proposed again"));
  expect(iM).toBeGreaterThan(iA);
  expect(iM).toBeGreaterThan(iB);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Retry reuses the same link");
  await typeNote(p, "Good, accept");
  const texts2 = await entries.allInnerTexts();
  const iG = texts2.findIndex((t) => t.includes("Good, accept"));
  const iM2 = texts2.findIndex((t) => t.includes("proposed again"));
  expect(iG).toBeGreaterThan(iM2);
});

test("10.4 note on discarded ghost stays", async ({ page: p }) => {
  const w = await project();
  w.werk("add", "cache-ttl", "--title", "Cache entries live 60 seconds", "--parent", "root");
  await p.goto(`${w.url}/map/cache-ttl`);
  await typeNote(p, "Why 60 seconds?");
  w.werk("discard", "cache-ttl");
  const inbox = w.werk("inbox");
  expect(inbox).toMatch(/cache-ttl[\s\S]*Why 60 seconds\?/);
  w.werk("add", "cache-ttl", "--title", "Cache entries live 30 seconds", "--parent", "root");
  await p.goto(`${w.url}/map/cache-ttl`);
  const entries = thread(p).locator("[data-entry]");
  const texts = await (async () => {
    await expect(entries.filter({ hasText: "Why 60 seconds?" })).toHaveCount(1);
    return entries.allInnerTexts();
  })();
  await expect(thread(p).getByText("proposed again")).toHaveCount(1);
  const iN = texts.findIndex((t) => t.includes("Why 60 seconds?"));
  const iM = texts.findIndex((t) => t.includes("proposed again"));
  expect(iN).toBeLessThan(iM);
});

test("10.5 agent note on an excerpt", async ({ page: p }) => {
  const w = await project();
  w.seed("node.added", { id: "src-rfc", kind: "source", title: "RFC 6749", url: "https://example.com/rfc" });
  w.seed("excerpt.quoted", {
    id: "src-rfc-quote",
    title: "The client MAY retry.",
    card: "root",
    conversation: "oauth",
    session: "s1",
    message: 0,
    start: 0,
    end: 21,
    speaker: "person",
    said_at: "t0",
  });
  w.werk("say", "src-rfc-quote", "This quote supports the retry decision"); // throws on non-zero exit
  await p.goto(`${w.url}/map/src-rfc-quote`);
  await expect(
    thread(p).locator("[data-entry]").filter({ hasText: "This quote supports the retry decision" }),
  ).toHaveCount(1);
});
