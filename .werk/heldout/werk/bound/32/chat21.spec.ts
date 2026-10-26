import type { Page } from "@playwright/test";
import type { Script } from "../src/fake-agent/script.ts";
import { expect, test } from "../e2e/support/fixtures.ts";
import { type BrowserServer, startBrowserServer } from "../e2e/support/server.ts";

const say = (id: string, text: string, tokens?: number) => ({
  event: {
    type: "assistant",
    message: {
      id,
      content: [{ type: "text", text }],
      ...(tokens ? { usage: { input_tokens: tokens, output_tokens: 0 } } : {}),
    },
  },
});

async function withChat(
  script: Script,
  body: (server: BrowserServer) => Promise<void>,
) {
  const server = await startBrowserServer({ script });
  await server.start();
  try {
    await body(server);
  } finally {
    await server.dispose();
  }
}

const chat = (page: Page) =>
  page.getByRole("complementary", { name: "Chat pane" });

async function send(page: Page, text: string) {
  const composer = page.getByRole("textbox", { name: "Message" });
  await composer.fill(text);
  await composer.press("Enter");
}

const launchArgs = (server: BrowserServer) =>
  server.launches().flatMap((r) => (r.kind === "launch" ? [r.args] : []));
const messages = (server: BrowserServer) =>
  server.launches().flatMap((r) => (r.kind === "message" ? [r.text] : []));
const pie = (page: Page) =>
  chat(page).getByRole("button", { name: /^Context/ });
const NOT_DELIVERED = "Your message was not delivered. Send it again.";
const DEAD = "No conversation found with session ID: gone-1234";

test("21.1 model and context fill survive a server restart", async ({
  page,
}) => {
  await withChat(
    {
      roles: {
        chat: {
          replies: [
            [say("m1", "First answer", 60000)],
            [say("m2", "You asked: Hello there")],
          ],
        },
      },
    },
    async (server) => {
      await page.goto(server.url);
      await expect(chat(page).getByLabel("Model")).toBeVisible();
      await chat(page).getByLabel("Model").selectOption({ label: "Opus" });
      await send(page, "Hello there");
      await expect(chat(page).getByText("First answer")).toBeVisible();
      await expect(pie(page)).toHaveAttribute("aria-label", "Context 30% full");
      const before = await pie(page).getAttribute("aria-label");
      await server.stop();
      await server.start();
      await page.goto(server.url);
      await expect(chat(page).getByLabel("Model")).toHaveValue("opus");
      await expect(
        chat(page).getByLabel("Model").locator("option:checked"),
      ).toHaveText("Opus");
      await expect(pie(page)).toHaveAttribute("aria-label", before as string);
      await send(page, "What did I ask you before?");
      await expect(chat(page).getByText("You asked: Hello there")).toBeVisible();
      const last = launchArgs(server).at(-1) as string[];
      expect(last[last.indexOf("--resume") + 1]).toBe("fake-session-1");
      expect(last[last.indexOf("--model") + 1]).toBe("claude-opus-5-5");
      expect(messages(server).at(-1)).toMatch(/What did I ask you before\?$/);
    },
  );
});

test("21.2 a dead stored session starts again and delivers the waiting message", async ({
  page,
}) => {
  await withChat(
    {
      roles: {
        chat: {
          replies: [
            [say("m1", "Earlier answer")],
            [{ stderr: DEAD }, { crash: 1 }],
            [say("m3", "Answer in new session")],
          ],
        },
      },
    },
    async (server) => {
      await page.goto(server.url);
      await send(page, "Earlier");
      await expect(chat(page).getByText("Earlier answer")).toBeVisible();
      await server.stop();
      await server.start();
      await page.goto(server.url);
      await send(page, "New message");
      await expect(chat(page).getByText("Answer in new session")).toBeVisible();
      await expect(chat(page).getByText(NOT_DELIVERED)).toHaveCount(0);
      const args = launchArgs(server);
      expect(args.length).toBe(3);
      expect(args[1]).toContain("--resume");
      expect(args[2]).not.toContain("--resume");
      // The person sent the message once.
      expect(messages(server).filter((m) => m.endsWith("New message")).length)
        .toBe(2);
      await expect(
        chat(page).locator("article", { hasText: "New message" }),
      ).toHaveCount(1);
    },
  );
});

test("21.3 another crash retries once, shows the whole error, and the resend continues the session", async ({
  page,
}) => {
  const err = "boom line one\nboom line two\nboom line three";
  await withChat(
    {
      roles: {
        chat: {
          replies: [
            [say("m1", "Earlier answer")],
            [{ stderr: err }, { crash: 1 }],
            [{ stderr: err }, { crash: 1 }],
            [say("m4", "Answer again")],
          ],
        },
      },
    },
    async (server) => {
      await page.goto(server.url);
      await send(page, "Earlier");
      await expect(chat(page).getByText("Earlier answer")).toBeVisible();
      await send(page, "Second");
      await expect(chat(page).getByText(NOT_DELIVERED)).toBeVisible();
      for (const line of ["boom line one", "boom line two", "boom line three"])
        await expect(chat(page)).toContainText(line);
      // the first launch, and one more start before werk gives up
      expect(launchArgs(server).length).toBe(2);
      await send(page, "Second");
      await expect(chat(page).getByText("Answer again")).toBeVisible();
      const args = launchArgs(server);
      const last = args.at(-1) as string[];
      expect(last[last.indexOf("--resume") + 1]).toBe("fake-session-1");
    },
  );
});

test("21.4 a login problem shows at once with no retry", async ({ page }) => {
  const err = "Not logged in\nPlease run /login\nthen try again";
  await withChat(
    { roles: { chat: { replies: [[{ stderr: err }, { crash: 1 }], [say("m2", "x")]] } } },
    async (server) => {
      await page.goto(server.url);
      await send(page, "Hello");
      for (const line of ["Not logged in", "Please run /login", "then try again"])
        await expect(chat(page)).toContainText(line);
      expect(launchArgs(server).length).toBe(1);
      await expect(chat(page).getByText(NOT_DELIVERED)).toBeVisible();
    },
  );
});

test("21.5 model switch and clear context refuse during a turn and restart quietly when idle", async ({
  page,
}) => {
  await withChat(
    {
      roles: {
        chat: {
          replies: [
            [say("m1", "Working"), { pause: 5000 }, say("m2", "Finished")],
            [say("m3", "After clear")],
          ],
        },
      },
    },
    async (server) => {
      await page.goto(server.url);
      const model = chat(page).getByLabel("Model");
      await model.selectOption({ label: "Sonnet" });
      await expect(model.locator("option:checked")).toHaveText("Sonnet");
      await expect(pie(page)).toHaveAttribute("data-level", "blue");
      await send(page, "A long one");
      await expect(chat(page).getByText("Working")).toBeVisible();
      // A person cannot pick while the turn runs: the pick is refused.
      await model
        .selectOption({ label: "Opus" }, { timeout: 2000 })
        .catch(() => {});
      await expect(model.locator("option:checked")).toHaveText("Sonnet");
      await expect(chat(page).getByText("Finished")).toBeVisible({
        timeout: 15000,
      });
      // The option text in the step is "Sonnet with Opus advisor".
      await expect.soft(
        model.getByRole("option", { name: "Sonnet with Opus advisor" }),
      ).toHaveCount(1, { timeout: 2000 });
      await model.selectOption("sonnet+opus");
      await expect.soft(model.locator("option:checked")).toHaveText(
        "Sonnet with Opus advisor",
        { timeout: 2000 },
      );
      await expect(chat(page).getByText(/the agent exited/)).toHaveCount(0);
      await pie(page).click();
      const dialog = chat(page).getByRole("dialog");
      await expect(dialog).toContainText("% of the context window");
      await dialog.getByRole("button", { name: "Clear context" }).click();
      await expect(chat(page).getByText(/the agent exited/)).toHaveCount(0);
      await send(page, "Next");
      await expect(chat(page).getByText("After clear")).toBeVisible();
    },
  );
});
