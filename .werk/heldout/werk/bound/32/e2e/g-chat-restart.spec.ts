import { expect, test } from "../../e2e/support/fixtures.ts";
import {
  arg,
  chat,
  launched,
  messages,
  say,
  send,
  withChat,
} from "./support-chat.ts";

const usage = { input_tokens: 50000, output_tokens: 1000 };

test("21.1 a conversation keeps its model and context fill across a server restart", async ({
  page,
}) => {
  await withChat(
    {
      roles: {
        chat: {
          replies: [
            [say("m1", "First answer", usage)],
            [say("m2", "You asked: Hello")],
          ],
        },
      },
    },
    async (server) => {
      await page.goto(server.url);
      await chat(page).getByLabel("Model").selectOption({ label: "Opus" });
      await send(page, "Hello");
      await expect(chat(page).getByText("First answer")).toBeVisible();
      const pie = chat(page).getByRole("button", { name: /^Context/ });
      await expect(pie).toHaveAttribute("aria-label", /Context [1-9]\d*% full/);
      const before = await pie.getAttribute("aria-label");

      await server.stop();
      await server.start();
      await page.goto(server.url);
      await expect(chat(page).getByLabel("Model")).toHaveValue("opus");
      await expect(
        chat(page).getByLabel("Model").locator("option:checked"),
      ).toHaveText("Opus");
      await expect(
        chat(page).getByRole("button", { name: /^Context/ }),
      ).toHaveAttribute("aria-label", before as string);

      await send(page, "What did I ask you before?");
      await expect(chat(page).getByText("You asked: Hello")).toBeVisible();
      // The same session continues: the new agent resumes the stored session id.
      const all = launched(server);
      const last = all[all.length - 1] as string[];
      expect(arg(last, "--resume")).toBe("fake-session-1");
      expect(arg(last, "--model")).toBe("claude-opus-5-5");
      expect(messages(server)).toHaveLength(2);
    },
  );
});
