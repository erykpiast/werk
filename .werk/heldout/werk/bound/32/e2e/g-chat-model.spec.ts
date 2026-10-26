import { expect, test } from "../../e2e/support/fixtures.ts";
import { chat, say, send, withChat } from "./support-chat.ts";

const noCrash = async (page: import("@playwright/test").Page) => {
  await expect(chat(page).getByText(/the agent exited/)).toHaveCount(0);
  await expect(chat(page).locator("[data-error]")).toHaveCount(0);
};

test("21.5 the model switch and clear context refuse during a turn and restart quietly when idle", async ({
  page,
}) => {
  await withChat(
    {
      roles: {
        chat: {
          replies: [
            [say("m1", "Working"), { pause: 4000 }, say("m2", "Long turn done")],
            [say("m3", "Answer after clear")],
          ],
        },
      },
    },
    async (server) => {
      await page.goto(server.url);
      const model = chat(page).getByLabel("Model");
      // Given: "Sonnet" is in the model selector, and the pie is blue before the first turn.
      await model.selectOption({ label: "Sonnet" });
      await expect(model.locator("option:checked")).toHaveText("Sonnet");
      const pie = chat(page).getByRole("button", { name: /^Context/ });
      await expect(pie).toHaveAttribute("data-level", "blue");

      await send(page, "Make a long turn");
      await expect(chat(page).getByText("Working")).toBeVisible();
      // While the turn runs the person cannot pick Opus: werk refuses and the selector stays.
      await expect(model).toBeDisabled();
      await expect(
        model.selectOption({ label: "Opus" }, { timeout: 1000 }),
      ).rejects.toThrow();
      await expect(model.locator("option:checked")).toHaveText("Sonnet");

      await expect(chat(page).getByText("Long turn done")).toBeVisible({
        timeout: 15000,
      });
      await expect(model).toBeEnabled();
      // The step names the choice "Sonnet with Opus advisor".
      const picked = await model
        .selectOption({ label: "Sonnet with Opus advisor" }, { timeout: 2000 })
        .then(
          () => true,
          () => false,
        );
      const shown = await model.locator("option:checked").textContent();
      if (!picked) await model.selectOption("sonnet+opus");
      await noCrash(page);
      expect.soft(picked, `the selector offers no "Sonnet with Opus advisor"; its option reads "${shown}"`).toBe(true);
      expect.soft(shown).toBe("Sonnet with Opus advisor");

      await pie.click();
      const dialog = chat(page).getByRole("dialog");
      await expect(dialog).toContainText("% of the context window is in use");
      await dialog.getByRole("button", { name: "Clear context" }).click();
      await noCrash(page);
      await send(page, "After the clear");
      await expect(chat(page).getByText("Answer after clear")).toBeVisible();
    },
  );
});
