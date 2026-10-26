import { expect, test } from "@playwright/test";
import { chat, composer, send, say, withServer } from "./support.ts";

const sayUsed = (id: string, text: string, tokens: number) => ({
  event: {
    type: "assistant",
    message: {
      id,
      content: [{ type: "text", text }],
      usage: { input_tokens: tokens, output_tokens: 10 },
    },
  },
});
const pie = (page: import("@playwright/test").Page) =>
  chat(page).locator("[data-slot=context-pie]");
const model = (page: import("@playwright/test").Page) => chat(page).getByLabel("Model");
const arg = (args: string[], flag: string) => args[args.indexOf(flag) + 1];

test("21.1 model and context fill survive a server restart, and the session continues", async ({ page }) => {
  await withServer(
    {
      script: {
        roles: {
          chat: {
            replies: [
              [sayUsed("m1", "First answer", 60000)],
              [say("m2", "You asked: Hello")],
            ],
          },
        },
      },
    },
    async (s) => {
      await page.goto(s.url);
      await expect(model(page)).toBeVisible();
      await model(page).selectOption({ label: "Opus" });
      await send(page, "Hello");
      await expect(chat(page).getByText("First answer")).toBeVisible();
      await expect(pie(page)).not.toHaveAttribute("data-level", "");
      const fill = await pie(page).getAttribute("aria-label");
      expect(fill).not.toBe("Context 0% full");
      await s.stop();
      await s.start();
      await page.goto(s.url);
      await expect(model(page)).toHaveValue("opus");
      await expect(model(page).locator("option:checked")).toHaveText("Opus");
      await expect(pie(page)).toHaveAttribute("aria-label", fill as string);
      await send(page, "What did I ask you before?");
      await expect(chat(page).getByText("You asked: Hello")).toBeVisible();
      const launches = s.launched();
      const last = launches[launches.length - 1] as string[];
      expect(arg(last, "--resume")).toBe("fake-session-1");
      expect(arg(last, "--model")).toBe("claude-opus-5-5");
    },
  );
});

test("21.2 a dead stored session starts again and delivers the waiting message", async ({ page }) => {
  const dead = [
    { stderr: "No conversation found with session ID: fake-session-1" },
    { crash: 1 },
  ];
  await withServer(
    {
      script: {
        roles: {
          chat: {
            replies: [[say("m1", "First answer")], dead, [say("m3", "New session answer")]],
          },
        },
      },
    },
    async (s) => {
      await page.goto(s.url);
      await send(page, "Hello");
      await expect(chat(page).getByText("First answer")).toBeVisible();
      await s.stop();
      await s.start();
      await page.goto(s.url);
      await send(page, "Second");
      await expect(chat(page).getByText("New session answer")).toBeVisible({ timeout: 30000 });
      await expect(page.getByText("Your message was not delivered. Send it again.")).toHaveCount(0);
      const msgs = s.messages();
      expect(msgs.filter((m) => m.endsWith("Second")).length).toBeGreaterThanOrEqual(1);
      expect(msgs.length).toBe(3);
      const launches = s.launched() as string[][];
      expect(launches[launches.length - 1]).not.toContain("--resume");
    },
  );
});

test("21.3 another error retries once, then asks to send again with the whole error", async ({ page }) => {
  const bad = [{ stderr: "line one of failure\nline two of failure\nline three of failure" }, { crash: 1 }];
  await withServer(
    {
      script: {
        roles: { chat: { replies: [[say("m1", "First answer")], bad, bad, [say("m4", "Back again")]] } },
      },
    },
    async (s) => {
      await page.goto(s.url);
      await send(page, "Hello");
      await expect(chat(page).getByText("First answer")).toBeVisible();
      await send(page, "Second");
      await expect(chat(page).locator("[data-slot=dead-error]")).toContainText("Your message was not delivered. Send it again.", { timeout: 30000 });
      for (const l of ["line one of failure", "line two of failure", "line three of failure"]) {
        await expect(chat(page).locator("[data-slot=dead-error]")).toContainText(l);
      }
      const afterFail = s.launched().length;
      // first launch crashed on the message, then one more start; no third
      expect(afterFail).toBe(2);
      await page.waitForTimeout(3000);
      expect(s.launched().length).toBe(2);
      await send(page, "Third");
      await expect(chat(page).getByText("Back again")).toBeVisible({ timeout: 30000 });
      const last = s.launched().at(-1) as string[];
      expect(arg(last, "--resume")).toBe("fake-session-1");
    },
  );
});

test("21.4 a login problem shows at once with no retry", async ({ page }) => {
  const login = [{ stderr: "Not logged in\nPlease run /login\nthen try again" }, { crash: 1 }];
  await withServer(
    { script: { roles: { chat: { replies: [login, [say("m2", "unused")]] } } } },
    async (s) => {
      await page.goto(s.url);
      await send(page, "Hello");
      for (const l of ["Not logged in", "Please run /login", "then try again"]) {
        await expect(chat(page).locator("[data-slot=dead-error]")).toContainText(l, { timeout: 30000 });
      }
      await page.waitForTimeout(3000);
      expect(s.launched().length).toBe(1);
      await expect(chat(page).locator("[data-slot=dead-error]")).toContainText("Your message was not delivered. Send it again.");
    },
  );
});

test("21.5 model switch and clear context refuse during a turn and restart quietly when idle", async ({ page }) => {
  await withServer(
    {
      script: {
        roles: {
          chat: {
            replies: [
              [say("m1", "start"), { pause: 6000 }, say("m2", "long turn done")],
              [say("m3", "after switch")],
              [say("m4", "after clear")],
            ],
          },
        },
      },
    },
    async (s) => {
      await page.goto(s.url);
      await expect(model(page)).toBeVisible();
      await model(page).selectOption({ label: "Sonnet" });
      await expect(model(page).locator("option:checked")).toHaveText("Sonnet");
      await expect(pie(page)).toHaveAttribute("data-level", "blue");
      await send(page, "Make a long turn");
      await expect(chat(page).getByText("start")).toBeVisible();
      await expect(
        model(page).selectOption({ label: "Opus" }, { timeout: 1500 }),
      ).rejects.toThrow();
      await expect(model(page).locator("option:checked")).toHaveText("Sonnet");
      await expect(chat(page).getByText("long turn done")).toBeVisible({ timeout: 30000 });
      await model(page).selectOption("sonnet+opus");
      await expect(model(page).locator("option:checked")).toHaveText("Sonnet + Opus advisor");
      await expect(chat(page).getByText(/crash|stopped|not delivered/i)).toHaveCount(0);
      await pie(page).click();
      const dialog = chat(page).getByRole("dialog");
      await expect(dialog).toContainText("% of the context window is in use");
      await dialog.getByRole("button", { name: "Clear context" }).click();
      await expect(chat(page).getByText(/crash|stopped|not delivered/i)).toHaveCount(0);
      await send(page, "Hello again");
      await expect(chat(page).getByText(/after (switch|clear)/)).toBeVisible({ timeout: 30000 });
    },
  );
});
