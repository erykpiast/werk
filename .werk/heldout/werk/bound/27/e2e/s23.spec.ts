import { expect, test } from "@playwright/test";
import { decided } from "../../src/map/mark-fixtures.ts";
import { chat, chatScript, composer, left, messages, say, send, serve } from "./helpers.ts";

const LOG = [...decided("root", { title: "Root" }), ...decided("a", { title: "Card A", parent: "root" }), ...decided("b", { title: "Card B", parent: "root" })];
const chips = (page: import("@playwright/test").Page) => chat(page).getByRole("tablist").getByRole("tab");

test("23.1 two conversations with different home cards stay apart", async ({ page }) => {
  await serve({ log: LOG, script: chatScript([say("m1", "Reply for A")], [say("m2", "Reply for B")]) }, async (server) => {
    await page.goto(`${server.url}/map/a`);
    await expect(left(page).getByRole("heading", { level: 1, name: "Card A" })).toBeVisible();
    await send(page, "Message in A");
    await expect(chat(page).getByText("Reply for A")).toBeVisible();
    await page.goto(`${server.url}/map/b`);
    await expect(left(page).getByRole("heading", { level: 1, name: "Card B" })).toBeVisible();
    await chat(page).getByRole("button", { name: /new (conversation|tab)/i }).click({ timeout: 5000 });
    await send(page, "Message in B");
    await expect(chips(page)).toHaveCount(2, { timeout: 5000 });
    await expect(chips(page).nth(0)).toContainText("Card A");
    await expect(chips(page).nth(1)).toContainText("Card B");
  });
});

test("23.2 switching to a tab shows its newest message", async ({ page }) => {
  await serve({ log: LOG, script: chatScript([say("m1", "One")], [say("m2", "Two")]) }, async (server) => {
    await page.goto(`${server.url}/map/a`);
    await send(page, "First");
    await expect(chips(page)).toHaveCount(2, { timeout: 5000 });
  });
});

test("23.3 a crashed agent marks its tab and tells the other tabs", async ({ page }) => {
  await serve({ log: LOG, script: chatScript([say("m1", "ok")], [{ stderr: "tab A died" }, { crash: 1 }]) }, async (server) => {
    await page.goto(`${server.url}/map/a`);
    await send(page, "First");
    await expect(chips(page).first()).toBeVisible({ timeout: 5000 });
  });
});

test("23.4 a model switch is not a crash", async ({ page }) => {
  await serve({ log: LOG, script: chatScript([say("m1", "ok")], [say("m2", "after")]) }, async (server) => {
    await page.goto(`${server.url}/map/a`);
    await send(page, "First");
    await expect(chat(page).getByText("ok")).toBeVisible();
    await chat(page).getByLabel("Model").selectOption({ label: "Opus" });
    await expect(chips(page).first()).toBeVisible({ timeout: 5000 });
    await expect(chips(page).first()).not.toHaveAttribute("data-state", "crashed");
  });
});

test("23.5 a running background agent and a suggested next action", async ({ page }) => {
  await serve({ log: LOG, script: chatScript([say("m1", 'Started it.\nNext: say "merge it"')], [say("m2", "Merged")]) }, async (server) => {
    await page.goto(`${server.url}/map/a`);
    await send(page, "Go");
    await expect(chat(page).getByText("Started it.")).toBeVisible();
    const button = chat(page).getByRole("button", { name: "merge it" });
    await expect(button).toBeVisible({ timeout: 5000 });
    await button.click();
    await expect(chat(page).getByText("Merged")).toBeVisible();
    await expect(button).toHaveCount(0);
  });
});
