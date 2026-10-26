import { expect, test } from "@playwright/test";
import { chat, launchArgs, messages, say, send, withChat } from "./helpers.ts";

const DEAD = "No conversation found with session ID: fake-session-1";
const MULTI = "boom line one\nboom line two\nboom line three";

test("21.1 a conversation keeps its model and context fill across a server restart", async ({
  page,
}) => {
  await withChat(
    {
      roles: {
        chat: {
          replies: [
            [say("m1", "First answer", 50000)],
            [say("m2", "You asked: Hello")],
          ],
        },
      },
    },
    async (server) => {
      await page.goto(server.url);
      await chat(page).getByLabel("Model").selectOption("opus");
      await send(page, "Hello");
      await expect(chat(page).getByText("First answer")).toBeVisible();
      const pie = chat(page).locator("[data-slot=context-pie]");
      const before = await pie.getAttribute("aria-label");
      expect(before).toMatch(/Context [1-9]\d*% full/);

      await server.stop();
      await server.start();
      await page.goto(server.url);
      await expect(chat(page).getByLabel("Model")).toHaveValue("opus");
      await expect(
        chat(page).getByLabel("Model").locator("option:checked"),
      ).toHaveText("Opus");
      await expect(pie).toHaveAttribute("aria-label", before as string);

      await send(page, "What did I ask you before?");
      await expect(chat(page).getByText("You asked: Hello")).toBeVisible();
      // The same session continues: the second launch resumes the first session.
      const launches = launchArgs(server);
      const last = launches[launches.length - 1] as string[];
      expect(last[last.indexOf("--resume") + 1]).toBe("fake-session-1");
    },
  );
});

test("21.2 a dead stored session starts again and the waiting message is delivered", async ({
  page,
}) => {
  await withChat(
    {
      roles: {
        chat: {
          replies: [
            [say("m1", "First answer")],
            [{ stderr: DEAD }, { crash: 1 }],
            [say("m3", "Answer in a new session")],
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
      await send(page, "A new message");
      await expect(
        chat(page).getByText("Answer in a new session"),
      ).toBeVisible();
      await expect(
        chat(page).getByText("Your message was not delivered. Send it again."),
      ).toHaveCount(0);
      const launches = launchArgs(server);
      const last = launches[launches.length - 1] as string[];
      expect(last).not.toContain("--resume");
      expect(messages(server).filter((m) => m.endsWith("A new message"))).toHaveLength(2);
    },
  );
});

test("21.3 another crash retries once, then asks to send again and shows the whole error", async ({
  page,
}) => {
  await withChat(
    {
      roles: {
        chat: {
          replies: [
            [say("m1", "First answer")],
            [{ stderr: MULTI }, { crash: 1 }],
            [{ stderr: MULTI }, { crash: 1 }],
            [say("m4", "Answer after the fix")],
          ],
        },
      },
    },
    async (server) => {
      await page.goto(server.url);
      await send(page, "Hello");
      await expect(chat(page).getByText("First answer")).toBeVisible();
      await send(page, "Second message");
      await expect(
        chat(page).getByText("Your message was not delivered. Send it again."),
      ).toBeVisible();
      for (const line of MULTI.split("\n")) {
        await expect(chat(page).getByText(line).first()).toBeVisible();
      }
      // The first agent died on the message, and the retry started one more agent.
      expect(launchArgs(server)).toHaveLength(2);

      await send(page, "Second message again");
      await expect(chat(page).getByText("Answer after the fix")).toBeVisible();
      const launches = launchArgs(server);
      const last = launches[launches.length - 1] as string[];
      expect(last[last.indexOf("--resume") + 1]).toBe("fake-session-1");
    },
  );
});

test("21.4 a login problem shows its error at once with no retry", async ({
  page,
}) => {
  const login = "Not logged in\nPlease run /login\nthen try again";
  await withChat(
    {
      roles: {
        chat: { replies: [[{ stderr: login }, { crash: 1 }], [say("m2", "x")]] },
      },
    },
    async (server) => {
      await page.goto(server.url);
      await send(page, "Hello");
      await expect(chat(page).getByText("Not logged in").first()).toBeVisible();
      for (const line of login.split("\n")) {
        await expect(chat(page).getByText(line).first()).toBeVisible();
      }
      expect(launchArgs(server)).toHaveLength(1);
      await expect(
        chat(page).getByText("Your message was not delivered. Send it again."),
      ).toBeVisible();
    },
  );
});

test("21.5 the model switch and clear context refuse during a turn and restart quietly when idle", async ({
  page,
}) => {
  await withChat(
    {
      roles: {
        chat: {
          replies: [
            [say("m1", "Working", 1000), { pause: 3000 }, say("m2", "Long done", 1000)],
            [say("m3", "Answer after clear")],
          ],
        },
      },
    },
    async (server) => {
      await page.goto(server.url);
      const model = chat(page).getByLabel("Model");
      await model.selectOption("sonnet");
      await expect(model.locator("option:checked")).toHaveText("Sonnet");
      const pie = chat(page).locator("[data-slot=context-pie]");
      await expect(pie).toHaveAttribute("data-level", "blue");

      await send(page, "A long turn");
      await expect(chat(page).getByText("Working")).toBeVisible();
      // While the turn runs the selector refuses a pick.
      await expect(model).toBeDisabled();
      await expect(model.locator("option:checked")).toHaveText("Sonnet");

      await expect(chat(page).getByText("Long done")).toBeVisible();
      await expect(model).toBeEnabled();
      await model.selectOption("sonnet+opus");
      await expect(model.locator("option:checked")).toHaveText(
        /Sonnet.*Opus advisor/,
      );
      await expect(chat(page).getByText(/the agent exited/)).toHaveCount(0);

      await pie.click();
      const popover = chat(page).getByRole("dialog");
      await expect(popover).toContainText("% of the context window is in use");
      await popover.getByRole("button", { name: "Clear context" }).click();
      await expect(chat(page).getByText(/the agent exited/)).toHaveCount(0);
      await send(page, "After clear");
      await expect(chat(page).getByText("Answer after clear")).toBeVisible();
    },
  );
});
