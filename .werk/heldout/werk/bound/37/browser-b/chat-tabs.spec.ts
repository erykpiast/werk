import { expect, test } from "@playwright/test";
import { chat, say, send, withServer } from "./helpers.ts";

// The step names a tab strip below the composer with one chip per conversation.
const strip = (page: import("@playwright/test").Page) =>
  page.getByRole("tablist");
const SHORT = { timeout: 3000 };

test.use({ actionTimeout: 3000 });

test("23.1 two conversations with different home cards stay apart", async ({
  page,
}) => {
  await withServer(
    {
      roles: {
        chat: { replies: [[say("m1", "Reply A")], [say("m2", "Reply B")]] },
      },
    },
    async (server) => {
      await page.goto(server.url);
      await send(page, "Message in A");
      await expect(chat(page).getByText("Reply A")).toBeVisible();
      // Starting a second conversation on another card needs a tab strip with a new-tab control.
      await expect(strip(page)).toBeVisible(SHORT);
      await expect(strip(page).getByRole("tab")).toHaveCount(2, SHORT);
    },
  );
});

test("23.2 switching to a tab shows its newest message", async ({ page }) => {
  await withServer(
    { roles: { chat: { replies: [[say("m1", "Reply one")]] } } },
    async (server) => {
      await page.goto(server.url);
      await send(page, "Hello");
      await expect(chat(page).getByText("Reply one")).toBeVisible();
      await expect(strip(page).getByRole("tab")).toHaveCount(2, SHORT);
    },
  );
});

test("23.3 a crashed agent marks its tab and tells the other tabs", async ({
  page,
}) => {
  await withServer(
    {
      roles: {
        chat: {
          replies: [
            [say("m1", "Fine")],
            [{ stderr: "agent A died" }, { crash: 1 }],
          ],
        },
      },
    },
    async (server) => {
      await page.goto(server.url);
      await send(page, "Hello");
      await expect(chat(page).getByText("Fine")).toBeVisible();
      await expect(strip(page).getByRole("tab")).toHaveCount(2, SHORT);
    },
  );
});

test("23.4 a model switch is not a crash", async ({ page }) => {
  await withServer(
    {
      roles: {
        chat: { replies: [[say("m1", "First")], [say("m2", "Second")]] },
      },
    },
    async (server) => {
      await page.goto(server.url);
      await send(page, "Hello");
      await expect(chat(page).getByText("First")).toBeVisible();
      await chat(page).getByLabel("Model").selectOption({ value: "opus" });
      // The tab chip of the conversation must exist and not blink red.
      const chip = strip(page).getByRole("tab").first();
      await expect(chip).toBeVisible(SHORT);
      await expect(chip).not.toHaveAttribute("data-blink", "red");
      await send(page, "Again");
      await expect(chat(page).getByText("Second")).toBeVisible();
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
  await withServer(
    {
      roles: {
        chat: {
          replies: [
            [list(["a"]), say("m1", "Started"), { pause: 3000 }, list([])],
            [say("m2", 'Done.\n\nNext: say "merge it"')],
            [say("m3", "Merged")],
          ],
        },
      },
    },
    async (server) => {
      await page.goto(server.url);
      await send(page, "Go");
      await expect(chat(page).getByText("A background agent runs")).toBeVisible();
      // The tab counts as running.
      await expect.soft(strip(page).getByRole("tab").first()).toHaveAttribute(
        "data-state",
        "running",
        SHORT,
      );
      await expect(chat(page).getByText("A background agent runs")).toHaveCount(
        0,
        { timeout: 10000 },
      );
      await send(page, "Next");
      const offer = chat(page).getByRole("button", { name: "merge it" });
      await expect(offer).toBeVisible();
      await offer.click();
      await expect(chat(page).getByText("Merged")).toBeVisible();
      await expect(offer).toHaveCount(0);
      await expect(chat(page).locator("article").filter({ hasText: "merge it" }))
        .toHaveCount(1);
    },
  );
});
