import { expect, test } from "@playwright/test";
import { startWerk } from "./werk-app";

const BODY = [
  "# al-diff",
  "--al-diff",
  "##al-diff",
  "&al-diff",
  "a code span holding `node src/cli.ts show #al-diff`",
  "see #no-such-card",
  "visit https://example.com/page#al-diff",
  "",
  "Also #al-diff here.",
].join("\n");

test("15.2 text that only looks like a reference stays text", async ({ page }) => {
  const app = await startWerk([{ id: "al-diff" }, { id: "guards", body: BODY }]);
  try {
    await page.goto(`${app.url}/map/guards`);
    const body = page.locator(".card-body, [data-card-body]").first();
    for (const text of ["--al-diff", "##al-diff", "&al-diff"]) await expect(body).toContainText(text);
    const code = body.locator("code", { hasText: "node src/cli.ts show #al-diff" });
    await expect(code).toBeVisible();
    await expect(code.locator("a")).toHaveCount(0);
    await expect(body).toContainText("#no-such-card");
    await expect(body.locator('a[href*="no-such-card"]')).toHaveCount(0);
    await expect(body.locator("h1", { hasText: "al-diff" })).toBeVisible();
    await expect(body.locator("h1 a")).toHaveCount(0);
    await expect(body.locator('a[href="/map/al-diff"]')).toHaveCount(1);
  } finally {
    app.stop();
  }
});
