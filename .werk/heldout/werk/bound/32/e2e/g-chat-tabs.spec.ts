import type { Page } from "@playwright/test";
import { expect, test } from "../../e2e/support/fixtures.ts";
import {
  type BrowserServer,
} from "../../e2e/support/server.ts";
import { chat, say, send, tasks, withChat } from "./support-chat.ts";

/** Two cards, "Card A" and "Card B", under the root. */
function twoCards(server: BrowserServer) {
  for (const [id, title] of [
    ["a", "Card A"],
    ["b", "Card B"],
  ] as const) {
    const r = server.werk("add", id, "--title", title, "--parent", "root");
    if (r.code !== 0) throw new Error(`werk add failed: ${r.stderr}`);
  }
}

/** The strip of conversation chips below the composer. */
const strip = (page: Page) =>
  page.getByRole("tablist", { name: /conversations/i });
const chip = (page: Page, title: string) =>
  strip(page).getByRole("tab", { name: title });

test("23.1 two conversations with different home cards stay apart", async ({
  page,
}) => {
  await withChat(
    {
      roles: {
        chat: {
          replies: [
            [say("a1", "Reply for A")],
            [say("b1", "Reply for B")],
          ],
        },
      },
    },
    async (server) => {
      await page.goto(`${server.url}/map/a`);
      await expect(page.getByRole("heading", { level: 1 })).toContainText("Card A");
      await page
        .getByRole("button", { name: /new conversation/i })
        .click({ timeout: 3000 });
      await send(page, "Message in A");
      await page.goto(`${server.url}/map/b`);
      await page
        .getByRole("button", { name: /new conversation/i })
        .click({ timeout: 3000 });
      await send(page, "Message in B");
      await expect(strip(page).getByRole("tab")).toHaveCount(2);
      await expect(chip(page, "Card A")).toBeVisible();
      await expect(chip(page, "Card B")).toBeVisible();
      await expect(chat(page).getByText("Reply for A")).toHaveCount(0);
    },
    twoCards,
  );
});

test("23.2 switching to a tab shows its newest message", async ({ page }) => {
  await withChat(
    { roles: { chat: { replies: [[say("a1", "x")], [say("b1", "y")]] } } },
    async (server) => {
      await page.goto(`${server.url}/map/a`);
      await page
        .getByRole("button", { name: /new conversation/i })
        .click({ timeout: 3000 });
      await expect(strip(page).getByRole("tab")).toHaveCount(2);
    },
    twoCards,
  );
});

test("23.3 a crashed agent marks its tab and tells the other tabs", async ({
  page,
}) => {
  await withChat(
    {
      roles: {
        chat: {
          replies: [[{ stderr: "Tab A went down" }, { crash: 1 }]],
        },
      },
    },
    async (server) => {
      await page.goto(`${server.url}/map/a`);
      await expect(strip(page)).toBeVisible({ timeout: 3000 });
      await expect(chip(page, "Card A")).toHaveAttribute("data-state", "crashed");
    },
    twoCards,
  );
});

test("23.4 a model switch is not a crash", async ({ page }) => {
  await withChat(
    {
      roles: {
        chat: { replies: [[say("m1", "First")], [say("m2", "After the switch")]] },
      },
    },
    async (server) => {
      await page.goto(server.url);
      await send(page, "Hello");
      await expect(chat(page).getByText("First")).toBeVisible();
      await chat(page).getByLabel("Model").selectOption("opus");
      // The conversation sits in a tab: its chip must not be red.
      await expect(strip(page).getByRole("tab").first()).toBeVisible({
        timeout: 3000,
      });
      await expect(strip(page).getByRole("tab").first()).not.toHaveAttribute(
        "data-state",
        "crashed",
      );
      await send(page, "Again");
      await expect(chat(page).getByText("After the switch")).toBeVisible();
    },
  );
});

test("23.5 a running background agent and a suggested next action", async ({
  page,
}) => {
  await withChat(
    {
      roles: {
        chat: {
          replies: [
            [tasks(["t1"]), say("m1", "Started")],
            [tasks([]), say("m2", 'Done.\n\nNext: say "merge it"')],
            [say("m3", "Merged")],
          ],
        },
      },
    },
    async (server) => {
      await page.goto(server.url);
      await send(page, "Go");
      const line = chat(page).getByText("A background agent runs");
      await expect(line).toBeVisible();
      await expect(strip(page).getByRole("tab").first()).toHaveAttribute(
        "data-state",
        "running",
        { timeout: 3000 },
      );
    },
  );
});
