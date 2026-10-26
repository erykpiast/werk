import { expect, test } from "@playwright/test";
import {
  chat,
  composerOf,
  launched,
  messages,
  say,
  send,
  withChat,
} from "./chat-support.ts";

const usage = (id: string, text: string, tokens: number) => ({
  event: {
    type: "assistant",
    message: {
      id,
      content: [{ type: "text", text }],
      usage: { input_tokens: tokens, output_tokens: 0 },
    },
  },
});
const pie = (page: import("@playwright/test").Page) =>
  chat(page).locator("[data-slot=context-pie]");
const model = (page: import("@playwright/test").Page) => chat(page).getByLabel("Model");

test("21.1 a conversation keeps its model and context fill across a server restart", async ({ page }) => {
  await withChat(
    {
      roles: {
        chat: {
          replies: [
            [usage("m1", "First answer", 90000)],
            [say("m2", "You asked: Hello")],
          ],
        },
      },
    },
    async (server) => {
      await page.goto(server.url);
      await expect(model(page)).toBeVisible();
      await model(page).selectOption({ label: "Opus" });
      await send(page, "Hello");
      await expect(chat(page).getByText("First answer")).toBeVisible();
      await expect(pie(page)).not.toHaveAttribute("aria-label", "Context 0% full");
      const before = await pie(page).getAttribute("aria-label");
      await server.stop();
      await server.start();
      await page.goto(server.url);
      await expect(model(page)).toHaveValue("opus");
      await expect(model(page).locator("option:checked")).toHaveText("Opus");
      await expect(pie(page)).toHaveAttribute("aria-label", before as string);
      await send(page, "What did I ask you before?");
      await expect(chat(page).getByText("You asked: Hello")).toBeVisible();
      const second = launched(server)[1] as string[];
      expect(second[second.indexOf("--resume") + 1]).toBe("fake-session-1");
      expect(messages(server)).toHaveLength(2);
    },
  );
});

test("21.2 a dead stored session starts again and the waiting message is delivered", async ({ page }) => {
  await withChat(
    {
      roles: {
        chat: {
          replies: [
            [say("m1", "First answer")],
            [{ stderr: "No conversation found with session ID: fake-session-1" }, { crash: 1 }],
            [say("m3", "Fresh answer")],
          ],
        },
      },
    },
    async (server) => {
      await page.goto(server.url);
      await send(page, "Hello");
      await expect(chat(page).getByText("First answer")).toBeVisible();
      await server.stop();
      await server.start();
      await page.goto(server.url);
      await send(page, "Second");
      await expect(chat(page).getByText("Fresh answer")).toBeVisible({ timeout: 15000 });
      await expect(chat(page).getByText("Your message was not delivered. Send it again.")).toHaveCount(0);
      const runs = launched(server) as string[][];
      expect(runs.at(-1)).not.toContain("--resume");
      expect(messages(server)).toHaveLength(3);
    },
  );
});

const ERROR = "agent failed: line one\nline two: details\nline three: more";

test("21.3 a crash with another error retries once, then asks the person to send again and shows the whole error", async ({ page }) => {
  await withChat(
    {
      roles: {
        chat: {
          replies: [
            [say("m1", "First answer")],
            [{ stderr: ERROR }, { crash: 1 }],
            [{ stderr: ERROR }, { crash: 1 }],
            [say("m4", "Back again")],
          ],
        },
      },
    },
    async (server) => {
      await page.goto(server.url);
      await send(page, "Hello");
      await expect(chat(page).getByText("First answer")).toBeVisible();
      await send(page, "Second");
      await expect(chat(page).getByText("Your message was not delivered. Send it again.")).toBeVisible({ timeout: 15000 });
      for (const line of ERROR.split("\n")) {
        await expect(chat(page)).toContainText(line);
      }
      expect(launched(server)).toHaveLength(2);
      await send(page, "Second");
      await expect(chat(page).getByText("Back again")).toBeVisible({ timeout: 15000 });
      const last = launched(server).at(-1) as string[];
      expect(last[last.indexOf("--resume") + 1]).toBe("fake-session-1");
    },
  );
});

test("21.4 a login problem shows its error at once with no retry", async ({ page }) => {
  const LOGIN = "Not logged in\nPlease run /login\nthen try again";
  await withChat(
    { roles: { chat: { replies: [[{ stderr: LOGIN }, { crash: 1 }]] } } },
    async (server) => {
      await page.goto(server.url);
      await send(page, "Hello");
      for (const line of LOGIN.split("\n")) {
        await expect(chat(page)).toContainText(line, { timeout: 15000 });
      }
      expect(launched(server)).toHaveLength(1);
      await expect(chat(page).getByText("Your message was not delivered. Send it again.")).toBeVisible({ timeout: 3000 });
    },
  );
});

test("21.5 the model switch and clear context refuse during a turn and restart quietly when idle", async ({ page }) => {
  await withChat(
    {
      roles: {
        chat: {
          replies: [
            [say("m1", "Long start"), { pause: 4000 }, say("m2", "Long end")],
            [say("m3", "After clear")],
          ],
        },
      },
    },
    async (server) => {
      await page.goto(server.url);
      await expect(model(page)).toBeVisible();
      await model(page).selectOption("sonnet");
      await expect(model(page).locator("option:checked")).toHaveText("Sonnet");
      await expect(pie(page)).toHaveAttribute("data-level", "blue");
      await send(page, "Make a long turn");
      await expect(chat(page).getByText("Long start")).toBeVisible();
      await expect(model(page)).toBeDisabled();
      await expect(model(page).selectOption("opus", { timeout: 1000 })).rejects.toThrow();
      await expect(model(page)).toHaveValue("sonnet");
      await expect(chat(page).getByText("Long end")).toBeVisible({ timeout: 15000 });
      await expect(model(page)).toBeEnabled();
      await model(page).selectOption("sonnet+opus");
      await expect(model(page).locator("option:checked")).toHaveText(/^Sonnet.*Opus advisor$/);
      await expect(chat(page).locator("[data-error]")).toHaveCount(0);
      await pie(page).click();
      const dialog = chat(page).getByRole("dialog");
      await expect(dialog).toContainText(/\d+% of the context window is in use/);
      await dialog.getByRole("button", { name: "Clear context" }).click();
      await expect(chat(page).locator("[data-error]")).toHaveCount(0);
      await send(page, "Next one");
      await expect(chat(page).getByText("After clear")).toBeVisible({ timeout: 15000 });
    },
  );
});
