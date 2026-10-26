import type { Page } from "@playwright/test";
import type { Script } from "../../src/fake-agent/script.ts";
import { expect, test } from "../../e2e/support/fixtures.ts";
import {
  type BrowserServer,
  startBrowserServer,
} from "../../e2e/support/server.ts";

const say = (id: string, text: string) => ({
  event: {
    type: "assistant",
    message: { id, content: [{ type: "text", text }] },
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
const chips = (page: Page) => page.locator("[data-slot=tab-chip]");
const newTab = (page: Page) =>
  page.getByRole("button", { name: "New conversation" }).click();

function addCards(server: BrowserServer) {
  for (const [id, title] of [
    ["a", "Card A"],
    ["b", "Card B"],
  ]) {
    expect(
      server.werk("add", id as string, "--title", title as string, "--parent", "root").code,
    ).toBe(0);
    expect(server.werk("accept", id as string, "--actor", "you").code).toBe(0);
  }
}
const openCard = async (page: Page, title: string) => {
  await page.locator("a.tile", { hasText: title }).click();
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
};

test("23.1 two conversations with different home cards stay apart", async ({ page }) => {
  const ask = {
    id: "q1",
    tool: "Bash",
    input: { command: "echo hello-from-a" },
    reason: "rule",
  };
  await withChat(
    {
      roles: {
        chat: {
          replies: [
            [say("m1", "Reply for A")],
            [say("m2", "Reply for B")],
            [{ ask }, say("m3", "A went on")],
          ],
        },
      },
    },
    async (server) => {
      addCards(server);
      await page.goto(server.url);
      await openCard(page, "Card A");
      await send(page, "Message in A");
      await expect(chat(page).getByText("Reply for A")).toBeVisible();
      await page.goBack();
      await openCard(page, "Card B");
      await newTab(page);
      await send(page, "Message in B");
      await expect(chat(page).getByText("Reply for B")).toBeVisible();
      await expect(chat(page).getByText("Message in A")).toHaveCount(0);

      await expect(chips(page)).toHaveCount(2);
      await expect.soft(chips(page).nth(0)).toHaveText("Card A");
      await expect.soft(chips(page).nth(1)).toHaveText("Card B");

      // tab A asks while the person looks at tab B
      await chips(page).nth(0).click();
      await expect(chat(page).getByText("Message in A")).toBeVisible();
      await expect(chat(page).getByText("Message in B")).toHaveCount(0);
      await send(page, "Ask me something");
      await expect(page.locator("[data-slot=ask-bar]")).toContainText("Bash wants to run");
      await chips(page).nth(1).click();
      await expect(page.locator("[data-slot=ask-bar]")).toHaveCount(0);
      await expect.soft(chips(page).nth(0)).toHaveAttribute("data-blink", "yellow");
      await chips(page).nth(0).click();
      const bar = page.locator("[data-slot=ask-bar]");
      await expect(bar).toContainText("echo hello-from-a");
      await bar.getByRole("button", { name: "Allow once" }).click();
      await expect(chat(page).getByText("A went on")).toBeVisible();
    },
  );
});

const longReply = (n: number) =>
  Array.from({ length: n }, (_, i) => `Paragraph ${i}\n\n`.repeat(1)).join("\n");

test("23.2 switching to a tab shows its newest message; scrolled-up log stays", async ({ page }) => {
  await withChat(
    {
      roles: {
        chat: {
          replies: [
            [say("m1", "first tab reply")],
            [say("m2", longReply(80))],
            [{ pause: 1500 }, say("m3", `${longReply(80)}\nNEWEST reply`)],
            [{ pause: 3000 }, say("m4", `${longReply(80)}\nNEWEST reply\n\nANOTHER reply`)],
          ],
        },
      },
    },
    async (server) => {
      await page.goto(server.url);
      await send(page, "hello first");
      await expect(chat(page).getByText("first tab reply")).toBeVisible();
      await newTab(page);
      await send(page, "fill log");
      await expect(chat(page).getByText("Paragraph 79")).toBeAttached();
      await send(page, "second");
      await chips(page).nth(0).click();
      await expect(chat(page).getByText("first tab reply")).toBeVisible();
      await page.waitForTimeout(3500);
      await chips(page).nth(1).click();
      const scroller = page.locator("[data-slot=chat-scroll]");
      await expect(chat(page).getByText("NEWEST reply")).toBeInViewport();
      const atBottom = () =>
        scroller.evaluate((n) => n.scrollHeight - n.scrollTop - n.clientHeight < 5);
      expect(await atBottom()).toBe(true);
      expect(await scroller.evaluate((n) => n.scrollHeight > n.clientHeight + 200)).toBe(true);

      await send(page, "third");
      await scroller.evaluate((n) => {
        n.scrollTop = 0;
      });
      await expect(chat(page).getByText("ANOTHER reply")).toBeAttached({ timeout: 15000 });
      await page.waitForTimeout(300);
      expect(await scroller.evaluate((n) => n.scrollTop)).toBeLessThan(50);
    },
  );
});

test("23.3 a crashed agent marks its tab and tells the other tabs", async ({ page }) => {
  const err = "kaboom line one\nkaboom line two";
  await withChat(
    {
      roles: {
        chat: {
          replies: [
            [{ pause: 2000 }, { stderr: err }, { crash: 1 }],
            [{ stderr: err }, { crash: 1 }],
            [say("m3", "A is back")],
          ],
        },
      },
    },
    async (server) => {
      await page.goto(server.url);
      await newTab(page); // tab 2 is the one the person looks at
      await chips(page).nth(0).click();
      await send(page, "crash me");
      await chips(page).nth(1).click();
      await expect(chips(page).nth(0)).toHaveAttribute("data-blink", "red", { timeout: 25000 });
      const line = page.locator("[data-slot=dead-line]");
      await expect(line).toHaveCount(1);
      await expect(line).toContainText("kaboom line one");
      await expect(line).toContainText(await chips(page).nth(0).innerText());
      await expect(line).not.toContainText("kaboom line two");
      await chips(page).nth(0).click();
      const own = page.locator("[data-slot=dead-error]");
      await expect(own).toContainText("kaboom line one");
      await expect(own).toContainText("kaboom line two");
      await send(page, "try again");
      await expect(chat(page).getByText("A is back")).toBeVisible({ timeout: 20000 });
      await expect(chips(page).nth(0)).not.toHaveAttribute("data-blink", "red");
      await chips(page).nth(1).click();
      await expect(page.locator("[data-slot=dead-line]")).toHaveCount(0);
    },
  );
});

test("23.4 a model switch is not a crash", async ({ page }) => {
  await withChat(
    { roles: { chat: { replies: [[say("m1", "one")], [say("m2", "two")]] } } },
    async (server) => {
      await page.goto(server.url);
      await newTab(page);
      await chips(page).nth(0).click();
      await send(page, "hi");
      await expect(chat(page).getByText("one")).toBeVisible();
      await page.getByRole("combobox", { name: "Model" }).selectOption({ label: "Opus" });
      await page.waitForTimeout(1500);
      await expect(chips(page).nth(0)).not.toHaveAttribute("data-blink", "red");
      await expect(chips(page).nth(1)).not.toHaveAttribute("data-blink", "red");
      await expect(page.locator("[data-slot=dead-line]")).toHaveCount(0);
      await chips(page).nth(1).click();
      await expect(page.locator("[data-slot=dead-line]")).toHaveCount(0);
      await chips(page).nth(0).click();
      await send(page, "again");
      await expect(chat(page).getByText("two")).toBeVisible({ timeout: 20000 });
      await expect(chips(page).nth(0)).not.toHaveAttribute("data-blink", "red");
    },
  );
});

test("23.5 a background agent line and a suggested next action", async ({ page }) => {
  const tasks = (list: unknown[]) => ({
    event: { type: "system", subtype: "background_tasks", tasks: list },
  });
  await withChat(
    {
      roles: {
        chat: {
          replies: [
            [tasks([{ id: "t1" }]), say("m1", "Started a task")],
            [tasks([]), say("m2", 'All done.\n\nNext: say "merge it"')],
            [say("m3", "Merged for you")],
          ],
        },
      },
    },
    async (server) => {
      await page.goto(server.url);
      await send(page, "start");
      await expect(chat(page).getByText("Started a task")).toBeVisible();
      await expect(page.locator("[data-slot=background-line]")).toBeVisible();
      await send(page, "status?");
      await expect(chat(page).getByText("All done.")).toBeVisible();
      await expect(page.locator("[data-slot=background-line]")).toHaveCount(0);
      const button = page.getByRole("button", { name: "merge it" });
      await expect(button).toBeVisible();
      await button.click();
      await expect(chat(page).locator("article").last()).toContainText("merge it");
      await expect(chat(page).getByText("Merged for you")).toBeVisible();
      await expect(button).toHaveCount(0);
    },
  );
});
