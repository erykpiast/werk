import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import type { Script } from "../../src/fake-agent/script.ts";
import {
  type BrowserServer,
  startBrowserServer,
} from "../../e2e/support/server.ts";

const say = (id: string, text: string, usage?: Record<string, number>) => ({
  event: {
    type: "assistant",
    message: { id, content: [{ type: "text", text }], ...(usage ? { usage } : {}) },
  },
});

async function withServer(
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
const model = (page: Page) => page.getByRole("combobox", { name: "Model" });
const pie = (page: Page) => page.locator('[data-slot="context-pie"]');

async function send(page: Page, text: string) {
  const composer = page.getByRole("textbox", { name: "Message" });
  await composer.fill(text);
  await composer.press("Enter");
}

const launchArgs = (server: BrowserServer) =>
  server.launches().flatMap((r) => (r.kind === "launch" ? [r.args as string[]] : []));
const messages = (server: BrowserServer) =>
  server.launches().flatMap((r) => (r.kind === "message" ? [r.text] : []));

test("21.1 a conversation keeps its model and context fill across a server restart", async ({
  page,
}) => {
  await withServer(
    {
      roles: {
        chat: {
          replies: [
            [say("m1", "Noted", { input_tokens: 60000, output_tokens: 10000 })],
            [say("m2", "You asked: Remember this")],
          ],
        },
      },
    },
    async (server) => {
      await page.goto(server.url);
      await model(page).selectOption({ label: "Opus" });
      await expect(model(page)).toHaveValue("opus");
      await send(page, "Remember this");
      await expect(chat(page).getByText("Noted")).toBeVisible();
      const label = await pie(page).getAttribute("aria-label");
      expect(label).not.toBe("Context 0% full");
      await expect(pie(page)).toHaveAttribute("aria-label", label as string);

      await server.stop();
      await server.start();
      await page.goto(server.url);
      await expect(model(page)).toHaveValue("opus");
      expect(await model(page).locator("option:checked").textContent()).toBe("Opus");
      await expect(pie(page)).toHaveAttribute("aria-label", label as string);

      await send(page, "What did I ask you before?");
      await expect(chat(page).getByText("You asked: Remember this")).toBeVisible();
      const args = launchArgs(server);
      expect(args.length).toBe(2);
      const at = args[1].indexOf("--resume");
      expect(at).toBeGreaterThanOrEqual(0);
      expect(args[1][at + 1]).toBe("fake-session-1");
    },
  );
});

const NOT_DELIVERED = "Your message was not delivered. Send it again.";

test("21.2 a dead stored session starts again and the waiting message is delivered", async ({
  page,
}) => {
  await withServer(
    {
      roles: {
        chat: {
          replies: [
            [say("m1", "First")],
            [
              { stderr: "No conversation found with session ID: fake-session-1" },
              { crash: 1 },
            ],
            [say("m3", "Answer in a new session")],
          ],
        },
      },
    },
    async (server) => {
      await page.goto(server.url);
      await send(page, "one");
      await expect(chat(page).getByText("First")).toBeVisible();
      await server.stop();
      await server.start();
      await page.goto(server.url);
      await send(page, "two");
      await expect(chat(page).getByText("Answer in a new session")).toBeVisible();
      await expect(chat(page).getByText(NOT_DELIVERED)).toHaveCount(0);
      const args = launchArgs(server);
      // The last launch is a new session: no --resume.
      expect(args[args.length - 1]).not.toContain("--resume");
      expect(messages(server).filter((m) => m.endsWith("two")).length).toBe(2);
    },
  );
});

const ERROR_LINES = ["Error: backend exploded", "  at stage one", "  at stage two"];

test("21.3 another crash retries once, then asks to send again with the whole error", async ({
  page,
}) => {
  const crash = [{ stderr: ERROR_LINES.join("\n") }, { crash: 1 }];
  await withServer(
    {
      roles: {
        chat: {
          replies: [[say("m1", "First")], crash, crash, [say("m4", "Back again")]],
        },
      },
    },
    async (server) => {
      await page.goto(server.url);
      await send(page, "one");
      await expect(chat(page).getByText("First")).toBeVisible();
      await send(page, "two");
      await expect(chat(page).getByText(NOT_DELIVERED)).toBeVisible();
      for (const line of ERROR_LINES) {
        await expect(chat(page)).toContainText(line.trim());
      }
      // 1 first launch + 1 launch for the retry + 1 more... counted: crash, then one retry
      expect(launchArgs(server).length).toBe(2);
      await send(page, "three");
      await expect(chat(page).getByText("Back again")).toBeVisible();
      const args = launchArgs(server);
      const last = args[args.length - 1];
      const at = last.indexOf("--resume");
      expect(at).toBeGreaterThanOrEqual(0);
      expect(last[at + 1]).toBe("fake-session-1");
    },
  );
});

test("21.4 a login problem shows its error at once with no retry", async ({
  page,
}) => {
  const lines = ["Not logged in", "Please run /login to sign in"];
  await withServer(
    {
      roles: {
        chat: {
          replies: [[{ stderr: lines.join("\n") }, { crash: 1 }]],
        },
      },
    },
    async (server) => {
      await page.goto(server.url);
      await send(page, "hello");
      for (const line of lines) {
        await expect(chat(page)).toContainText(line);
      }
      await expect(chat(page).getByText(NOT_DELIVERED)).toBeVisible({
        timeout: 5000,
      });
      expect(launchArgs(server).length).toBe(1);
    },
  );
});

test("21.5 model switch and clear context refuse during a turn and restart quietly when idle", async ({
  page,
}) => {
  await withServer(
    {
      roles: {
        chat: {
          replies: [
            [say("m1", "Working"), { pause: 4000 }, say("m2", "Finished")],
            [say("m3", "After the switch")],
            [say("m4", "After the clear")],
          ],
        },
      },
    },
    async (server) => {
      await page.goto(server.url);
      await model(page).selectOption({ label: "Sonnet" });
      await expect(model(page)).toHaveValue("sonnet");
      await expect(pie(page)).toHaveAttribute("data-level", "blue");
      await send(page, "make a long turn");
      await expect(chat(page).getByText("Working")).toBeVisible();
      // While the turn runs the switch is refused.
      await expect(model(page)).toBeDisabled();
      await expect(model(page)).toHaveValue("sonnet");
      await expect(chat(page).getByText("Finished")).toBeVisible({
        timeout: 15000,
      });
      await model(page).selectOption({ label: "Sonnet + Opus advisor" });
      await expect(model(page)).toHaveValue("sonnet+opus");
      await expect(chat(page).getByText(/the agent exited/)).toHaveCount(0);
      await pie(page).click();
      const popover = page.getByRole("dialog", { name: "Context" });
      await expect(popover).toContainText("% of the context window is in use");
      await popover.getByRole("button", { name: "Clear context" }).click();
      await expect(chat(page).getByText(/the agent exited/)).toHaveCount(0);
      await send(page, "next");
      await expect(chat(page).getByText("After the switch")).toBeVisible();
    },
  );
});

// --- tabs (23.x): the chat pane has one conversation and no tab strip ---

const tabStrip = (page: Page) =>
  page.getByRole("tablist").or(page.locator('[data-slot="chat-tabs"]'));

test("23.1 two conversations with different home cards stay apart", async ({
  page,
}) => {
  await withServer({ roles: { chat: { replies: [[say("m1", "r1")], [say("m2", "r2")]] } } }, async (server) => {
    await page.goto(server.url);
    await send(page, "in A");
    await expect(chat(page).getByText("r1")).toBeVisible();
    await expect(tabStrip(page)).toBeVisible({ timeout: 3000 });
    await expect(tabStrip(page).getByRole("tab")).toHaveCount(2);
  });
});

test("23.2 switching to a tab shows its newest message", async ({ page }) => {
  await withServer({ roles: { chat: { replies: [[say("m1", "r1")]] } } }, async (server) => {
    await page.goto(server.url);
    await send(page, "in A");
    await expect(chat(page).getByText("r1")).toBeVisible();
    await expect(tabStrip(page).getByRole("tab").first()).toBeVisible({ timeout: 3000 });
  });
});

test("23.3 a crashed agent marks its tab and tells the other tabs", async ({ page }) => {
  await withServer(
    { roles: { chat: { replies: [[{ stderr: "boom" }, { crash: 1 }], [{ stderr: "boom" }, { crash: 1 }]] } } },
    async (server) => {
      await page.goto(server.url);
      await send(page, "in A");
      await expect(chat(page).getByText("boom").first()).toBeVisible();
      await expect(tabStrip(page).getByRole("tab").first()).toBeVisible({ timeout: 3000 });
    },
  );
});

test("23.4 a model switch is not a crash", async ({ page }) => {
  await withServer({ roles: { chat: { replies: [[say("m1", "r1")], [say("m2", "r2")]] } } }, async (server) => {
    await page.goto(server.url);
    await send(page, "hi");
    await expect(chat(page).getByText("r1")).toBeVisible();
    await model(page).selectOption({ label: "Opus" });
    await expect(chat(page).getByText(/the agent exited/)).toHaveCount(0);
    await send(page, "again");
    await expect(chat(page).getByText("r2")).toBeVisible();
    // The step reads the chip of the tab: no tab strip exists.
    await expect(tabStrip(page).getByRole("tab").first()).toBeVisible({ timeout: 3000 });
  });
});

test("23.5 a running background agent and a suggested next action", async ({ page }) => {
  await withServer(
    {
      roles: {
        chat: {
          replies: [
            [
              { event: { type: "system", subtype: "background_tasks", tasks: [{ id: "t1" }] } },
              say("m1", "Started a task"),
            ],
            [
              { event: { type: "system", subtype: "background_tasks", tasks: [] } },
              say("m2", 'Done.\n\nNext: say "merge it"'),
            ],
            [say("m3", "Merged")],
          ],
        },
      },
    },
    async (server) => {
      await page.goto(server.url);
      await send(page, "go");
      await expect(chat(page).getByText("Started a task")).toBeVisible();
      await expect(chat(page).locator('[data-slot="background-line"]')).toBeVisible();
      await send(page, "status");
      await expect(chat(page).getByText(/Done\./)).toBeVisible();
      await expect(chat(page).locator('[data-slot="background-line"]')).toHaveCount(0);
      const button = chat(page).getByRole("button", { name: "merge it" });
      await expect(button).toBeVisible();
      await button.click();
      await expect(chat(page).locator('[data-role="user"]', { hasText: "merge it" })).toBeVisible();
      await expect(chat(page).getByText("Merged")).toBeVisible();
      await expect(button).toBeHidden();
      // "the tab counts as running": there is no tab.
      await expect(tabStrip(page).getByRole("tab").first()).toBeVisible({ timeout: 3000 });
    },
  );
});
