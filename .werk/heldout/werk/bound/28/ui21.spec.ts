import { expect, launched, leftPane, messages, say, send, test, withChat, chat, composerOf } from "./pw.ts";

const USAGE = { input_tokens: 60000, output_tokens: 100 };
const dead = "No conversation found with session ID: fake-session-1";
const pie = (page: import("@playwright/test").Page) => chat(page).getByRole("button", { name: /^Context/ });

test("21.1 a conversation keeps its model and context fill across a server restart", async ({ page }) => {
  await withChat(
    { roles: { chat: { replies: [[say("m1", "First answer", USAGE)], [say("m2", "You asked: hello")]] } } },
    async (server) => {
      await page.goto(server.url);
      await expect(leftPane(page).getByRole("heading", { level: 1 })).toBeVisible();
      await chat(page).getByLabel("Model").selectOption({ label: "Opus" });
      await send(page, "hello");
      await expect(chat(page).getByText("First answer")).toBeVisible();
      await expect(pie(page)).toHaveAttribute("aria-label", /Context [1-9]\d*% full/);
      const fill = await pie(page).getAttribute("aria-label");
      await server.stop();
      await server.start();
      await page.goto(server.url);
      await expect(chat(page).getByLabel("Model")).toHaveValue("opus");
      await expect(pie(page)).toHaveAttribute("aria-label", fill as string);
      await send(page, "What did I ask you before?");
      await expect(chat(page).getByText("You asked: hello")).toBeVisible();
      const all = launched(server) as string[][];
      const last = all[all.length - 1] as string[];
      expect(last[last.indexOf("--resume") + 1]).toBe("fake-session-1");
      expect(last[last.indexOf("--model") + 1]).toBe("claude-opus-5-5");
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
            [{ stderr: dead }, { crash: 1 }],
            [say("m3", "Answer in a new session")],
          ],
        },
      },
    },
    async (server) => {
      await page.goto(server.url);
      await send(page, "hello");
      await expect(chat(page).getByText("First answer")).toBeVisible();
      await server.stop();
      await server.start();
      await page.goto(server.url);
      await send(page, "a new message");
      await expect(chat(page).getByText("Answer in a new session")).toBeVisible({ timeout: 20_000 });
      await expect(chat(page).getByText("Your message was not delivered. Send it again.")).toHaveCount(0);
      const sent = messages(server).filter((m) => m.endsWith("a new message"));
      expect(sent.length).toBeGreaterThanOrEqual(1);
      const all = launched(server) as string[][];
      expect(all[all.length - 1]).not.toContain("--resume");
    },
  );
});

const multi = "agent failed: line one\nline two: more detail\nline three: the end";

test("21.3 another crash retries once, then asks to send again and shows the whole error", async ({ page }) => {
  await withChat(
    {
      roles: {
        chat: {
          replies: [
            [say("m1", "First answer")],
            [{ stderr: multi }, { crash: 1 }],
            [{ stderr: multi }, { crash: 1 }],
            [say("m4", "Back again")],
          ],
        },
      },
    },
    async (server) => {
      await page.goto(server.url);
      await send(page, "hello");
      await expect(chat(page).getByText("First answer")).toBeVisible();
      await send(page, "second");
      await expect(chat(page).getByText("Your message was not delivered. Send it again.")).toBeVisible({ timeout: 20_000 });
      for (const line of multi.split("\n")) await expect(chat(page)).toContainText(line);
      expect((launched(server) as string[][]).length).toBe(2);
      await send(page, "third");
      await expect(chat(page).getByText("Back again")).toBeVisible({ timeout: 20_000 });
      const all = launched(server) as string[][];
      const last = all[all.length - 1] as string[];
      expect(last[last.indexOf("--resume") + 1]).toBe("fake-session-1");
    },
  );
});

test("21.4 a login problem shows its error at once with no retry", async ({ page }) => {
  const login = "Not logged in\nRun claude auth login to sign in\nthen try again";
  await withChat(
    { roles: { chat: { replies: [[{ stderr: login }, { crash: 1 }], [say("m2", "unused")]] } } },
    async (server) => {
      await page.goto(server.url);
      await send(page, "hello");
      for (const line of login.split("\n")) await expect(chat(page)).toContainText(line, { timeout: 20_000 });
      await expect(chat(page).getByText("Your message was not delivered. Send it again.")).toBeVisible();
      expect((launched(server) as string[][]).length).toBe(1);
    },
  );
});

test("21.5 model switch and clear context refuse during a turn and restart quietly when idle", async ({ page }) => {
  await withChat(
    {
      roles: {
        chat: {
          replies: [
            [say("m1", "Working", USAGE), { pause: 5000 }, say("m2", "Finished")],
            [say("m3", "After the clear")],
          ],
        },
      },
    },
    async (server) => {
      await page.goto(server.url);
      const model = chat(page).getByLabel("Model");
      // A new conversation opens with the advisor choice, so the person picks Sonnet first.
      await model.selectOption({ label: "Sonnet" });
      await expect(model).toHaveValue("sonnet");
      await expect(pie(page)).toHaveAttribute("data-level", "blue");
      await send(page, "start a long turn");
      await expect(chat(page).getByText("Working")).toBeVisible();
      // While the turn runs the model selector refuses a switch.
      await expect(model).toBeDisabled();
      await expect(model).toHaveValue("sonnet");
      await expect(chat(page).getByText("Finished")).toBeVisible({ timeout: 20_000 });
      await expect(model).toBeEnabled();
      await model.selectOption({ label: "Sonnet + Opus advisor" });
      await expect(model).toHaveValue("sonnet+opus");
      await expect(chat(page).getByRole("alert")).toHaveCount(0);
      await expect(chat(page)).not.toContainText("not delivered");
      await pie(page).click();
      await expect(chat(page).getByRole("dialog")).toContainText("% of the context window is in use");
      await chat(page).getByRole("button", { name: "Clear context" }).click();
      await expect(chat(page).getByRole("alert")).toHaveCount(0);
      await expect(chat(page)).not.toContainText("not delivered");
      await send(page, "next message");
      await expect(chat(page).getByText("After the clear")).toBeVisible({ timeout: 20_000 });
      void composerOf;
    },
  );
});
