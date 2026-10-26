import { expect, test } from "../../e2e/support/fixtures.ts";
import {
  arg,
  chat,
  launched,
  messages,
  say,
  send,
  storeSession,
  withChat,
} from "./support-chat.ts";

const NOT_DELIVERED = "Your message was not delivered. Send it again.";

test("21.2 a dead stored session starts again and the waiting message is delivered", async ({
  page,
}) => {
  await withChat(
    {
      roles: {
        chat: {
          replies: [
            [say("m1", "First answer")],
            [
              { stderr: "No conversation found with session ID: gone-session" },
              { crash: 1 },
            ],
            [say("m3", "Answer in a new session")],
          ],
        },
      },
    },
    async (server) => {
      await page.goto(server.url);
      await send(page, "Earlier question");
      await expect(chat(page).getByText("First answer")).toBeVisible();
      await server.stop();
      storeSession(server, "gone-session");
      await server.start();
      await page.goto(server.url);
      await send(page, "New question");
      await expect(
        chat(page).getByText("Answer in a new session"),
      ).toBeVisible();
      await expect(chat(page).getByText(NOT_DELIVERED)).toHaveCount(0);
      await expect(chat(page).locator("article")).toHaveCount(1);
      const all = launched(server);
      const first = all[all.length - 2] as string[];
      const last = all[all.length - 1] as string[];
      expect(arg(first, "--resume")).toBe("gone-session");
      expect(last).not.toContain("--resume");
      expect(
        messages(server).filter((m) => m.endsWith("New question")),
      ).toHaveLength(2);
    },
  );
});

const ERROR = "Boom: line one\nBoom: line two\nBoom: line three";
const crash = [{ stderr: ERROR }, { crash: 1 }];

test("21.3 a crash with another error retries once, then asks the person to send again and shows the whole error", async ({
  page,
}) => {
  await withChat(
    {
      roles: {
        chat: {
          replies: [
            [say("m1", "First answer")],
            crash,
            crash,
            [say("m4", "Back again")],
          ],
        },
      },
    },
    async (server) => {
      await page.goto(server.url);
      await send(page, "Earlier question");
      await expect(chat(page).getByText("First answer")).toBeVisible();
      expect(launched(server)).toHaveLength(1);

      await send(page, "Second question");
      await expect(chat(page).getByText(NOT_DELIVERED)).toBeVisible();
      // The first agent is alive and crashes on the message: one more start is the retry.
      expect(launched(server)).toHaveLength(2);
      for (const line of [
        "Boom: line one",
        "Boom: line two",
        "Boom: line three",
      ]) {
        await expect(chat(page).getByText(line)).toBeVisible();
      }

      await send(page, "Second question again");
      await expect(chat(page).getByText("Back again")).toBeVisible();
      const all = launched(server);
      expect(all).toHaveLength(3);
      expect(arg(all[2] as string[], "--resume")).toBe("fake-session-1");
    },
  );
});

test("21.4 a login problem shows its error at once with no retry", async ({
  page,
}) => {
  const login =
    "Not logged in · Please run /login\nSecond line of the login error\nThird line of the login error";
  await withChat(
    {
      roles: {
        chat: {
          replies: [
            [{ stderr: login }, { crash: 1 }],
            [say("m2", "should not play")],
          ],
        },
      },
    },
    async (server) => {
      await page.goto(server.url);
      await send(page, "Hello");
      for (const line of login.split("\n")) {
        await expect(chat(page).getByText(line)).toBeVisible();
      }
      expect(launched(server)).toHaveLength(1);
      await expect(chat(page).getByText(NOT_DELIVERED)).toBeVisible({
        timeout: 3000,
      });
    },
  );
});
