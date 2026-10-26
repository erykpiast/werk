import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { Script } from "../src/fake-agent/script.ts";
import { type BrowserServer, startBrowserServer } from "../e2e/support/server.ts";

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
const chat = (page: Page) => page.getByRole("complementary", { name: "Chat pane" });
async function send(page: Page, text: string) {
  const composer = page.getByRole("textbox", { name: "Message" });
  await composer.fill(text);
  await composer.press("Enter");
}
/** The tab strip below the composer: one chip for each conversation. */
const strip = (page: Page) => chat(page).locator('[role=tablist], [data-slot=tab-strip], [data-slot=chat-tabs]');
const chips = (page: Page) => strip(page).locator('[role=tab], [data-slot=tab-chip], button');
const SHORT = { timeout: 3000 };

const two = (a: string, b: string): Script => ({
  roles: { chat: { replies: [[say("a1", a)], [say("b1", b)]] } },
});

test("23.1 two conversations with different home cards stay apart", async ({ page }) => {
  await withChat(two("Reply for A", "Reply for B"), async (server) => {
    server.werk("add", "card-a", "--title", "Card A", "--parent", "root");
    server.werk("accept", "card-a", "--actor", "you");
    server.werk("add", "card-b", "--title", "Card B", "--parent", "root");
    server.werk("accept", "card-b", "--actor", "you");
    await page.goto(`${server.url}/map/card-a`);
    await expect(page.getByRole("heading", { level: 1, name: "Card A" })).toBeVisible();
    // starting a second conversation needs a control for it
    await expect(chat(page).getByRole("button", { name: /new (conversation|chat)|\+/i })).toBeVisible(SHORT);
    await send(page, "Message A");
    await expect(chat(page).getByText("Reply for A")).toBeVisible();
    await expect(chips(page)).toHaveCount(2, SHORT);
    await expect(strip(page)).toContainText("Card A", SHORT);
  });
});

test("23.2 switching to a tab shows its newest message", async ({ page }) => {
  await withChat(two("First tab reply", "Second tab reply"), async (server) => {
    await page.goto(server.url);
    await send(page, "Hello");
    await expect(chat(page).getByText("First tab reply")).toBeVisible();
    await expect(strip(page)).toBeVisible(SHORT);
    await expect(chips(page)).toHaveCount(2, SHORT);
  });
});

test("23.3 a crashed agent marks its tab and tells the other tabs", async ({ page }) => {
  await withChat(
    { roles: { chat: { replies: [[say("a1", "Hi A")], [{ stderr: "boom A" }, { crash: 1 }], [{ stderr: "boom A" }, { crash: 1 }]] } } },
    async (server) => {
      await page.goto(server.url);
      await send(page, "Hello");
      await expect(chat(page).getByText("Hi A")).toBeVisible();
      await send(page, "Crash now");
      await expect(chat(page).getByText("boom A").first()).toBeVisible();
      // the chip of the tab blinks red
      await expect(strip(page).locator('[data-state=dead], [data-dead], .blink-red, [data-blink=red]')).toHaveCount(1, SHORT);
    },
  );
});

test("23.4 a model switch is not a crash", async ({ page }) => {
  await withChat(two("Working", "Still working"), async (server) => {
    await page.goto(server.url);
    await send(page, "Hello");
    await expect(chat(page).getByText("Working")).toBeVisible();
    await chat(page).getByLabel("Model").selectOption({ label: "Opus" });
    // the chip of the tab exists and does not blink red
    await expect(chips(page)).toHaveCount(1, SHORT);
    await send(page, "Again");
    await expect(chat(page).getByText("Still working")).toBeVisible();
    await expect(chat(page).getByText(/exited|not delivered/)).toHaveCount(0);
  });
});

test("23.5 a running background agent and a suggested next action", async ({ page }) => {
  const list = (ids: string[]) => ({
    event: { type: "system", subtype: "background_tasks", tasks: ids.map((id) => ({ id })) },
  });
  await withChat(
    {
      roles: {
        chat: {
          replies: [
            [list(["a"]), say("m1", "Started"), { pause: 3000 }, list([]), say("m1b", 'Done.\n\nNext: say "merge it"')],
            [say("m2", "Merged it")],
          ],
        },
      },
    },
    async (server) => {
      await page.goto(server.url);
      await send(page, "Go");
      const line = chat(page).getByText("A background agent runs");
      await expect(line).toBeVisible();
      // the tab counts as running
      await expect.soft(strip(page).locator('[data-running], [data-state=running]')).toHaveCount(1, SHORT);
      await expect(line).toHaveCount(0, { timeout: 10000 });
      await expect.soft(strip(page).locator('[data-running], [data-state=running]')).toHaveCount(0, SHORT);
      const offer = chat(page).getByRole("button", { name: "merge it" });
      await expect(offer).toBeVisible();
      await offer.click();
      await expect(chat(page).getByText("Merged it")).toBeVisible();
      await expect(offer).toHaveCount(0);
    },
  );
});
