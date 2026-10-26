import type { Page } from "@playwright/test";
import { chat, composerOf, expect, launchArgs, say, send, withServer } from "./chatkit.ts";
import { test } from "./fixtures.ts";

const chips = (page: Page) => page.locator("[data-slot=tab-chip]");
const newTab = (page: Page) => page.locator("[data-slot=tab-new]").click();

const question = {
  id: "q1",
  tool: "AskUserQuestion",
  input: { questions: [{ question: "Which colour?", header: "C", multiSelect: false, options: [{ label: "Red", description: "r" }, { label: "Blue", description: "b" }] }] },
};

test("23.1 two conversations with different home cards stay apart", async ({ page }) => {
  await withServer({ roles: { chat: { replies: [[say("a1", "Reply for A"), { pause: 3000 }, { ask: question }, say("a2", "A done")], [say("b1", "Reply for B")]] } } }, async (server) => {
    expect(server.werk("add", "card-a", "--title", "Alpha card", "--parent", "root").code).toBe(0);
    expect(server.werk("accept", "card-a", "--actor", "you").code).toBe(0);
    expect(server.werk("add", "card-b", "--title", "Beta card", "--parent", "root").code).toBe(0);
    expect(server.werk("accept", "card-b", "--actor", "you").code).toBe(0);
    await page.goto(`${server.url}/map/card-a`);
    await expect(page.getByRole("heading", { level: 1, name: "Alpha card" })).toBeVisible();
    await send(page, "Message in A");
    await expect(chat(page).getByText("Reply for A")).toBeVisible();
    await page.goto(`${server.url}/map/card-b`);
    await expect(page.getByRole("heading", { level: 1, name: "Beta card" })).toBeVisible();
    await newTab(page);
    await send(page, "Message in B");
    await expect(chat(page).getByText("Reply for B")).toBeVisible();
    await expect(chips(page)).toHaveCount(2);
    const labels = await chips(page).allInnerTexts();
    expect(labels.join("|")).toContain("Alpha card");
    expect(labels.join("|")).toContain("Beta card");
    const log = chat(page).locator("[data-slot=chat-log]");
    await expect(log).toContainText("Message in B");
    await expect(log).not.toContainText("Message in A");
    // The agent of the first tab asks while the second tab is shown.
    const first = chips(page).first();
    await expect(first).toHaveAttribute("data-blink", "yellow", { timeout: 15000 });
    await expect(page.locator('[data-slot="ask-bar"]')).toHaveCount(0);
    await first.click();
    await expect(page.locator('[data-slot="ask-bar"]')).toContainText("Which colour?");
  });
});

test("23.2 switching to a tab shows its newest message", async ({ page }) => {
  const long = Array.from({ length: 40 }, (_, i) => say(`l${i}`, `Line number ${i} of a long reply`));
  await withServer({ roles: { chat: { replies: [[say("a1", "First tab reply")], [...long, say("z", "Newest reply in two")], [say("n", "Another reply while scrolled")]] } } }, async (server) => {
    await page.goto(server.url);
    await send(page, "In one");
    await expect(chat(page).getByText("First tab reply")).toBeVisible();
    await newTab(page);
    await send(page, "In two");
    await expect(chat(page).getByText("Newest reply in two")).toBeVisible();
    await chips(page).first().click();
    await expect(chat(page).getByText("First tab reply")).toBeVisible();
    await chips(page).nth(1).click();
    const scroller = chat(page).locator("[data-slot=chat-scroll]");
    await expect(chat(page).getByText("Newest reply in two")).toBeVisible();
    const atBottom = () => scroller.evaluate((el) => Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop) < 4);
    expect(await atBottom()).toBe(true);
    await scroller.evaluate((el) => {
      el.scrollTop = 0;
    });
    await send(page, "Again in two");
    await expect(chat(page).getByText("Another reply while scrolled")).toBeAttached();
    await page.waitForTimeout(500);
    expect(await scroller.evaluate((el) => el.scrollTop)).toBeLessThan(50);
  });
});

test("23.3 a crashed agent marks its tab and tells the other tabs", async ({ page }) => {
  const crash = [{ stderr: "boom: agent failed\nsecond line of the error" }, { crash: 1 }];
  await withServer({ roles: { chat: { replies: [crash, crash, [say("m1", "I am back")]] } } }, async (server) => {
    await page.goto(server.url);
    await newTab(page);
    await expect(chips(page)).toHaveCount(2);
    const a = chips(page).nth(1);
    const b = chips(page).nth(0);
    await send(page, "hello");
    await b.click();
    await expect(a).toHaveAttribute("data-blink", "red");
    const line = page.locator("[data-slot=dead-line]");
    await expect(line).toHaveCount(1);
    await expect(line).toContainText("boom: agent failed");
    await a.click();
    await expect(page.locator("[data-slot=dead-error]")).toContainText("second line of the error");
    await send(page, "try again");
    await expect(chat(page).getByText("I am back")).toBeVisible();
    await expect(a).not.toHaveAttribute("data-blink", "red");
    await b.click();
    await expect(page.locator("[data-slot=dead-line]")).toHaveCount(0);
  });
});

test("23.4 a model switch is not a crash", async ({ page }) => {
  await withServer({ roles: { chat: { replies: [[say("m1", "First")], [say("m2", "Second")]] } } }, async (server) => {
    await page.goto(server.url);
    await newTab(page);
    await send(page, "hello");
    await expect(chat(page).getByText("First")).toBeVisible();
    await chat(page).getByLabel("Model").selectOption("opus");
    await expect.poll(() => launchArgs(server).length).toBe(2);
    await page.waitForTimeout(800);
    for (const chip of await chips(page).all()) await expect(chip).not.toHaveAttribute("data-blink", "red");
    await chips(page).first().click();
    await expect(page.locator("[data-slot=dead-line]")).toHaveCount(0);
    await chips(page).nth(1).click();
    await send(page, "again");
    await expect(chat(page).getByText("Second")).toBeVisible();
  });
});

test("23.5 a running background agent and a suggested next action", async ({ page }) => {
  const list = (ids: string[]) => ({ event: { type: "system", subtype: "background_tasks", tasks: ids.map((id) => ({ id })) } });
  await withServer({ roles: { chat: { replies: [[list(["t1"]), say("m1", "Started")], [list([]), say("m2", 'Done.\n\nNext: say "merge it"')], [say("m3", "Merged")]] } } }, async (server) => {
    await page.goto(server.url);
    await send(page, "Go");
    const line = chat(page).getByText("A background agent runs");
    await expect(line).toBeVisible();
    await expect(chat(page).getByText("Started")).toBeVisible();
    await expect(chat(page).locator("[data-slot=chat-head]")).not.toHaveAttribute("data-busy", "true");
    await send(page, "Status?");
    await expect(line).toHaveCount(0, { timeout: 10000 });
    const offer = chat(page).getByRole("button", { name: "merge it" });
    await expect(offer).toBeVisible();
    await offer.click();
    await expect(chat(page).locator("[data-role=user]", { hasText: "merge it" })).toBeVisible();
    await expect(chat(page).getByText("Merged")).toBeVisible();
    await expect(offer).toHaveCount(0);
  });
});
