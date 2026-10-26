import { expect, test, type Page } from "@playwright/test";
import type { BrowserServer } from "../../e2e/support/server.ts";
import { chat, composerOf, say, send, withChat } from "./chat-support.ts";

const FAST = { timeout: 3000 };
const tabs = (page: Page) => page.getByRole("tab");
const map = (page: Page) => page.getByRole("region", { name: "Map pane" });

function cards(server: BrowserServer) {
  for (const [id, title] of [["a", "Card A"], ["b", "Card B"]] as const) {
    expect(server.werk("add", id, "--title", title, "--parent", "root").code).toBe(0);
    expect(server.werk("accept", id, "--actor", "you").code).toBe(0);
  }
}

async function open(page: Page, title: string) {
  await map(page).getByRole("link", { name: new RegExp(title) }).first().click();
  await expect(map(page).getByRole("heading", { level: 1 })).toContainText(title);
}

const script = (...replies: ReturnType<typeof say>[][]) => ({
  roles: { chat: { replies } },
});

test("23.1 two conversations with different home cards stay apart", async ({ page }) => {
  await withChat(script([say("a1", "Reply A")], [say("b1", "Reply B")]), async (server) => {
    cards(server);
    await page.goto(server.url);
    await open(page, "Card A");
    await send(page, "Message in A");
    await expect(chat(page).getByText("Reply A")).toBeVisible();
    await page.getByRole("navigation", { name: "Breadcrumbs" }).getByRole("button").first().click();
    await open(page, "Card B");
    await send(page, "Message in B");
    await expect(chat(page).getByText("Reply B")).toBeVisible();
    await expect(tabs(page)).toHaveCount(2, FAST);
    await expect(tabs(page).nth(0)).toContainText("Card A");
    await expect(tabs(page).nth(1)).toContainText("Card B");
  });
});

test("23.2 switching to a tab shows its newest message", async ({ page }) => {
  await withChat(script([say("a1", "Reply A")], [say("b1", "Reply B")]), async (server) => {
    cards(server);
    await page.goto(server.url);
    await send(page, "First conversation");
    await expect(chat(page).getByText("Reply A")).toBeVisible();
    await send(page, "Second");
    await expect(chat(page).getByText("Reply B")).toBeVisible();
    // Two conversations in tabs: the product shows a tab for each.
    await expect(tabs(page)).toHaveCount(2, FAST);
    await tabs(page).nth(1).click();
    const scroller = chat(page).locator("[data-slot=chat-scroll]");
    await expect
      .poll(() => scroller.evaluate((n) => n.scrollHeight - n.scrollTop - n.clientHeight))
      .toBeLessThan(2);
  });
});

test("23.3 a crashed agent marks its tab and tells the other tabs", async ({ page }) => {
  await withChat(
    { roles: { chat: { replies: [[say("a1", "Reply A")], [{ stderr: "boom in A" }, { crash: 1 }], [{ stderr: "boom in A" }, { crash: 1 }]] } } },
    async (server) => {
      cards(server);
      await page.goto(server.url);
      await send(page, "Hello A");
      await expect(chat(page).getByText("Reply A")).toBeVisible();
      await send(page, "Crash it");
      await expect(chat(page)).toContainText("boom in A", { timeout: 15000 });
      await expect(tabs(page)).toHaveCount(2, FAST);
      await expect(tabs(page).first()).toHaveAttribute("data-state", /dead|crashed|red/, FAST);
    },
  );
});

test("23.4 a model switch is not a crash", async ({ page }) => {
  await withChat(script([say("a1", "Reply A")], [say("a2", "Reply after switch")]), async (server) => {
    await page.goto(server.url);
    await send(page, "Hello");
    await expect(chat(page).getByText("Reply A")).toBeVisible();
    await chat(page).getByLabel("Model").selectOption("opus");
    // The chip of the tab must exist and must not blink red.
    await expect(tabs(page)).toHaveCount(1, FAST);
    await expect(tabs(page).first()).not.toHaveAttribute("data-state", /dead|crashed|red/);
    await send(page, "Again");
    await expect(chat(page).getByText("Reply after switch")).toBeVisible();
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
            [list(["a"]), say("m1", "Started")],
            [list([]), say("m2", 'Done.\n\nNext: say "merge it"')],
            [say("m3", "Merged")],
          ],
        },
      },
    },
    async (server) => {
      await page.goto(server.url);
      await send(page, "Go");
      await expect(chat(page).getByText("Started")).toBeVisible();
      await expect(chat(page).getByText("A background agent runs")).toBeVisible();
      // The tab counts as running.
      await expect(tabs(page).first()).toHaveAttribute("data-state", /running/, FAST);
      await send(page, "Status?");
      await expect(chat(page).getByText("A background agent runs")).toHaveCount(0);
      const offer = chat(page).getByRole("button", { name: "merge it" });
      await expect(offer).toBeVisible();
      await offer.click();
      await expect(chat(page).getByText("Merged")).toBeVisible();
      await expect(offer).toHaveCount(0);
      await expect(chat(page).locator("[data-role=user]").filter({ hasText: "merge it" })).toHaveCount(1);
      void composerOf;
    },
  );
});
