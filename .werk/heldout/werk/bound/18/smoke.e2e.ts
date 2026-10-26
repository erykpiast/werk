import { expect, test } from "@playwright/test";
import { project, stop } from "../e2e/project.ts";
test.afterEach(stop);
test("smoke", async ({ page }) => {
  const w = await project();
  await page.goto(`${w.url}/map`);
  await expect(page.getByText("Root").first()).toBeVisible();
});
