import { expect, test } from "../e2e/support/fixtures.ts";
import { startBrowserServer } from "../e2e/support/server.ts";

const LOGIN = [
  "Invalid credential.",
  "Remove the credential and run: claude auth login",
];

test("21.4 a login problem shows its error at once with no retry", async ({
  page,
}) => {
  const server = await startBrowserServer({
    script: {
      roles: {
        chat: {
          replies: [
            [{ stderr: LOGIN.join("\n") }, { crash: 1 }],
            [{ stderr: "second start" }, { crash: 1 }],
          ],
        },
      },
    },
  });
  await server.start();
  try {
    await page.goto(server.url);
    const composer = page.getByRole("textbox", { name: "Message" });
    await composer.fill("hello");
    await composer.press("Enter");
    const pane = page.getByRole("complementary", { name: "Chat pane" });
    for (const line of LOGIN) await expect(pane).toContainText(line);
    await expect(pane).toContainText(
      "Your message was not delivered. Send it again.",
    );
    const starts = server.launches().filter((r) => r.kind !== "message");
    expect(starts).toHaveLength(1);
  } finally {
    await server.dispose();
  }
});
