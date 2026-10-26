import { expect, test } from "@playwright/test";
import { chat, notes, project, thread, typeNote } from "./werk-server";

const spoken = (text: string, speaker = "person") => ({ speaker, at: "2026-10-01T09:00:00Z", session: "s-1", kind: "spoken", text });

async function decidedWithQuote() {
  const w = await project();
  w.seed("node.added", { id: "pricing", kind: "card", title: "We charge per seat", why: "Seats track value", parent: "root", status: "decided", who: "me" });
  chat(w, "talk", [spoken("per seat it is")]);
  return w;
}

test("06.1", async ({ page: p }) => {
  const w = await decidedWithQuote();
  await p.goto(`${w.url}/map/pricing`);
  const statusBefore = await p.locator('#card article [data-tag="status"]').textContent();
  const heroBefore = await p.locator("#card article").innerText();

  const out = w.werk("quote", "pricing", "talk", "per seat");
  expect(out).toContain("proposed");
  expect(out).not.toContain("added");

  await p.goto(`${w.url}/map/pricing:ex0`);
  await expect(p.locator('#card article[data-proposed="true"]')).toBeVisible();
  await expect(p.locator('#card [data-tag="proposed"]')).toBeVisible();

  await p.goto(`${w.url}/map/pricing`);
  expect(await p.locator('#card article [data-tag="status"]').textContent()).toBe(statusBefore);
  expect(await p.locator("#card article").innerText()).toBe(heroBefore);
  // The link from the card to the excerpt, shown as pending.
  const toExcerpt = p.locator('#card a[href="/map/pricing:ex0"], #card a[href="/map/pricing%3Aex0"]');
  await expect(toExcerpt).toHaveCount(1);
  await expect(toExcerpt.locator("xpath=..")).toContainText(/proposed|pending|held/);
});

test("06.2", async ({ page: p }) => {
  const w = await decidedWithQuote();
  w.werk("quote", "pricing", "talk", "per seat");
  await p.goto(`${w.url}/map/pricing:ex0`);
  await expect(p.locator('#card [data-tag="proposed"]')).toBeVisible();
  const before = w.lines();
  await p.getByRole("button", { name: /✓|accept/i }).click({ timeout: 5000 });
  await expect(p.locator('#card [data-tag="proposed"]')).toHaveCount(0);
  expect(w.lines()).toBe(before + 1);
  await p.goto(`${w.url}/map/pricing`);
  await expect(p.locator("#card")).toContainText("per seat");
  expect(w.werk("show", "pricing")).toContain("  -> supported_by    pricing:ex0  per seat\n");
});

test("10.1", async ({ page: p }) => {
  const w = await project();
  w.seed("node.added", { id: "auth-login", kind: "card", title: "Login uses magic links", parent: "root" });
  w.seed("node.decided", { id: "auth-login" });
  w.werk("say", "auth-login", "Should expired links show a retry button?");
  await p.goto(`${w.url}/map`);
  await p.getByRole("link", { name: /Login uses magic links/ }).click();
  const note = notes(p).filter({ hasText: "Should expired links show a retry button?" });
  await expect(note).toHaveCount(1);
  await expect(note.locator('[data-role="author"]')).toHaveText("agent");
});

test("10.2", async ({ page: p }) => {
  const w = await project();
  w.seed("node.added", { id: "auth-login", kind: "card", title: "Login uses magic links", parent: "root" });
  await p.goto(`${w.url}/map/auth-login`);
  for (const text of ["first", "second", "third", "fourth"]) await typeNote(p, text);
  const all = w.werk("inbox");
  const entries = [...all.matchAll(/^\[(\d+)\] #(\S+)\s.*\n\s+(\S+)$/gm)].map(([, seq, id, text]) => ({ seq, id, text }));
  expect(entries.map((e) => e.text)).toEqual(["first", "second", "third", "fourth"]);
  expect(entries.every((e) => e.id === "auth-login" && /^\d+$/.test(e.seq ?? ""))).toBe(true);
  const first = entries[0]?.seq as string;
  const since = w.werk("inbox", "--since", first);
  for (const t of ["second", "third", "fourth"]) expect(since).toMatch(new RegExp(`^\\s+${t}$`, "m"));
  expect(since).not.toMatch(/^\s+first$/m);
  const capped = w.werk("inbox", "--since", first, "-n", "2");
  expect([...capped.matchAll(/^\s+(\S+)$/gm)].map((m) => m[1])).toEqual(["second", "third"]);
});

test("10.3", async ({ page: p }) => {
  const w = await project();
  w.werk("add", "auth-retry", "--title", "Retry sends a new link", "--parent", "root");
  await p.goto(`${w.url}/map/auth-retry`);
  await expect(p.locator('#card [data-tag="proposed"]')).toBeVisible();
  await typeNote(p, "No — retry must reuse the same link");
  w.werk("say", "auth-retry", "Understood, I will correct it");
  w.werk("discard", "auth-retry");
  w.werk("add", "auth-retry", "--title", "Retry reuses the same link", "--parent", "root");
  await p.goto(`${w.url}/map/auth-retry`);
  const entries = thread(p).locator("[data-entry]");
  await expect(entries).toHaveCount(3);
  await expect(entries.nth(0)).toContainText("No — retry must reuse the same link");
  await expect(entries.nth(1)).toContainText("Understood, I will correct it");
  await expect(entries.nth(2)).toHaveAttribute("data-entry", "marker");
  await expect(thread(p).locator('[data-entry="marker"]', { hasText: "proposed again" })).toHaveCount(1);
  await expect(p.locator("#card article h1")).toHaveText("Retry reuses the same link");
  await typeNote(p, "Good, accept");
  await expect(entries).toHaveCount(4);
  await expect(entries.nth(3)).toContainText("Good, accept");
});

test("10.4", async ({ page: p }) => {
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
  await expect(entries.nth(1)).toHaveAttribute("data-entry", "marker");
});

test("10.5", async ({ page: p }) => {
  const w = await project();
  w.seed("node.added", { id: "src-rfc", kind: "source", title: "RFC 6749", url: "https://www.rfc-editor.org/rfc/rfc6749" });
  // An excerpt comes only from a quote, so the Given seeds the quote event with the step's id, then its accept.
  w.seed("excerpt.quoted", {
    id: "src-rfc-quote",
    title: "The client MAY retry the request.",
    card: "root",
    conversation: "rfc",
    session: "s-1",
    message: 0,
    start: 0,
    end: 33,
    speaker: "person",
    said_at: "2026-10-01T09:00:00Z",
  });
  w.seed("change.accepted", { id: "src-rfc-quote" });
  const r = w.run("say", "src-rfc-quote", "This quote supports the retry decision");
  expect({ status: r.status, err: r.stderr }).toEqual({ status: 0, err: "" });
  await p.goto(`${w.url}/map/src-rfc-quote`);
  const note = notes(p).filter({ hasText: "This quote supports the retry decision" });
  await expect(note).toHaveCount(1);
});
