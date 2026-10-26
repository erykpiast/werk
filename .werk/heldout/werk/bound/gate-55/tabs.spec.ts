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

async function withServer(
  script: Script,
  prepare: (s: BrowserServer) => void,
  body: (s: BrowserServer) => Promise<void>,
) {
  const server = await startBrowserServer({ script });
  await server.start();
  try {
    prepare(server);
    await body(server);
  } finally {
    await server.dispose();
  }
}

const addCards = (s: BrowserServer) => {
  for (const [id, title] of [
    ["alpha", "Card Alpha"],
    ["beta", "Card Beta"],
  ] as const) {
    expect(s.werk("add", id, "--title", title, "--parent", "root").code).toBe(
      0,
    );
    expect(s.werk("accept", id, "--actor", "you").code).toBe(0);
  }
};

const chat = (page: Page) =>
  page.getByRole("complementary", { name: "Chat pane" });
const left = (page: Page) => page.getByRole("region", { name: "Map pane" });
const chips = (page: Page) => page.locator("[data-slot=tab-chip]");

async function send(page: Page, text: string) {
  const composer = page.getByRole("textbox", { name: "Message" });
  await composer.fill(text);
  await composer.press("Enter");
}

const question = {
  id: "q1",
  tool: "AskUserQuestion",
  input: {
    questions: [
      {
        question: "Which db?",
        header: "DB",
        multiSelect: false,
        options: [
          { label: "Postgres", description: "SQL" },
          { label: "SQLite", description: "file" },
        ],
      },
    ],
  },
};

test("23.1 two conversations with different home cards stay apart", async ({
  page,
}) => {
  await withServer(
    {
      roles: {
        chat: {
          replies: [
            [say("a1", "Answer for alpha"), { pause: 5000 }, { ask: question }],
            [say("b1", "Answer for beta")],
          ],
        },
      },
    },
    addCards,
    async (server) => {
      await page.goto(server.url);
      await left(page).locator("a.tile", { hasText: "Card Alpha" }).click();
      await expect(
        left(page).getByRole("heading", { level: 1, name: "Card Alpha" }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "New conversation on this card" })
        .click();
      await left(page)
        .getByRole("button", { name: "We build software with agents" })
        .click();
      await left(page).locator("a.tile", { hasText: "Card Beta" }).click();
      await expect(
        left(page).getByRole("heading", { level: 1, name: "Card Beta" }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "New conversation on this card" })
        .click();

      const alpha = chips(page).filter({ hasText: "Card Alpha" });
      const beta = chips(page).filter({ hasText: "Card Beta" });
      await alpha.click();
      await expect(alpha).toHaveAttribute("aria-selected", "true");
      await send(page, "Hello alpha");
      await expect(chat(page).getByText("Answer for alpha")).toBeVisible();
      await beta.last().click();
      await expect(beta.last()).toHaveAttribute("aria-selected", "true");
      await send(page, "Hello beta");
      await expect(chat(page).getByText("Answer for beta")).toBeVisible();

      const labels = await chips(page).allTextContents();
      expect.soft(labels, "chips").toEqual(["Card Alpha", "Card Beta"]);

      await expect(chat(page).getByText("Hello alpha")).toHaveCount(0);
      await expect(chat(page).getByText("Answer for alpha")).toHaveCount(0);
      await alpha.click();
      await expect(chat(page).getByText("Hello alpha")).toBeVisible();
      await expect(chat(page).getByText("Hello beta")).toHaveCount(0);
      await expect(chat(page).getByText("Answer for beta")).toHaveCount(0);
      await beta.last().click();

      // The ask of the alpha agent arrives while beta is in view.
      await expect(alpha).toHaveAttribute("data-ask", "true", {
        timeout: 15000,
      });
      await expect(page.locator('[data-slot="ask-bar"]')).toHaveCount(0);
      await expect(chat(page).getByText("Which db?")).toHaveCount(0);
      await alpha.click();
      const bar = page.locator('[data-slot="ask-bar"]');
      await expect(bar).toContainText("Which db?");
      await bar.getByLabel(/B\. SQLite/).check();
      await bar.getByRole("button", { name: "Submit answer" }).click();
      await expect(bar).toBeHidden();
    },
  );
});

const longText = (tag: string) =>
  Array.from({ length: 40 }, (_, i) => `${tag} paragraph ${i + 1}`).join(
    "\n\n",
  );

test("23.2 switching to a tab shows its newest message", async ({ page }) => {
  await withServer(
    {
      roles: {
        chat: {
          replies: [
            [say("r1", longText("one"))],
            [say("r2", longText("two"))],
            [say("r3", longText("three"))],
            [{ pause: 1500 }, say("r4", "Newest reply")],
            [{ pause: 3000 }, say("r5", "Late reply")],
          ],
        },
      },
    },
    () => {},
    async (server) => {
      await page.goto(server.url);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      // The first tab stays empty. The second tab holds the long log.
      await page.getByRole("button", { name: "New conversation on this card" }).click();
      const tabs = chips(page);
      await expect(tabs).toHaveCount(2);
      const first = tabs.nth(0);
      const second = tabs.nth(1);
      await expect(second).toHaveAttribute("aria-selected", "true");
      await send(page, "m1");
      await expect(chat(page).getByText("one paragraph 40")).toBeVisible();
      await send(page, "m2");
      await expect(chat(page).getByText("two paragraph 40")).toBeVisible();
      await send(page, "m3");
      await expect(chat(page).getByText("three paragraph 40")).toBeVisible();

      const scroller = page.locator("[data-slot=chat-scroll]");
      expect(
        await scroller.evaluate((n) => n.scrollHeight - n.clientHeight),
      ).toBeGreaterThan(200);

      await send(page, "m4");
      await first.click();
      await expect(first).toHaveAttribute("aria-selected", "true");
      // The agent of the second tab replies while the first tab is in view.
      await page.waitForTimeout(3000);
      await second.click();
      await expect(second).toHaveAttribute("aria-selected", "true");
      const gap = () =>
        scroller.evaluate((n) => n.scrollHeight - n.scrollTop - n.clientHeight);
      await expect(chat(page).getByText("Newest reply")).toBeInViewport();
      expect(await gap()).toBeLessThanOrEqual(2);

      // The person scrolls up, and the agent sends another reply.
      await send(page, "m5");
      await scroller.hover();
      await page.mouse.wheel(0, -100000);
      await expect.poll(() => scroller.evaluate((n) => n.scrollTop)).toBe(0);
      await expect(chat(page).getByText("Late reply")).toHaveCount(1, {
        timeout: 15000,
      });
      expect(await scroller.evaluate((n) => n.scrollTop)).toBe(0);
      await expect(chat(page).getByText("Late reply")).not.toBeInViewport();
    },
  );
});
