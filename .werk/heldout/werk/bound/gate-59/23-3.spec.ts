import type { Page } from "@playwright/test";
import { expect, test } from "../e2e/support/fixtures.ts";
import { startBrowserServer } from "../e2e/support/server.ts";

const say = (id: string, text: string) => ({
  event: {
    type: "assistant",
    message: { id, content: [{ type: "text", text }] },
  },
});

async function send(page: Page, text: string) {
  const composer = page.getByRole("textbox", { name: "Message" });
  await composer.fill(text);
  await composer.press("Enter");
}

test("23.3 a crashed agent marks its tab and tells the other tabs", async ({
  page,
}) => {
  const crash = [{ stderr: "boom: agent failed" }, { crash: 1 }];
  const server = await startBrowserServer({
    script: { roles: { chat: { replies: [crash, crash, [say("m1", "I am back")]] } } },
  });
  await server.start();
  try {
    await page.goto(server.url);
    const chips = page.locator("[data-slot=tab-chip]");
    const pane = page.getByRole("complementary", { name: "Chat pane" });
    // Given two conversations in tabs "A" and "B"
    await page.locator("[data-slot=tab-new]").click();
    await expect(chips).toHaveCount(2);
    const tabA = chips.nth(1);
    const tabB = chips.nth(0);
    const nameA = (await tabA.innerText()).trim();
    // The new tab A is shown; its agent exits with code 1 while the person looks at B.
    await send(page, "hello");
    await tabB.click();
    await expect(tabB).toHaveAttribute("data-current", "true");
    // Then the "A" chip blinks red
    await expect(tabA).toHaveAttribute("data-blink", "red");
    // And the pane of B shows one line naming A and its error
    const lines = pane.locator("[data-slot=dead-line]");
    await expect(lines).toHaveCount(1);
    await expect(lines).toContainText(nameA);
    await expect(lines).toContainText("boom: agent failed");
    // When the person switches to A, the pane shows the whole error
    await tabA.click();
    await expect(pane.locator("[data-slot=dead-error]")).toContainText(
      "boom: agent failed",
    );
    // When the person sends a new message in A, a new agent replies
    await send(page, "try again");
    await expect(pane.getByText("I am back")).toBeVisible();
    await expect(tabA).not.toHaveAttribute("data-blink", "red");
    await tabB.click();
    await expect(page.locator("[data-slot=dead-line]")).toHaveCount(0);
  } finally {
    await server.dispose();
  }
});
