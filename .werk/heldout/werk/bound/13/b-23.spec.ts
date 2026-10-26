import { expect, test } from "@playwright/test";
import { chat, composer, say, send, withServer } from "./b-support.ts";

const CARDS: [string, string][] = [
  ["card-a", "Card Alpha"],
  ["card-b", "Card Beta"],
];
const strip = (page: import("@playwright/test").Page) =>
  page.getByRole("tablist");

test("23.1 two conversations with different home cards stay apart", async ({
  page,
}) => {
  await withServer(
    {
      roles: {
        chat: {
          replies: [
            [say("a1", "Reply for A")],
            [say("b1", "Reply for B")],
            [
              {
                ask: {
                  id: "q1",
                  tool: "AskUserQuestion",
                  input: {
                    questions: [
                      {
                        question: "Which db?",
                        header: "DB",
                        multiSelect: false,
                        options: [{ label: "Postgres", description: "SQL" }],
                      },
                    ],
                  },
                },
              },
            ],
          ],
        },
      },
    },
    CARDS,
    async (server) => {
      await page.goto(`${server.url}/map/card-a`);
      await send(page, "Message A");
      await expect(chat(page).getByText("Reply for A")).toBeVisible();
      await page.goto(`${server.url}/map/card-b`);
      await send(page, "Message B");
      await expect(chat(page).getByText("Reply for B")).toBeVisible();
      const chips = strip(page).getByRole("tab");
      await expect(chips).toHaveCount(2);
      await expect(chips.nth(0)).toContainText("Card Alpha");
      await expect(chips.nth(1)).toContainText("Card Beta");
    },
  );
});

test("23.2 switching to a tab shows its newest message", async ({ page }) => {
  await withServer(
    { roles: { chat: { replies: [[say("a1", "x")], [say("b1", "y")]] } } },
    CARDS,
    async (server) => {
      await page.goto(`${server.url}/map/card-a`);
      await send(page, "one");
      await page.goto(`${server.url}/map/card-b`);
      await send(page, "two");
      const chips = strip(page).getByRole("tab");
      await expect(chips).toHaveCount(2);
      await chips.nth(1).click();
      const scroll = chat(page).locator("[data-slot=chat-scroll]");
      const atBottom = await scroll.evaluate(
        (n) => n.scrollHeight - n.scrollTop - n.clientHeight < 2,
      );
      expect(atBottom).toBe(true);
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
            [say("a1", "A starts"), { crash: 1 }],
            [say("b1", "B fine")],
            [say("a2", "A is back")],
          ],
        },
      },
    },
    CARDS,
    async (server) => {
      await page.goto(`${server.url}/map/card-a`);
      await send(page, "Message A");
      await page.goto(`${server.url}/map/card-b`);
      await send(page, "Message B");
      const chips = strip(page).getByRole("tab");
      await expect(chips).toHaveCount(2);
      await expect(chips.nth(0)).toHaveAttribute("data-state", /dead|crash|red/);
      await expect(chat(page).getByText(/Card Alpha.*(exit|error)/i)).toBeVisible();
    },
  );
});

test("23.4 a model switch is not a crash", async ({ page }) => {
  await withServer(
    { roles: { chat: { replies: [[say("a1", "Hello")], [say("a2", "Again")]] } } },
    CARDS,
    async (server) => {
      await page.goto(`${server.url}/map/card-a`);
      await send(page, "Hi");
      await expect(chat(page).getByText("Hello")).toBeVisible();
      const picker = page.getByRole("combobox", { name: /model/i });
      await expect(picker).toBeVisible();
      await picker.selectOption({ index: 1 });
      await send(page, "More");
      await expect(chat(page).getByText("Again")).toBeVisible();
    },
  );
});

test("23.5 a background agent line and a suggested next action", async ({
  page,
}) => {
  await withServer(
    {
      roles: {
        chat: {
          replies: [
            [
              {
                event: {
                  type: "system",
                  subtype: "task_started",
                  task_id: "t1",
                  description: "build",
                },
              },
              say("a1", "Started"),
            ],
            [say("a2", "Done.\n\nNext: say \"merge it\"")],
            [say("a3", "Merged")],
          ],
        },
      },
    },
    CARDS,
    async (server) => {
      await page.goto(`${server.url}/map/card-a`);
      await send(page, "Go");
      await expect(chat(page).getByText("Started")).toBeVisible();
      await expect(
        page.locator("[data-slot=background-line], [data-slot=background]"),
      ).toBeVisible();
      await send(page, "Next");
      await expect(
        chat(page).getByRole("button", { name: "merge it" }),
      ).toBeVisible();
      await chat(page).getByRole("button", { name: "merge it" }).click();
      await expect(chat(page).getByText("Merged")).toBeVisible();
      void composer;
    },
  );
});
