import { expect, type Page, test } from "@playwright/test";
import { open } from "../src/map/mark-fixtures.ts";
import { served } from "./server.ts";

const composer = (page: Page) => page.getByRole("textbox", { name: "Message" });

test("24.1 pick a card from the hash menu", async ({ page }) => {
  const s = await served();
  try {
    s.append(...open("werk-shots", { title: "Pasted screenshots", parent: "root" }));
    await page.goto(s.url);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await composer(page).click();
    await composer(page).pressSequentially("Look at #wer");
    const menu = page.getByRole("listbox");
    await expect(menu).toBeVisible();
    const item = menu.getByRole("option", { name: /werk-shots/ });
    await expect(item).toContainText("Pasted screenshots");
    await composer(page).press("ArrowDown");
    await composer(page).press("Enter");
    await expect(composer(page)).toHaveValue(/Look at #werk-shots/);
    await expect(menu).toBeHidden();
    await composer(page).fill("");
    await composer(page).pressSequentially("`#wer");
    await expect(page.getByRole("listbox")).toHaveCount(0);
  } finally {
    await s.dispose();
  }
});
