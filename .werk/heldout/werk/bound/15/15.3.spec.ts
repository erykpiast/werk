import { expect, test } from "@playwright/test";
import { startWerk } from "./werk-app";

const LONG = `${"x".repeat(400)} #al-diff`;
const BODY = [
  "```zsh", "echo $HOME | grep -v x", "```",
  "```TypeScript", "const n: number = 1", "```",
  "```cobol", "DISPLAY 'HELLO'.", "```",
  "```", LONG, "```",
].join("\n");

test("15.3 fenced code is boxed, labelled and highlighted", async ({ page }) => {
  const app = await startWerk([{ id: "al-diff" }, { id: "code-sample", body: BODY }]);
  try {
    await page.setViewportSize({ width: 800, height: 900 });
    await page.goto(`${app.url}/map/code-sample`);
    const boxes = page.locator(".codebox");
    await expect(boxes).toHaveCount(4);
    await expect(boxes.nth(0).locator(".codebox-tag")).toHaveText("zsh");
    await expect(boxes.nth(0).locator("[class^=tok-]")).not.toHaveCount(0);
    const color = (sel: string, text: string) =>
      boxes.nth(1).locator(sel, { hasText: text }).first().evaluate((el) => getComputedStyle(el).color);
    expect(await color("span", "const")).not.toBe(await boxes.nth(1).locator("code").evaluate((el) => getComputedStyle(el).color));
    await expect(boxes.nth(2).locator(".codebox-tag")).toHaveText("cobol");
    await expect(boxes.nth(2).locator("code span")).toHaveCount(0);
    const pre = boxes.nth(3).locator("pre");
    expect(await pre.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(boxes.locator("a")).toHaveCount(0);
  } finally {
    app.stop();
  }
});
