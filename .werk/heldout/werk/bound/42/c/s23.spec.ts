import { type Page, expect, test } from "@playwright/test";
import { chat, composer, send, say, withServer, type Srv } from "./support.ts";

const chips = (page: Page) => page.locator("[data-slot=tab-chip]");
const newTab = (page: Page) => page.locator("[data-slot=tab-new]").click();
const bgList = (ids: string[]) => ({
  event: { type: "system", subtype: "background_tasks", tasks: ids.map((id) => ({ id })) },
});
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
const goCard = async (page: Page, id: string) => {
  const box = page.getByRole("searchbox", { name: "Search the map" });
  await box.fill(`#${id}`);
  await box.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/map/${id}$`));
};
const cards = (s: Srv) => {
  s.card("a", "Card Alpha", "root");
  s.card("b", "Card Beta", "root");
};

test("23.1 two conversations with different home cards stay apart", async ({ page }) => {
  await withServer(
    {
      script: {
        roles: {
          chat: {
            replies: [
              [say("m1", "Reply for alpha")],
              [say("m2", "Reply for beta")],
              [{ pause: 1500 }, { ask: question }, say("m3", "after question")],
            ],
          },
        },
      },
    },
    async (s) => {
      await page.goto(`${s.url}/map/a`);
      await expect(page.getByRole("heading", { level: 1, name: "Card Alpha" })).toBeVisible();
      await send(page, "Message for alpha");
      await expect(chat(page).getByText("Reply for alpha")).toBeVisible();
      await goCard(page, "b");
      await newTab(page);
      await send(page, "Message for beta");
      await expect(chat(page).getByText("Reply for beta")).toBeVisible();
      await expect(chips(page)).toHaveCount(2);
      // the chips are labelled with the titles of the home cards
      await expect.soft(chips(page), "LABELS").toHaveText(["Card Alpha", "Card Beta"]);
      const log = chat(page).getByRole("log", { name: "Conversation" });
      await expect(log).toContainText("Message for beta");
      await expect(log).not.toContainText("Reply for alpha");
      await chips(page).nth(0).click();
      await expect(log).toContainText("Message for alpha");
      await expect(log).not.toContainText("Reply for beta");
      await send(page, "Ask me something");
      await chips(page).nth(1).click();
      await expect.soft(chips(page).nth(0), "YELLOW").toHaveAttribute("data-blink", "yellow", { timeout: 20000 });
      await expect(page.locator('[data-slot="ask-bar"]')).toHaveCount(0);
      await chips(page).nth(0).click();
      await expect(page.locator('[data-slot="ask-bar"]')).toContainText("Postgres");
    },
    cards,
  );
});

test("23.2 switching to a tab shows its newest message, and a scrolled log stays put", async ({ page }) => {
  const long = (tag: string) =>
    say(tag, Array.from({ length: 60 }, (_, i) => `${tag} line ${i}`).join("\n\n"));
  await withServer(
    {
      script: {
        roles: {
          chat: {
            replies: [
              [say("m1", "one")],
              [long("L2")],
              [{ pause: 2500 }, say("m3", "NEWEST-REPLY-3")],
              [{ pause: 2500 }, say("m4", "NEWEST-REPLY-4")],
            ],
          },
        },
      },
    },
    async (s) => {
      await page.goto(s.url);
      await send(page, "first tab");
      await expect(chat(page).getByText("one", { exact: true })).toBeVisible();
      await newTab(page);
      await send(page, "second tab");
      await expect(chat(page).getByText(/L2 line 59/)).toBeVisible();
      await send(page, "second again");
      await chips(page).nth(0).click();
      await expect(chat(page).getByText("first tab")).toBeVisible();
      await page.waitForTimeout(4000);
      await chips(page).nth(1).click();
      const scroll = chat(page).locator("[data-slot=chat-scroll]");
      await expect(chat(page).getByText("NEWEST-REPLY-3")).toBeVisible();
      const atBottom = () =>
        scroll.evaluate((el) => Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop) < 4);
      expect(await scroll.evaluate((el) => el.scrollHeight > el.clientHeight + 100)).toBe(true);
      expect(await atBottom()).toBe(true);
      await send(page, "third");
      await scroll.evaluate((el) => {
        el.scrollTop = 0;
      });
      await expect(chat(page).getByText("NEWEST-REPLY-4")).toBeAttached({ timeout: 20000 });
      await page.waitForTimeout(500);
      expect.soft(await scroll.evaluate((el) => el.scrollTop), "STAYS").toBeLessThan(50);
    },
  );
});

test("23.3 a crashed agent marks its tab and tells the other tabs", async ({ page }) => {
  const crash = [{ stderr: "boom: agent failed\nsecond line of the error" }, { crash: 1 }];
  await withServer(
    { script: { roles: { chat: { replies: [crash, crash, [say("m1", "I am back")]] } } } },
    async (s) => {
      await page.goto(s.url);
      await newTab(page);
      await expect(chips(page)).toHaveCount(2);
      const [a, b] = [chips(page).nth(1), chips(page).nth(0)];
      await send(page, "hello");
      await b.click();
      await expect(a).toHaveAttribute("data-blink", "red", { timeout: 30000 });
      const line = page.locator("[data-slot=dead-line]");
      await expect(line).toHaveCount(1);
      await expect(line).toContainText("boom: agent failed");
      await expect(line).toContainText(await a.innerText());
      await a.click();
      await expect(page.locator("[data-slot=dead-error]")).toContainText("second line of the error");
      await send(page, "try again");
      await expect(chat(page).getByText("I am back")).toBeVisible({ timeout: 30000 });
      await expect(a).not.toHaveAttribute("data-blink", "red");
      await b.click();
      await expect(page.locator("[data-slot=dead-line]")).toHaveCount(0);
    },
  );
});

test("23.4 a model switch is not a crash", async ({ page }) => {
  await withServer(
    { script: { roles: { chat: { replies: [[say("m1", "first")], [say("m2", "after switch")]] } } } },
    async (s) => {
      await page.goto(s.url);
      await newTab(page);
      await chips(page).nth(0).click();
      await send(page, "hello");
      await expect(chat(page).getByText("first")).toBeVisible();
      await chat(page).getByLabel("Model").selectOption({ label: "Opus" });
      await expect.poll(() => s.launched().length).toBe(2);
      await page.waitForTimeout(1500);
      for (const c of await chips(page).all()) {
        await expect(c).not.toHaveAttribute("data-blink", "red");
      }
      await expect(page.locator("[data-slot=dead-line]")).toHaveCount(0);
      await chips(page).nth(1).click();
      await expect(page.locator("[data-slot=dead-line]")).toHaveCount(0);
      await chips(page).nth(0).click();
      await send(page, "next");
      await expect(chat(page).getByText("after switch")).toBeVisible({ timeout: 30000 });
    },
  );
});

test("23.5 background agent line, tab running, and a Next button", async ({ page }) => {
  await withServer(
    {
      script: {
        roles: {
          chat: {
            replies: [
              [bgList(["a"]), say("m1", "Started task")],
              [bgList([]), say("m2", 'Done.\n\nNext: say "merge it"')],
              [say("m3", "Merged it")],
            ],
          },
        },
      },
    },
    async (s) => {
      await page.goto(s.url);
      await send(page, "start");
      await expect(chat(page).getByText("Started task")).toBeVisible();
      await expect(chat(page).locator("[data-slot=background-line]")).toBeVisible();
      await expect.soft(chat(page).locator("[data-slot=chat-state]"), "RUNNING").not.toHaveText("idle");
      await send(page, "list");
      await expect(chat(page).getByText("Done.")).toBeVisible();
      await expect(chat(page).locator("[data-slot=background-line]")).toHaveCount(0);
      const btn = chat(page).getByRole("button", { name: "merge it" });
      await expect(btn).toBeVisible();
      await btn.click();
      await expect(chat(page).locator("[data-role=user]", { hasText: "merge it" })).toBeVisible();
      await expect(chat(page).getByText("Merged it")).toBeVisible();
      await expect(btn).toHaveCount(0);
    },
  );
});
