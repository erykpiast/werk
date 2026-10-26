import { expect, test } from "@playwright/test";
import { startWerk } from "./werk-app";

test("15.5 references link in chat but not in a tile", async ({ page }) => {
  const app = await startWerk([
    { id: "al-diff" },
    { id: "old-idea", removed: true },
    { id: "tile-card", summary: "Depends on #al-diff" },
  ]);
  try {
    await page.goto(`${app.url}/map`);
    const input = page.getByRole("textbox", { name: /message|chat/i });
    await input.fill("Compare #al-diff with #old-idea and show code");
    await input.press("Enter");
    const mine = page.locator("[data-role=user], .message-user").last();
    await expect(mine.locator('a[href="/map/al-diff"]')).toHaveText("#al-diff");
    await expect(mine).toContainText("#old-idea");
    await expect(mine.locator('a[href*="old-idea"]')).toHaveCount(0);
    const reply = page.locator("[data-role=assistant], .message-assistant").last();
    await expect(reply.locator(".codebox .codebox-tag")).toHaveText("json");
    await expect(reply.locator('.codebox code[data-grammar="json"] .tok-key')).not.toHaveCount(0);
    const tile = page.locator('[data-tile="tile-card"], [data-card-id="tile-card"]').first();
    await expect(tile).toContainText("Depends on #al-diff");
    await expect(tile.locator("a")).toHaveCount(0);
    await tile.click();
    await expect(page).toHaveURL(/\/map\/tile-card$/);
  } finally {
    app.stop();
  }
});
