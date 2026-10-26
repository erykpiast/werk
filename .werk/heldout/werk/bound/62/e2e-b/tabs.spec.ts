import {
  chat,
  composerOf,
  expect,
  launched,
  leftPane,
  messages,
  say,
  send,
  test,
  withChat,
} from "./common.ts";

const addCards = (server: { werk: (...a: string[]) => { code: number } }) => {
  for (const [id, title] of [
    ["alpha", "Card A"],
    ["beta", "Card B"],
  ] as const) {
    expect(server.werk("add", id, "--title", title, "--parent", "root").code).toBe(0);
    expect(server.werk("accept", id, "--actor", "you").code).toBe(0);
  }
};

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

test("23.1 two conversations with different home cards stay apart", async ({ page }) => {
  await withChat(
    {
      roles: {
        chat: {
          replies: [
            [say("a1", "Answer for A"), { pause: 7000 }, { ask: question }, say("a2", "Noted")],
            [say("b1", "Answer for B")],
          ],
        },
      },
    },
    async (server) => {
      await page.goto(server.url);
      await leftPane(page).locator("a.tile", { hasText: "Card A" }).click();
      await expect(leftPane(page).getByRole("heading", { level: 1, name: "Card A" })).toBeVisible();
      await send(page, "Message A");
      await expect(chat(page).getByText("Answer for A")).toBeVisible();
      await page.goBack();
      await leftPane(page).locator("a.tile", { hasText: "Card B" }).click();
      await expect(leftPane(page).getByRole("heading", { level: 1, name: "Card B" })).toBeVisible();
      await page.locator("[data-slot=tab-new]").click();
      await send(page, "Message B");
      await expect(chat(page).getByText("Answer for B")).toBeVisible();

      const chips = page.locator("[data-slot=tab-chip]");
      await expect(chips).toHaveCount(2);
      // Observed: the chips carry the tab names, not the card titles.
      expect.soft(await chips.allTextContents(), "chip labels are the titles of card A and card B").toEqual(["Card A", "Card B"]);
      // Tab B is shown.
      await expect(chat(page)).toContainText("Message B");
      await expect(chat(page)).not.toContainText("Message A");
      await expect(chat(page)).not.toContainText("Answer for A");
      // The ask of tab A arrives while tab B is shown.
      await expect
        .soft(chips.nth(0), "chip A blinks yellow on an ask")
        .toHaveAttribute("data-blink", "yellow", { timeout: 20000 });
      await expect(chat(page)).not.toContainText("Which db?");
      await chips.nth(0).click();
      await expect(chat(page)).toContainText("Message A");
      await expect(chat(page)).not.toContainText("Message B");
      await expect(chat(page)).not.toContainText("Answer for B");
      const bar = page.locator('[data-slot="ask-bar"]');
      await expect(bar).toContainText("Which db?", { timeout: 20000 });
      await bar.getByLabel(/B\. SQLite/).check();
      await bar.getByRole("button", { name: "Submit answer" }).click();
      await expect(chat(page).getByText("Noted")).toBeVisible();
    },
    addCards,
  );
});

const longReply = (prefix: string) =>
  Array.from({ length: 40 }, (_, i) =>
    say(`${prefix}${i}`, `${prefix} paragraph ${i}. ${"filler words ".repeat(20)}`),
  );

test("23.2 switching to a tab shows its newest message", async ({ page }) => {
  await withChat(
    {
      roles: {
        chat: {
          replies: [
            [say("m0", "First tab says hi")],
            longReply("long"),
            [{ pause: 800 }, say("n1", "NEWEST reply")],
            [{ pause: 3000 }, say("n2", "ANOTHER reply")],
          ],
        },
      },
    },
    async (server) => {
      await page.goto(server.url);
      const chips = page.locator("[data-slot=tab-chip]");
      await send(page, "hello first");
      await expect(chat(page).getByText("First tab says hi")).toBeVisible();
      await page.locator("[data-slot=tab-new]").click();
      await send(page, "make it long");
      await expect(chat(page).getByText("long paragraph 39.")).toBeVisible();
      const scroll = page.locator("[data-slot=chat-scroll]");
      expect(await scroll.evaluate((n) => n.scrollHeight > n.clientHeight + 200)).toBe(true);
      // Second tab: ask for a new reply, then look at the first tab while it arrives.
      await send(page, "one more");
      await chips.nth(0).click();
      await expect(chat(page)).toContainText("First tab says hi");
      await expect.poll(() => messages(server).length).toBe(3);
      // The agent replies 800 ms after the message; a person waits that long.
      await page.waitForTimeout(2500);
      await chips.nth(1).click();
      await expect(chat(page).getByText("NEWEST reply")).toBeVisible();
      const atBottom = () =>
        scroll.evaluate((n) => n.scrollHeight - n.clientHeight - n.scrollTop < 3);
      await expect.poll(atBottom).toBe(true);
      // Scroll up, then the agent sends another reply.
      await send(page, "and again");
      await scroll.hover();
      await page.mouse.wheel(0, -100000);
      await expect.poll(() => scroll.evaluate((n) => n.scrollTop)).toBe(0);
      await expect(chat(page).getByText("ANOTHER reply")).toBeAttached({ timeout: 15000 });
      expect(await scroll.evaluate((n) => n.scrollTop), "the log stays where the person scrolled it").toBeLessThan(50);
    },
  );
});

test("23.3 a crashed agent marks its tab and tells the other tabs", async ({ page }) => {
  const crash = [{ stderr: "boom: agent failed\nsecond line of the error" }, { crash: 1 }];
  await withChat(
    { roles: { chat: { replies: [crash, crash, [say("m1", "I am back")]] } } },
    async (server) => {
      await page.goto(server.url);
      const chips = page.locator("[data-slot=tab-chip]");
      await page.locator("[data-slot=tab-new]").click();
      await expect(chips).toHaveCount(2);
      const [a, b] = [chips.nth(1), chips.nth(0)];
      await send(page, "hello");
      await b.click();
      await expect(a).toHaveAttribute("data-blink", "red");
      const lines = page.locator("[data-slot=dead-line]");
      await expect(lines).toHaveCount(1);
      await expect(lines).toContainText("2");
      await expect(lines).toContainText("boom: agent failed");
      await a.click();
      await expect(page.locator("[data-slot=dead-error]")).toContainText("second line of the error");
      await expect(page.locator("[data-slot=dead-error]")).toContainText("boom: agent failed");
      await send(page, "try again");
      await expect(chat(page).getByText("I am back")).toBeVisible();
      await expect(a).not.toHaveAttribute("data-blink", "red");
      await b.click();
      await expect(lines).toHaveCount(0);
      expect(launched(server).length).toBeGreaterThanOrEqual(2);
    },
  );
});

test("23.4 a model switch is not a crash", async ({ page }) => {
  await withChat(
    { roles: { chat: { replies: [[say("m1", "First answer")], [say("m2", "Second answer")]] } } },
    async (server) => {
      await page.goto(server.url);
      const chips = page.locator("[data-slot=tab-chip]");
      await send(page, "Hello");
      await expect(chat(page).getByText("First answer")).toBeVisible();
      await page.locator("[data-slot=tab-new]").click();
      await expect(chips).toHaveCount(2);
      await chips.nth(0).click();
      // Record every moment that a chip or a line shows a dead agent.
      await page.evaluate(() => {
        const w = window as unknown as { sawDead: number };
        w.sawDead = 0;
        const check = () => {
          if (document.querySelector("[data-blink=red],[data-slot=dead-line],[data-slot=dead-error]")) w.sawDead++;
        };
        new MutationObserver(check).observe(document.body, { subtree: true, childList: true, attributes: true });
      });
      await chat(page).getByLabel("Model").selectOption("opus");
      await expect.poll(() => launched(server).length).toBe(2);
      await chips.nth(1).click();
      await expect(page.locator("[data-slot=dead-line]")).toHaveCount(0);
      await chips.nth(0).click();
      await send(page, "Next one");
      await expect(chat(page).getByText("Second answer")).toBeVisible();
      await expect(chips.nth(0)).not.toHaveAttribute("data-blink", "red");
      await expect(chips.nth(1)).not.toHaveAttribute("data-blink", "red");
      expect(await page.evaluate(() => (window as unknown as { sawDead: number }).sawDead)).toBe(0);
      void composerOf;
    },
  );
});

test("23.5 a background agent line and a suggested next action", async ({ page }) => {
  const list = (ids: string[]) => ({
    event: { type: "system", subtype: "background_tasks", tasks: ids.map((id) => ({ id })) },
  });
  await withChat(
    {
      roles: {
        chat: {
          replies: [
            [
              list(["a"]),
              say("m1", "Started one task"),
              { event: { type: "result", duration_ms: 100, total_cost_usd: 0 } },
              { pause: 4000 },
              list([]),
            ],
            [say("m2", 'Done.\n\nNext: say "merge it"')],
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
      await expect(chat(page).getByText("Started one task")).toBeVisible();
      // The turn has ended; the line stays while the task runs.
      await expect(page.locator('[data-slot="chat-head"]')).not.toHaveAttribute("data-busy", "true");
      await expect(line).toBeVisible();
      await expect(line).toHaveCount(0, { timeout: 15000 });
      await send(page, "Anything else?");
      const offer = chat(page).getByRole("button", { name: "merge it" });
      await expect(offer).toBeVisible();
      await offer.click();
      await expect(chat(page).locator("[data-role=user]", { hasText: "merge it" })).toBeVisible();
      await expect(chat(page).getByText("Merged")).toBeVisible();
      await expect(offer).toHaveCount(0);
      expect(messages(server)[2]).toMatch(/merge it$/);
    },
  );
});
