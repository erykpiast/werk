import { expect, test } from "@playwright/test";
import { startWerk } from "./werk-app";

test("15.4 a script tag shows as text and runs nothing", async ({ page }) => {
  const app = await startWerk([
    { id: "unsafe", body: "Hello <script>window.__pwned = true</script> **bold** and ~~gone~~" },
  ]);
  try {
    await page.goto(`${app.url}/map/unsafe`);
    const body = page.locator(".card-body, [data-card-body]").first();
    await expect(body).toContainText("<script>window.__pwned = true</script>");
    expect(await page.evaluate(() => (window as { __pwned?: boolean }).__pwned)).toBeUndefined();
    await expect(body.locator("strong", { hasText: "bold" })).toBeVisible();
    await expect(body.locator("del, s", { hasText: "gone" })).toBeVisible();
  } finally {
    app.stop();
  }
});
