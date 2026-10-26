import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { BrowserServer } from "../../e2e/support/server.ts";
import { chat, say, send, withChat } from "./helpers.ts";

const strip = (page: Page) => page.getByRole("tablist");
const chipOf = (page: Page, title: string) =>
  strip(page).getByRole("tab", { name: title });

function addCard(server: BrowserServer, id: string, title: string) {
  expect(server.werk("add", id, "--title", title, "--parent", "root").code).toBe(0);
  expect(server.werk("accept", id, "--actor", "you").code).toBe(0);
}
const cardUrl = (server: BrowserServer, id: string) => `${server.url}/map/${id}`;

test("23.1 two conversations with different home cards stay apart", async ({
  page,
}) => {
  await withChat(
    {
      roles: {
        chat: {
          replies: [[say("a1", "Reply for A")], [say("b1", "Reply for B")]],
        },
      },
    },
    async (server) => {
      addCard(server, "alpha", "Card Alpha");
      addCard(server, "beta", "Card Beta");
      await page.goto(cardUrl(server, "alpha"));
      await send(page, "Message A");
      await page.goto(cardUrl(server, "beta"));
      await send(page, "Message B");
      await expect(chipOf(page, "Card Alpha")).toBeVisible();
      await expect(chipOf(page, "Card Beta")).toBeVisible();
      await expect(strip(page).getByRole("tab")).toHaveCount(2);
      await chipOf(page, "Card Alpha").click();
      await expect(chat(page)).toContainText("Message A");
      await expect(chat(page)).not.toContainText("Message B");
    },
  );
});

test("23.2 switching to a tab shows its newest message", async ({ page }) => {
  await withChat(
    {
      roles: {
        chat: {
          replies: [[say("a1", "Reply A")], [say("b1", "Reply B")]],
        },
      },
    },
    async (server) => {
      addCard(server, "alpha", "Card Alpha");
      addCard(server, "beta", "Card Beta");
      await page.goto(cardUrl(server, "alpha"));
      await send(page, "Message A");
      await page.goto(cardUrl(server, "beta"));
      await send(page, "Message B");
      await chipOf(page, "Card Beta").click();
      await expect(chat(page).getByText("Reply B")).toBeInViewport();
    },
  );
});

test("23.3 a crashed agent marks its tab and tells the other tabs", async ({
  page,
}) => {
  await withChat(
    {
      roles: {
        chat: {
          replies: [
            [say("a1", "Reply A")],
            [{ stderr: "Not logged in\nplease log in" }, { crash: 1 }],
          ],
        },
      },
    },
    async (server) => {
      addCard(server, "alpha", "Card Alpha");
      addCard(server, "beta", "Card Beta");
      await page.goto(cardUrl(server, "alpha"));
      await send(page, "Message A");
      await page.goto(cardUrl(server, "beta"));
      await send(page, "Message B");
      await expect(chipOf(page, "Card Alpha")).toHaveAttribute(
        "data-state",
        /red|dead/,
      );
    },
  );
});

test("23.4 a model switch is not a crash", async ({ page }) => {
  await withChat(
    {
      roles: { chat: { replies: [[say("a1", "Reply 1")], [say("a2", "Reply 2")]] } },
    },
    async (server) => {
      addCard(server, "alpha", "Card Alpha");
      await page.goto(cardUrl(server, "alpha"));
      await send(page, "Hello");
      await expect(chat(page).getByText("Reply 1")).toBeVisible();
      await chat(page).getByLabel("Model").selectOption("opus");
      // The conversation has a chip in the tab strip, and it does not blink red.
      await expect(chipOf(page, "Card Alpha")).toBeVisible();
      await expect(chipOf(page, "Card Alpha")).not.toHaveAttribute(
        "data-state",
        /red|dead/,
      );
      await expect(chat(page).getByText(/the agent exited/)).toHaveCount(0);
      await send(page, "Again");
      await expect(chat(page).getByText("Reply 2")).toBeVisible();
    },
  );
});

test("23.5 a running background agent and a suggested next action", async ({
  page,
}) => {
  const list = (ids: string[]) => ({
    event: {
      type: "system",
      subtype: "background_tasks",
      tasks: ids.map((id) => ({ id })),
    },
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
      addCard(server, "alpha", "Card Alpha");
      await page.goto(cardUrl(server, "alpha"));
      await send(page, "Go");
      const line = chat(page).getByText("A background agent runs");
      await expect(line).toBeVisible();
      // The tab counts as running.
      await expect(chipOf(page, "Card Alpha")).toHaveAttribute(
        "data-state",
        "running",
      );
      await send(page, "Status?");
      await expect(line).toHaveCount(0);
      const offer = chat(page).getByRole("button", { name: "merge it" });
      await expect(offer).toBeVisible();
      await offer.click();
      await expect(chat(page).getByText("Merged")).toBeVisible();
      await expect(offer).toHaveCount(0);
    },
  );
});
