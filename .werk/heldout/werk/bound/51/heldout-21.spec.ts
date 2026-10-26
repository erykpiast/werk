import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { Script } from "../src/fake-agent/script.ts";
import { type BrowserServer, startBrowserServer } from "../e2e/support/server.ts";

const say = (id: string, text: string, usage?: Record<string, number>) => ({
  event: {
    type: "assistant",
    message: { id, content: [{ type: "text", text }], ...(usage ? { usage } : {}) },
  },
});

async function withChat(script: Script, body: (s: BrowserServer) => Promise<void>) {
  const server = await startBrowserServer({ script });
  await server.start();
  try {
    await body(server);
  } finally {
    await server.dispose();
  }
}
const chat = (page: Page) => page.getByRole("complementary", { name: "Chat pane" });
async function send(page: Page, text: string) {
  const composer = page.getByRole("textbox", { name: "Message" });
  await composer.fill(text);
  await composer.press("Enter");
}
const launches = (s: BrowserServer) =>
  s.launches().flatMap((r) => (r.kind === "launch" ? [r.args] : []));
const messages = (s: BrowserServer) =>
  s.launches().flatMap((r) => (r.kind === "message" ? [r.text] : []));
const pie = (page: Page) => chat(page).getByRole("button", { name: /^Context/ });

test("21.1 model and context fill survive a server restart, and the session continues", async ({ page }) => {
  await withChat(
    {
      roles: {
        chat: {
          replies: [
            [say("m1", "First answer", { input_tokens: 50000, output_tokens: 10000 })],
            [say("m2", "You asked: Hello")],
          ],
        },
      },
    },
    async (server) => {
      await page.goto(server.url);
      await expect(chat(page).getByLabel("Model")).toBeVisible();
      await chat(page).getByLabel("Model").selectOption({ label: "Opus" });
      await send(page, "Hello");
      await expect(chat(page).getByText("First answer")).toBeVisible();
      const before = await pie(page).getAttribute("aria-label");
      expect(before).not.toBe("Context 0% full");
      await server.stop();
      await server.start();
      await page.goto(server.url);
      await expect(chat(page).getByLabel("Model")).toHaveValue("opus");
      await expect(pie(page)).toHaveAttribute("aria-label", before as string);
      await send(page, "What did I ask you before?");
      await expect(chat(page).getByText("You asked: Hello")).toBeVisible();
      const all = launches(server);
      const last = all[all.length - 1] as string[];
      expect(last[last.indexOf("--resume") + 1]).toBe("fake-session-1");
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
            [say("m3", "Fresh session answer")],
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
      await send(page, "Second message");
      await expect(chat(page).getByText("Fresh session answer")).toBeVisible();
      await expect(chat(page).getByText("Your message was not delivered. Send it again.")).toHaveCount(0);
      const all = launches(server);
      const last = all[all.length - 1] as string[];
      expect(last).not.toContain("--resume");
      expect(messages(server)).toEqual(["Hello", "Second message", "Second message"].map((t) => expect.stringContaining(t)) as never);
    },
  );
});

test("21.3 another crash retries once, then asks to send again with the whole error; then continues the session", async ({ page }) => {
  const err = "agent error line one\nagent error line two\nagent error line three";
  await withChat(
    {
      roles: {
        chat: {
          replies: [
            [say("m1", "First answer")],
            [{ stderr: err }, { crash: 1 }],
            [{ stderr: err }, { crash: 1 }],
            [say("m4", "Back again")],
          ],
        },
      },
    },
    async (server) => {
      await page.goto(server.url);
      await send(page, "Hello");
      await expect(chat(page).getByText("First answer")).toBeVisible();
      await send(page, "Break it");
      await expect(chat(page).getByText("Your message was not delivered. Send it again.")).toBeVisible();
      for (const line of err.split("\n")) await expect(chat(page).getByText(line).first()).toBeVisible();
      expect(launches(server)).toHaveLength(2);
      await send(page, "Break it");
      await expect(chat(page).getByText("Back again")).toBeVisible();
      const all = launches(server);
      const last = all[all.length - 1] as string[];
      expect(last[last.indexOf("--resume") + 1]).toBe("fake-session-1");
    },
  );
});

test("21.4 a login problem shows its error at once with no retry", async ({ page }) => {
  const err = "Not logged in\nPlease run claude auth login\nthen try again";
  await withChat(
    { roles: { chat: { replies: [[{ stderr: err }, { crash: 1 }]] } } },
    async (server) => {
      await page.goto(server.url);
      await send(page, "Hello");
      for (const line of err.split("\n")) await expect(chat(page).getByText(line).first()).toBeVisible();
      expect(launches(server)).toHaveLength(1);
      await expect(chat(page).getByText("Your message was not delivered. Send it again.")).toBeVisible({ timeout: 3000 });
    },
  );
});

const longTurn = {
  roles: {
    chat: { replies: [[say("m1", "Long start"), { pause: 4000 }, say("m1b", "Long end")], [say("m2", "After clear")]] },
  },
} satisfies Script;

test("21.5 model switch refuses during a turn, then the advisor option, then clear context", async ({ page }) => {
  await withChat(longTurn, async (server) => {
    await page.goto(server.url);
    const model = chat(page).getByLabel("Model");
    await expect(model).toBeVisible();
    // Given: Sonnet in the selector (the product default is Sonnet with the advisor).
    await model.selectOption({ label: "Sonnet" });
    await expect(model).toHaveValue("sonnet");
    await expect(pie(page)).toHaveAttribute("data-level", "blue");
    await send(page, "Make a long turn");
    await expect(chat(page).getByText("Long start")).toBeVisible();
    // the selector is locked while the turn runs: a person cannot pick Opus
    await expect(model).toBeDisabled();
    await expect(model).toHaveValue("sonnet");
    await expect(chat(page).getByText("Long end")).toBeVisible();
    await model.selectOption({ label: "Sonnet with Opus advisor" }, { timeout: 5000 });
    await expect(model.locator("option:checked")).toHaveText("Sonnet with Opus advisor");
    await expect(chat(page).getByText(/the agent exited|not delivered/)).toHaveCount(0);
    await pie(page).click();
    const dialog = chat(page).getByRole("dialog");
    await expect(dialog).toContainText("%");
    await dialog.getByRole("button", { name: "Clear context" }).click();
    await expect(chat(page).getByText(/the agent exited|not delivered/)).toHaveCount(0);
    await send(page, "Next");
    await expect(chat(page).getByText("After clear")).toBeVisible();
  });
});

test("21.5b diagnostic: same flow picking the advisor by its product label", async ({ page }) => {
  await withChat(longTurn, async (server) => {
    await page.goto(server.url);
    const model = chat(page).getByLabel("Model");
    await model.selectOption({ label: "Sonnet" });
    await send(page, "Make a long turn");
    await expect(chat(page).getByText("Long end")).toBeVisible();
    await model.selectOption({ label: "Sonnet + Opus advisor" });
    await expect(model).toHaveValue("sonnet+opus");
    await expect(chat(page).getByText(/the agent exited|not delivered/)).toHaveCount(0);
    await pie(page).click();
    const dialog = chat(page).getByRole("dialog");
    await expect(dialog).toContainText("%");
    await dialog.getByRole("button", { name: "Clear context" }).click();
    await send(page, "Next");
    await expect(chat(page).getByText("After clear")).toBeVisible();
  });
});
