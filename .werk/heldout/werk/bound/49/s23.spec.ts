import { expect, type Page, test } from "@playwright/test";
import type { Script } from "../src/fake-agent/script.ts";
import { startBrowserServer } from "../e2e/support/server.ts";

const say = (id: string, text: string) => ({
  event: { type: "assistant", message: { id, content: [{ type: "text", text }] } },
});

async function withChat(script: Script, body: (s: Awaited<ReturnType<typeof startBrowserServer>>) => Promise<void>) {
  const server = await startBrowserServer({ script });
  await server.start();
  try {
    await body(server);
  } finally {
    await server.dispose();
  }
}
async function send(page: Page, text: string) {
  const composer = page.getByRole("textbox", { name: "Message" });
  await composer.fill(text);
  await composer.press("Enter");
}
const chat = (page: Page) => page.getByRole("complementary", { name: "Chat pane" });
const addCard = (s: { werk: (...a: string[]) => { code: number } }, id: string, title: string) => {
  expect(s.werk("add", id, "--title", title, "--parent", "root").code).toBe(0);
  expect(s.werk("accept", id, "--actor", "you").code).toBe(0);
};
const chips = (page: Page) => chat(page).getByRole("tab");

test("23.1 two conversations with different home cards stay apart", async ({ page }) => {
  await withChat(
    { roles: { chat: { replies: [[say("m1", "Reply for A")], [say("m2", "Reply for B")]] } } },
    async (s) => {
      addCard(s, "a", "Card A");
      addCard(s, "b", "Card B");
      await page.goto(`${s.url}/map/a`);
      await send(page, "message in A");
      await expect(chat(page).getByText("Reply for A")).toBeVisible();
      await page.goto(`${s.url}/map/b`);
      await expect(page.getByRole("heading", { level: 1, name: "Card B" })).toBeVisible();
      await expect(chips(page)).toHaveCount(2, { timeout: 4000 });
    },
  );
});

test("23.2 switching to a tab shows its newest message", async ({ page }) => {
  await withChat(
    { roles: { chat: { replies: [[say("m1", "one")], [say("m2", "two")]] } } },
    async (s) => {
      await page.goto(s.url);
      await send(page, "hello");
      await expect(chat(page).getByText("one")).toBeVisible();
      await expect(chips(page).first()).toBeVisible({ timeout: 4000 });
    },
  );
});

test("23.3 a crashed agent marks its tab", async ({ page }) => {
  await withChat(
    { roles: { chat: { replies: [[{ crash: 1 }]] } } },
    async (s) => {
      await page.goto(s.url);
      await send(page, "hello");
      await expect(chips(page).first()).toBeVisible({ timeout: 4000 });
    },
  );
});

test("23.4 a model switch is not a crash", async ({ page }) => {
  await withChat(
    { roles: { chat: { replies: [[say("m1", "one")], [say("m2", "two")]] } } },
    async (s) => {
      await page.goto(s.url);
      await send(page, "hello");
      await expect(chat(page).getByText("one")).toBeVisible();
      await chat(page).getByRole("combobox", { name: /model/i }).or(chat(page).getByRole("button", { name: /model/i })).first().click({ timeout: 4000 });
    },
  );
});

test("23.5 a background agent line and a suggested next action", async ({ page }) => {
  await withChat(
    { roles: { chat: { replies: [[say("m1", "Done.\nNext: say \"merge it\"")], [say("m2", "merged")]] } } },
    async (s) => {
      await page.goto(s.url);
      await send(page, "hello");
      await expect(chat(page).getByText("Done.")).toBeVisible();
      await chat(page).getByRole("button", { name: "merge it" }).click({ timeout: 4000 });
      await expect(chat(page).getByText("merged")).toBeVisible();
    },
  );
});
