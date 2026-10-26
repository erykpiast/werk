import { expect, test } from "@playwright/test";
import { startWerk } from "./werk-app";

test("15.1 every reference form becomes the same link", async ({ page }) => {
  const app = await startWerk([
    { id: "al-diff" },
    { id: "align" },
    { id: "notes-test", body: "See #al-diff, then al-diff, then `al-diff`, then `#al-diff`, and #align too." },
  ]);
  try {
    await page.goto(`${app.url}/map/notes-test`);
    const body = page.locator(".card-body, [data-card-body]").first();
    const alDiff = body.getByRole("link", { name: "#al-diff", exact: true });
    await expect(alDiff).toHaveCount(4);
    for (const link of await alDiff.all()) {
      const font = await link.evaluate((el) => getComputedStyle(el.querySelector("code") ?? el).fontFamily);
      expect(font).toMatch(/mono|Menlo|Consolas|SFMono/i);
    }
    await expect(body.getByRole("link", { name: "#align", exact: true })).toHaveCount(1);
    await expect(body.getByRole("link", { name: /^(then|and)$/ })).toHaveCount(0);
    await alDiff.nth(1).click();
    await expect(page).toHaveURL(/\/map\/al-diff$/);
    await expect(page.locator('[data-card-id="al-diff"], [data-open-card="al-diff"]').first()).toBeVisible();
  } finally {
    app.stop();
  }
});
