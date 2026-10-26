import type { Page } from "@playwright/test";
import { expect, test } from "../e2e/support/fixtures.ts";
import { startBrowserServer } from "../e2e/support/server.ts";

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

test("25.1 a pasted screenshot becomes a numbered image the agent reads by path", async ({
  page,
}: {
  page: Page;
}) => {
  const server = await startBrowserServer({
    script: {
      roles: {
        chat: {
          replies: [
            [
              {
                event: {
                  type: "assistant",
                  message: {
                    id: "m1",
                    content: [{ type: "text", text: "Seen" }],
                  },
                },
              },
            ],
          ],
        },
      },
    },
  });
  await server.start();
  try {
    // Hold the upload answer so the spinner can be seen.
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    await page.route("**/api/**/image", async (route) => {
      if (route.request().method() === "POST") await gate;
      await route.continue();
    });
    await page.goto(server.url);
    const composer = page.getByRole("textbox", { name: "Message" });
    await composer.focus();
    await page.evaluate((base64) => {
      const png = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([png], "shot.png", { type: "image/png" }));
      document.querySelector("textarea")?.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: transfer,
          bubbles: true,
          cancelable: true,
        }),
      );
    }, PNG_BASE64);

    const chips = page.getByRole("list", { name: "Attached images" });
    await expect(
      chips.getByRole("status", { name: "Uploading" }),
    ).toBeVisible();
    await expect(composer).toHaveValue("[Image #1]");
    release();

    const thumb = chips.getByRole("img");
    await expect(thumb).toBeVisible();
    await expect
      .poll(() => thumb.evaluate((i: HTMLImageElement) => i.naturalWidth))
      .toBeGreaterThan(0);
    await expect(chips).toContainText("[Image #1]");

    await composer.pressSequentially(" Why is this red?");
    await composer.press("Enter");
    const chat = page.getByRole("complementary", { name: "Chat pane" });
    await expect(chat.getByText("Seen")).toBeVisible();
    await expect(
      chat.locator('[data-role="user"] img[alt="[Image #1]"]'),
    ).toBeVisible();

    const [text] = server
      .launches()
      .flatMap((r) => (r.kind === "message" ? [r.text] : []));
    expect(text).toMatch(/\[Image #1\] = .*\.werk\/attachments\/.+\.png/);
    expect(text).toContain("Open each image above with Read");
    expect(text).toContain("Why is this red?");
    expect(text).not.toContain(PNG_BASE64);
  } finally {
    await server.dispose();
  }
});
