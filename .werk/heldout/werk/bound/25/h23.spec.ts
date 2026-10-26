import { appendFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import type { Script } from "../src/fake-agent/script.ts";
import { type BrowserServer, startBrowserServer } from "./server.ts";

const say = (id: string, text: string) => ({
  event: { type: "assistant", message: { id, content: [{ type: "text", text }] } },
});
async function withChat(script: Script, body: (s: BrowserServer) => Promise<void>) {
  const server = await startBrowserServer({ script });
  await server.start();
  try {
    await body(server);
  } finally {
    await server.dispose();
  }
}
const card = (id: string) => [
  { type: "node.proposed", id, kind: "card", title: `Card ${id.toUpperCase()}`, status: "open", parent: "root" },
  { type: "node.accepted", id, actor: "you" },
];
const append = (s: BrowserServer, events: unknown[]) =>
  appendFileSync(join(s.dir, ".werk", "log.jsonl"), events.flat().map((e) => `${JSON.stringify(e)}\n`).join(""));
async function send(page: Page, text: string) {
  const c = page.getByRole("textbox", { name: "Message" });
  await c.fill(text);
  await c.press("Enter");
}
const chat = (page: Page) => page.getByRole("complementary", { name: "Chat pane" });
/** Whatever a tab strip of conversations would be: tab roles, or a tab-strip slot in the chat pane. */
const chips = (page: Page) => chat(page).locator('[role=tab], [data-slot*="tab"] > *, [data-slot*="chip"]:not([data-slot=image-chip])');

test("23.1 two conversations with different home cards stay apart", async ({ page }) => {
  await withChat({ roles: { chat: { replies: [[say("m1", "Reply for A")], [say("m2", "Reply for B")]] } } }, async (s) => {
    append(s, [card("a"), card("b")]);
    await page.goto(`${s.origin}${new URL(s.url).pathname}/map/a`);
    await send(page, "Hello from A");
    await expect(chat(page).getByText("Reply for A")).toBeVisible();
    await page.goto(`${s.origin}${new URL(s.url).pathname}/map/b`);
    await send(page, "Hello from B");
    await expect(chat(page).getByText("Reply for B")).toBeVisible();
    await expect(chips(page)).toHaveCount(2, { timeout: 5000 });
    await expect(chips(page).nth(0)).toContainText("Card A");
    await expect(chips(page).nth(1)).toContainText("Card B");
  });
});

test("23.2 switching to a tab shows its newest message", async ({ page }) => {
  await withChat({ roles: { chat: { replies: [[say("m1", "Reply for A")], [say("m2", "Reply for B")]] } } }, async (s) => {
    append(s, [card("a"), card("b")]);
    await page.goto(`${s.origin}${new URL(s.url).pathname}/map/a`);
    await send(page, "Hello from A");
    await page.goto(`${s.origin}${new URL(s.url).pathname}/map/b`);
    await send(page, "Hello from B");
    await expect(chips(page)).toHaveCount(2, { timeout: 5000 });
    await chips(page).nth(1).click();
    const log = chat(page).locator("[data-slot=chat-scroll]");
    const atBottom = () => log.evaluate((e) => e.scrollHeight - e.scrollTop - e.clientHeight < 2);
    expect(await atBottom()).toBe(true);
  });
});

test("23.3 a crashed agent marks its tab and tells the other tabs", async ({ page }) => {
  await withChat({ roles: { chat: { replies: [[say("m1", "Reply for A"), { crash: 1 }], [say("m2", "Reply for B")]] } } }, async (s) => {
    append(s, [card("a"), card("b")]);
    await page.goto(`${s.origin}${new URL(s.url).pathname}/map/a`);
    await send(page, "Hello from A");
    await page.goto(`${s.origin}${new URL(s.url).pathname}/map/b`);
    await send(page, "Hello from B");
    await expect(chips(page)).toHaveCount(2, { timeout: 5000 });
    await expect(chips(page).nth(0)).toHaveAttribute("data-state", /dead|crash|error/);
  });
});

test("23.4 a model switch is not a crash", async ({ page }) => {
  await withChat({ roles: { chat: { replies: [[say("m1", "First")], [say("m2", "Second")]] } } }, async (s) => {
    await page.goto(s.url);
    await send(page, "Hello");
    await expect(chat(page).getByText("First")).toBeVisible();
    const picker = chat(page).getByRole("combobox", { name: /model/i }).or(chat(page).getByRole("button", { name: /model/i }));
    await expect(picker).toHaveCount(1, { timeout: 3000 });
  });
});

test("23.5 a suggested next action shows as a button", async ({ page }) => {
  await withChat({ roles: { chat: { replies: [[say("m1", 'Done.\nNext: say "merge it"')], [say("m2", "Merged")]] } } }, async (s) => {
    await page.goto(s.url);
    await send(page, "Hello");
    await expect(chat(page).getByText("Done.")).toBeVisible();
    const button = chat(page).getByRole("button", { name: "merge it" });
    await expect(button).toBeVisible({ timeout: 3000 });
    await button.click();
    await expect(chat(page).getByText("Merged")).toBeVisible();
    await expect(button).toHaveCount(0);
  });
});
