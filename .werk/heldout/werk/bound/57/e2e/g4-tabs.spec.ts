import { expect, test } from "@playwright/test";
import { chat, say, send, withChat } from "./g4-support.ts";

const tabs = (page: import("@playwright/test").Page) =>
  page.locator("[data-slot=tab-strip], [role=tablist]");

test("23.1 two conversations with different home cards stay apart", async ({
  page,
}) => {
  await withChat(
    { roles: { chat: { replies: [[say("a", "Reply A")], [say("b", "Reply B")]] } } },
    async (server) => {
      server.werk("add", "card-a", "--title", "Card A", "--parent", "root", "--why", "w");
      server.werk("add", "card-b", "--title", "Card B", "--parent", "root", "--why", "w");
      await page.goto(`${server.url}/card-a`);
      await send(page, "msg in A");
      await expect(chat(page).getByText("Reply A")).toBeVisible();
      await page.goto(`${server.url}/card-b`);
      await send(page, "msg in B");
      await expect(chat(page).getByText("Reply B")).toBeVisible();
      await expect(tabs(page)).toBeVisible();
      await expect(tabs(page)).toContainText("Card A");
      await expect(tabs(page)).toContainText("Card B");
    },
  );
});

test("23.2 switching to a tab shows its newest message", async ({ page }) => {
  await withChat(
    { roles: { chat: { replies: [[say("a", "one")]] } } },
    async (server) => {
      await page.goto(server.url);
      await send(page, "hi");
      await expect(chat(page).getByText("one")).toBeVisible();
      await expect(tabs(page)).toBeVisible();
    },
  );
});

test("23.3 a crashed agent marks its tab and tells the other tabs", async ({
  page,
}) => {
  await withChat(
    { roles: { chat: { replies: [[{ stderr: "boom" }, { crash: 1 }]] } } },
    async (server) => {
      await page.goto(server.url);
      await send(page, "hi");
      await expect(tabs(page)).toBeVisible();
      await expect(tabs(page).locator("[data-state=crashed], [data-blink=red]")).toHaveCount(1);
    },
  );
});

test("23.4 a model switch is not a crash", async ({ page }) => {
  await withChat(
    { roles: { chat: { replies: [[say("a", "one")], [say("b", "two")]] } } },
    async (server) => {
      await page.goto(server.url);
      await send(page, "hi");
      await expect(chat(page).getByText("one")).toBeVisible();
      await chat(page).getByLabel("Model").selectOption("opus");
      await send(page, "again");
      await expect(chat(page).getByText("two")).toBeVisible();
      await expect(tabs(page)).toBeVisible();
    },
  );
});

test("23.5 background agent line and Next button", async ({ page }) => {
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
      await send(page, "go");
      await expect(chat(page).getByText("A background agent runs")).toBeVisible();
      await send(page, "status");
      await expect(chat(page).getByText("A background agent runs")).toHaveCount(0);
      const offer = chat(page).getByRole("button", { name: "merge it" });
      await expect(offer).toBeVisible();
      await offer.click();
      await expect(chat(page).getByText("Merged")).toBeVisible();
      await expect(offer).toHaveCount(0);
      // The tab counts as running / idle.
      await expect(tabs(page)).toBeVisible();
    },
  );
});
