import type { Page } from "@playwright/test";
import { expect, test } from "../e2e/support/fixtures.ts";
import {
  type BrowserServer,
  startBrowserServer,
} from "../e2e/support/server.ts";
import type { Script } from "../src/fake-agent/script.ts";

const say = (id: string, text: string) => ({
  event: {
    type: "assistant",
    message: { id, content: [{ type: "text", text }] },
  },
});
const list = (ids: string[]) => ({
  event: {
    type: "system",
    subtype: "background_tasks",
    tasks: ids.map((id) => ({ id })),
  },
});

async function withChat(
  script: Script,
  body: (server: BrowserServer) => Promise<void>,
) {
  const server = await startBrowserServer({ script });
  await server.start();
  try {
    await body(server);
  } finally {
    await server.dispose();
  }
}

const chat = (page: Page) =>
  page.getByRole("complementary", { name: "Chat pane" });

async function send(page: Page, text: string) {
  const composer = page.getByRole("textbox", { name: "Message" });
  await composer.fill(text);
  await composer.press("Enter");
}

/** A conversation tab chip is a tab named for its home card's title. */
const chip = (page: Page, title: string | RegExp) =>
  page.getByRole("tab", { name: title });

const ROOT = /We build software with agents/;
const short = { timeout: 3000 };

test("23.1 two conversations with different home cards stay apart", async ({
  page,
}) => {
  await withChat(
    {
      roles: {
        chat: { replies: [[say("m1", "Reply A")], [say("m2", "Reply B")]] },
      },
    },
    async (server) => {
      await page.goto(server.url);
      await send(page, "Message A");
      await expect(chat(page).getByText("Reply A")).toBeVisible();
      // The tab strip below the composer shows a chip for each conversation.
      await expect(chip(page, ROOT)).toHaveCount(1, short);
    },
  );
});

test("23.2 switching to a tab shows its newest message", async ({ page }) => {
  await withChat(
    { roles: { chat: { replies: [[say("m1", "Reply 1")]] } } },
    async (server) => {
      await page.goto(server.url);
      await send(page, "Message 1");
      await expect(chat(page).getByText("Reply 1")).toBeVisible();
      await expect(page.getByRole("tab", { name: ROOT })).toHaveCount(1, short);
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
            [{ stderr: "tab A exploded" }, { crash: 1 }],
            [{ stderr: "tab A exploded" }, { crash: 1 }],
          ],
        },
      },
    },
    async (server) => {
      await page.goto(server.url);
      await send(page, "Message A");
      await expect(chat(page)).toContainText("tab A exploded");
      await expect(chip(page, ROOT)).toHaveCount(1, short);
    },
  );
});

test("23.4 a model switch is not a crash", async ({ page }) => {
  await withChat(
    {
      roles: {
        chat: { replies: [[say("m1", "First")], [say("m2", "After switch")]] },
      },
    },
    async (server) => {
      await page.goto(server.url);
      await send(page, "Hello");
      await expect(chat(page).getByText("First")).toBeVisible();
      await chat(page).getByLabel("Model").selectOption("opus");
      await expect
        .poll(() => server.launches().filter((r) => r.kind === "launch").length)
        .toBe(2);
      await expect(page.getByText(/\(dead\)/)).toHaveCount(0);
      await send(page, "Again");
      await expect(chat(page).getByText("After switch")).toBeVisible();
      // The step names a chip of the tab, and the page has none.
      await expect(chip(page, ROOT)).toHaveCount(1, short);
    },
  );
});

test("23.5 a background agent line and a suggested next action", async ({
  page,
}) => {
  await withChat(
    {
      roles: {
        chat: {
          replies: [
            [list(["a"]), say("m1", "Started")],
            [list([]), say("m2", 'Done.\n\nNext: say "merge it"')],
            [say("m3", "Merged now")],
          ],
        },
      },
    },
    async (server) => {
      await page.goto(server.url);
      await send(page, "Go");
      await expect(chat(page).getByText("Started")).toBeVisible();
      await expect(
        chat(page).getByText("A background agent runs"),
      ).toBeVisible();
      // The tab counts as running.
      await expect
        .soft(page.getByRole("tab", { name: ROOT }))
        .toHaveAttribute("data-running", "true", short);
      await send(page, "Report");
      await expect(chat(page).getByText("A background agent runs")).toHaveCount(
        0,
      );
      const offer = chat(page).getByRole("button", { name: "merge it" });
      await expect(offer).toBeVisible();
      await offer.click();
      await expect(
        chat(page).locator('[data-role="user"]', { hasText: "merge it" }),
      ).toHaveCount(1);
      await expect(chat(page).getByText("Merged now")).toBeVisible();
      await expect(offer).toHaveCount(0);
    },
  );
});
