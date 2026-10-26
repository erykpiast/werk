import type { Page } from "@playwright/test";
import { open } from "../src/map/mark-fixtures.ts";
import { appendLog, chat, composerOf, expect, launched, messages, say, send, test, withChat } from "./pw.ts";

/** The chips of the conversation tabs, in the strip below the composer. */
const tabs = (page: Page) => chat(page).getByRole("tab");
const cards = (server: Parameters<Parameters<typeof withChat>[1]>[0]) =>
  appendLog(server, ...open("a", { parent: "root", title: "Card A" }), ...open("b", { parent: "root", title: "Card B" }));

test("23.1 two conversations with different home cards stay apart", async ({ page }) => {
  await withChat(
    { roles: { chat: { replies: [[say("m1", "Reply in A")], [say("m2", "Reply in B")]] } } },
    async (server) => {
      cards(server);
      await page.goto(`${server.url}/map/a`);
      await send(page, "Message in A");
      await expect(chat(page).getByText("Reply in A")).toBeVisible();
      await page.goto(`${server.url}/map/b`);
      await send(page, "Message in B");
      await expect(chat(page).getByText("Reply in B")).toBeVisible();
      await expect(tabs(page)).toHaveCount(2);
      await expect(tabs(page).nth(0)).toContainText("Card A");
      await expect(tabs(page).nth(1)).toContainText("Card B");
    },
  );
});

test("23.2 switching to a tab shows its newest message", async ({ page }) => {
  const long = Array.from({ length: 30 }, (_, i) => say(`m${i}`, `Line ${i} of a long reply`));
  await withChat({ roles: { chat: { replies: [[say("a1", "First tab")], long] } } }, async (server) => {
    cards(server);
    await page.goto(`${server.url}/map/a`);
    await send(page, "one");
    await expect(chat(page).getByText("First tab")).toBeVisible();
    await expect(tabs(page)).toHaveCount(2);
  });
});

test("23.3 a crashed agent marks its tab and tells the other tabs", async ({ page }) => {
  await withChat(
    { roles: { chat: { replies: [[{ stderr: "boom: the agent died" }, { crash: 1 }], [{ stderr: "boom: the agent died" }, { crash: 1 }]] } } },
    async (server) => {
      cards(server);
      await page.goto(`${server.url}/map/a`);
      await send(page, "crash now");
      await expect(chat(page)).toContainText("boom: the agent died", { timeout: 20_000 });
      await expect(tabs(page)).toHaveCount(2);
      await expect(tabs(page).nth(0)).toHaveAttribute("data-state", /dead|crash|red/);
    },
  );
});

test("23.4 a model switch is not a crash", async ({ page }) => {
  await withChat(
    { roles: { chat: { replies: [[say("m1", "First")], [say("m2", "Second")]] } } },
    async (server) => {
      await page.goto(server.url);
      await send(page, "hello");
      await expect(chat(page).getByText("First")).toBeVisible();
      await chat(page).getByLabel("Model").selectOption({ label: "Opus" });
      await expect.poll(() => launched(server).length).toBe(2);
      await expect(tabs(page)).toHaveCount(1);
      await expect(chat(page).getByRole("alert")).toHaveCount(0);
      await send(page, "again");
      await expect(chat(page).getByText("Second")).toBeVisible();
    },
  );
});

const list = (ids: string[]) => ({
  event: { type: "system", subtype: "background_tasks", tasks: ids.map((id) => ({ id })) },
});

test("23.5 a running background agent and a suggested next action", async ({ page }) => {
  await withChat(
    {
      roles: {
        chat: {
          replies: [
            [list(["a"]), say("m1", "Started"), { pause: 3000 }, list([]), say("m2", 'Ready.\n\nNext: say "merge it"')],
            [say("m3", "Merged")],
          ],
        },
      },
    },
    async (server) => {
      await page.goto(server.url);
      await send(page, "go");
      const line = chat(page).getByText("A background agent runs");
      await expect(line).toBeVisible();
      await expect.soft(tabs(page).first(), "the tab counts as running").toHaveAttribute("data-running", "true");
      await expect(line).toHaveCount(0, { timeout: 15_000 });
      await expect.soft(tabs(page).first(), "the tab counts as idle").not.toHaveAttribute("data-running", "true");
      const offer = chat(page).getByRole("button", { name: "merge it" });
      await expect(offer).toBeVisible();
      await offer.click();
      await expect(chat(page).locator("article").last()).toContainText("merge it");
      await expect(chat(page).getByText("Merged")).toBeVisible();
      await expect(offer).toHaveCount(0);
      expect(messages(server)[1]).toMatch(/merge it$/);
      void composerOf;
    },
  );
});
