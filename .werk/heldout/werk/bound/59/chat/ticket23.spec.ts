import { expect, type Page, test } from "@playwright/test";
import {
  addCards,
  chat,
  launched,
  messages,
  say,
  send,
  withChat,
} from "./helpers.ts";

const chips = (page: Page) => page.locator("[data-slot=tab-chip]");
const newTab = (page: Page) => page.locator("[data-slot=tab-new]");
const log = (page: Page) => page.locator("[data-slot=chat-log]");
const scroller = (page: Page) => page.locator("[data-slot=chat-scroll]");
const deadLines = (page: Page) => page.locator("[data-slot=dead-line]");

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
  await withChat(
    {
      roles: {
        chat: {
          replies: [
            [say("m1", "Reply for the first tab")],
            [say("m2", "Reply for the second tab")],
            [{ pause: 1500 }, { ask: question }, say("m3", "Question noted")],
          ],
        },
      },
    },
    async (server) => {
      addCards(server, [
        { id: "a", title: "Card A" },
        { id: "b", title: "Card B" },
      ]);
      await page.goto(`${server.url}/map/a`);
      await expect(
        page.getByRole("heading", { level: 1, name: "Card A" }),
      ).toBeVisible();
      await expect(chips(page)).toHaveCount(1);
      await page.goto(`${server.url}/map/b`);
      await expect(
        page.getByRole("heading", { level: 1, name: "Card B" }),
      ).toBeVisible();
      await newTab(page).click();
      await expect(chips(page)).toHaveCount(2);
      const [first, second] = [chips(page).nth(0), chips(page).nth(1)];

      await first.click();
      await send(page, "Message in tab A");
      await expect(chat(page).getByText("Reply for the first tab")).toBeVisible();
      await second.click();
      await send(page, "Message in tab B");
      await expect(chat(page).getByText("Reply for the second tab")).toBeVisible();

      // Two chips, labelled with the card titles.
      const labels = await chips(page).allInnerTexts();
      expect.soft(labels, "chip labels").toEqual(["Card A", "Card B"]);

      // Each tab shows only its own message and reply.
      await expect(log(page)).toContainText("Message in tab B");
      await expect(log(page)).not.toContainText("Message in tab A");
      await first.click();
      await expect(log(page)).toContainText("Message in tab A");
      await expect(log(page)).toContainText("Reply for the first tab");
      await expect(log(page)).not.toContainText("Message in tab B");
      await expect(log(page)).not.toContainText("Reply for the second tab");

      // The agent in tab A asks a question while the person looks at tab B.
      await send(page, "Ask me something");
      await second.click();
      await expect
        .soft(first, "chip A blinks yellow")
        .toHaveAttribute("data-blink", "yellow", { timeout: 5000 });
      await expect(page.locator("[data-slot=ask-bar]")).toHaveCount(0);
      await expect(chat(page).getByText("Which db?")).toHaveCount(0);
      await first.click();
      await expect(page.locator("[data-slot=ask-bar]")).toContainText("Which db?");
      await page.getByLabel(/B\. SQLite/).check();
      await page.getByRole("button", { name: "Submit answer" }).click();
      await expect(chat(page).getByText("Question noted")).toBeVisible();
    },
  );
});

test("23.2 switching to a tab shows its newest message", async ({ page }) => {
  const long = Array.from({ length: 60 }, (_, i) => `Paragraph ${i + 1}`).join(
    "\n\n",
  );
  await withChat(
    {
      roles: {
        chat: {
          replies: [
            [say("m1", long)],
            [{ pause: 1500 }, say("m2", "Newest reply of tab two")],
            [{ pause: 3000 }, say("m3", "Another reply of tab two")],
          ],
        },
      },
    },
    async (server) => {
      await page.goto(server.url);
      await newTab(page).click();
      await expect(chips(page)).toHaveCount(2);
      const [first, second] = [chips(page).nth(0), chips(page).nth(1)];
      await send(page, "Fill the log");
      await expect(chat(page).getByText("Paragraph 60")).toBeVisible();
      await expect(
        scroller(page).evaluate((n) => n.scrollHeight > n.clientHeight),
      ).resolves.toBe(true);

      // Looking at the first tab, the second tab's agent sends a new reply.
      await send(page, "Say something new");
      await first.click();
      await expect(log(page)).not.toContainText("Paragraph 60");
      await page.waitForTimeout(2500);
      await second.click();
      const atBottom = () =>
        scroller(page).evaluate(
          (n) => Math.abs(n.scrollHeight - n.clientHeight - n.scrollTop) < 3,
        );
      await expect(chat(page).getByText("Newest reply of tab two")).toBeVisible();
      await expect.poll(atBottom).toBe(true);
      await expect(
        chat(page).getByText("Newest reply of tab two"),
      ).toBeInViewport();

      // The person scrolls up, then the agent sends another reply.
      await send(page, "One more");
      await scroller(page).hover();
      await page.mouse.wheel(0, -100000);
      await expect
        .poll(() => scroller(page).evaluate((n) => n.scrollTop))
        .toBe(0);
      await expect(chat(page).getByText("Another reply of tab two")).toBeAttached({
        timeout: 10000,
      });
      expect(await scroller(page).evaluate((n) => n.scrollTop)).toBe(0);
    },
  );
});

test("23.3 a crashed agent marks its tab and tells the other tabs", async ({
  page,
}) => {
  const crash = [
    { pause: 1000 },
    { stderr: "boom: agent A failed\nsecond line of the error" },
    { crash: 1 },
  ];
  await withChat(
    {
      roles: {
        chat: { replies: [crash, crash, [say("m3", "Agent A is back")]] },
      },
    },
    async (server) => {
      await page.goto(server.url);
      await newTab(page).click();
      await expect(chips(page)).toHaveCount(2);
      const [a, b] = [chips(page).nth(0), chips(page).nth(1)];
      await a.click();
      await send(page, "hello");
      await b.click();
      await expect(a).toHaveAttribute("data-blink", "red", { timeout: 15000 });
      await expect(deadLines(page)).toHaveCount(1);
      const line = await deadLines(page).innerText();
      expect(line).toContain("boom: agent A failed");
      expect(line).toContain(await a.innerText());

      await a.click();
      await expect(page.locator("[data-slot=dead-error]")).toContainText(
        "boom: agent A failed",
      );
      await expect(page.locator("[data-slot=dead-error]")).toContainText(
        "second line of the error",
      );
      await send(page, "try again");
      await expect(chat(page).getByText("Agent A is back")).toBeVisible();
      await expect(a).not.toHaveAttribute("data-blink", "red");
      await b.click();
      await expect(deadLines(page)).toHaveCount(0);
    },
  );
});

test("23.4 a model switch is not a crash", async ({ page }) => {
  await withChat(
    {
      roles: {
        chat: { replies: [[say("m1", "First reply")], [say("m2", "Second reply")]] },
      },
    },
    async (server) => {
      await page.goto(server.url);
      await newTab(page).click();
      await expect(chips(page)).toHaveCount(2);
      const [a, b] = [chips(page).nth(0), chips(page).nth(1)];
      await a.click();
      await send(page, "Hello");
      await expect(chat(page).getByText("First reply")).toBeVisible();
      await chat(page).getByLabel("Model").selectOption({ label: "Opus" });
      await expect.poll(() => launched(server).length).toBe(2);
      await page.waitForTimeout(1500);
      await expect(a).not.toHaveAttribute("data-blink", "red");
      await b.click();
      await expect(deadLines(page)).toHaveCount(0);
      await a.click();
      await send(page, "And again");
      await expect(chat(page).getByText("Second reply")).toBeVisible();
      await expect(a).not.toHaveAttribute("data-blink", "red");
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
  const ended = { event: { type: "result", duration_ms: 100, total_cost_usd: 0 } };
  await withChat(
    {
      roles: {
        chat: {
          replies: [
            [list(["t1"]), say("m1", "Started one task"), ended, { pause: 4000 }, list([])],
            [say("m2", 'Merge is ready.\n\nNext: say "merge it"')],
            [say("m3", "Merged now")],
          ],
        },
      },
    },
    async (server) => {
      await page.goto(server.url);
      await send(page, "Start a task");
      const line = chat(page).getByText("A background agent runs");
      await expect(line).toBeVisible();
      await expect(chat(page).getByText("Started one task")).toBeVisible();
      // The turn has ended, but the tab counts as running: the project list says so.
      await expect(page.locator("[data-slot=chat-head]")).not.toHaveAttribute(
        "data-busy",
        "true",
      );
      const listed = async () =>
        (
          (await (await page.request.get(`${server.origin}/api/projects`)).json()) as {
            projects: { name: string; background: number; running: string[] }[];
          }
        ).projects.find((p) => p.name === "project");
      await expect.poll(async () => (await listed())?.background).toBe(1);
      await expect(line).toHaveCount(0, { timeout: 10000 });
      await expect.poll(async () => (await listed())?.background).toBe(0);

      await send(page, "Is it ready?");
      const offer = chat(page).getByRole("button", { name: "merge it" });
      await expect(offer).toBeVisible();
      await offer.click();
      await expect(log(page).locator("[data-role=user]", { hasText: /^merge it$/ })).toBeVisible();
      await expect(chat(page).getByText("Merged now")).toBeVisible();
      await expect(offer).toHaveCount(0);
      expect(messages(server)[2]).toMatch(/merge it$/);
    },
  );
});
