import { expect, test } from "@playwright/test";
import {
  argAfter,
  chat,
  launched,
  messages,
  say,
  send,
  withChat,
} from "./helpers.ts";

const NOT_DELIVERED = "Your message was not delivered. Send it again.";
const pie = (page: import("@playwright/test").Page) =>
  chat(page).getByRole("button", { name: /^Context/ });
const model = (page: import("@playwright/test").Page) =>
  chat(page).getByLabel("Model");

test("21.1 a conversation keeps its model and context fill across a server restart", async ({
  page,
}) => {
  await withChat(
    {
      roles: {
        chat: {
          replies: [
            [say("m1", "Noted the pelican", { input_tokens: 40000, output_tokens: 20000 })],
            [say("m2", "You asked: Remember the word pelican")],
          ],
        },
      },
    },
    async (server) => {
      await page.goto(server.url);
      await expect(model(page)).toBeVisible();
      await model(page).selectOption({ label: "Opus" });
      await send(page, "Remember the word pelican");
      await expect(chat(page).getByText("Noted the pelican")).toBeVisible();
      await expect(pie(page)).toHaveAttribute("aria-label", "Context 30% full");
      const before = await pie(page).getAttribute("aria-label");
      const firstSession = "fake-session-1";

      await server.stop();
      await server.start();
      await page.goto(server.url);
      await expect(model(page)).toBeVisible();
      const shown = await model(page).evaluate(
        (s: HTMLSelectElement) => s.selectedOptions[0]?.textContent,
      );
      expect(shown).toBe("Opus");
      await expect(pie(page)).toHaveAttribute("aria-label", before as string);

      await send(page, "What did I ask you before?");
      await expect(
        chat(page).getByText("You asked: Remember the word pelican"),
      ).toBeVisible();
      const last = launched(server).at(-1) as string[];
      expect(argAfter(last, "--resume")).toBe(firstSession);
      expect(argAfter(last, "--model")).toBe("claude-opus-5-5");
      expect(messages(server).at(-1)).toMatch(/What did I ask you before\?$/);
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
            [
              {
                stderr:
                  "No conversation found with session ID: fake-session-1",
              },
              { crash: 1 },
            ],
            [say("m2", "Fresh session answer")],
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
      await expect(model(page)).toBeVisible();
      await send(page, "Second message");
      await expect(chat(page).getByText("Fresh session answer")).toBeVisible();
      await expect(chat(page).getByText(NOT_DELIVERED)).toHaveCount(0);
      // One send by the person: one turn in the pane.
      await expect(chat(page).locator("article")).toHaveCount(1);
      const launches = launched(server);
      const last = launches.at(-1) as string[];
      expect(launches.length).toBe(3);
      expect(last).not.toContain("--resume");
      expect(messages(server).filter((m) => /Second message$/.test(m)).length)
        .toBe(2);
    },
  );
});

test("21.3 a crash with another error retries once, then asks the person to send again and shows the whole error", async ({
  page,
}) => {
  const crash = [
    { stderr: "boom: line one\nline two of the error\nline three of the error" },
    { crash: 1 },
  ];
  await withChat(
    {
      roles: {
        chat: {
          replies: [
            [say("m1", "First answer")],
            crash,
            crash,
            [say("m3", "Back in the session")],
          ],
        },
      },
    },
    async (server) => {
      await page.goto(server.url);
      await send(page, "Hello");
      await expect(chat(page).getByText("First answer")).toBeVisible();
      const before = launched(server).length;
      await send(page, "Second message");
      await expect(chat(page).getByText(NOT_DELIVERED).first()).toBeVisible();
      // One more start before werk gives up.
      expect(launched(server).length - before).toBe(1);
      const text = (await chat(page).innerText()) as string;
      for (const line of [
        "boom: line one",
        "line two of the error",
        "line three of the error",
      ]) {
        expect(text).toContain(line);
      }
      await send(page, "Try again");
      await expect(chat(page).getByText("Back in the session")).toBeVisible();
      const last = launched(server).at(-1) as string[];
      expect(argAfter(last, "--resume")).toBe("fake-session-1");
    },
  );
});

test("21.4 a login problem shows its error at once with no retry", async ({
  page,
}) => {
  await withChat(
    {
      roles: {
        chat: {
          replies: [
            [
              {
                stderr:
                  "Not logged in\nRun claude auth login to sign in\nthen try again",
              },
              { crash: 1 },
            ],
          ],
        },
      },
    },
    async (server) => {
      await page.goto(server.url);
      await send(page, "Hello");
      await expect(chat(page).getByText("Not logged in").first()).toBeVisible();
      expect(launched(server).length).toBe(1);
      const text = await chat(page).innerText();
      for (const line of [
        "Not logged in",
        "Run claude auth login to sign in",
        "then try again",
      ]) {
        expect(text).toContain(line);
      }
      expect(text).toContain(NOT_DELIVERED);
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
            [say("m1", "Working"), { pause: 3000 }, say("m2", "Long turn done")],
            [say("m3", "After the clear")],
          ],
        },
      },
    },
    async (server) => {
      await page.goto(server.url);
      await expect(model(page)).toBeVisible();
      // Given: Sonnet is shown. A new conversation starts on Sonnet with Opus advisor, so pick Sonnet.
      await model(page).selectOption({ label: "Sonnet" });
      await expect(pie(page)).toHaveAttribute("data-level", "blue");
      await send(page, "Make a long turn");
      await expect(chat(page).getByText("Working")).toBeVisible();
      // While the turn runs the select is disabled: the person cannot pick Opus.
      await expect(model(page)).toBeDisabled();
      const picked = await model(page)
        .selectOption({ label: "Opus" }, { timeout: 1000 })
        .then(
          () => "picked",
          () => "refused",
        );
      expect(picked).toBe("refused");
      expect(
        await model(page).evaluate(
          (s: HTMLSelectElement) => s.selectedOptions[0]?.textContent,
        ),
      ).toBe("Sonnet");
      await expect(chat(page).getByText("Long turn done")).toBeVisible();
      await expect(model(page)).toBeEnabled();

      // The step names the label "Sonnet with Opus advisor".
      const labels = await model(page)
        .locator("option")
        .allTextContents();
      expect.soft(labels, "option labels of the model selector").toContain(
        "Sonnet with Opus advisor",
      );
      await model(page).selectOption({ value: "sonnet+opus" });
      expect(
        await model(page).evaluate(
          (s: HTMLSelectElement) => s.selectedOptions[0]?.textContent,
        ),
      ).toBe("Sonnet with Opus advisor");
      await expect(page.locator("[data-slot=dead-error]")).toHaveCount(0);
      await expect(page.locator("[data-slot=dead-line]")).toHaveCount(0);

      await pie(page).click();
      const dialog = chat(page).getByRole("dialog");
      await expect(dialog).toContainText(/\d+% of the context window is in use/);
      await expect(
        dialog.getByRole("button", { name: "Clear context" }),
      ).toBeVisible();
      await dialog.getByRole("button", { name: "Clear context" }).click();
      await expect(page.locator("[data-slot=dead-error]")).toHaveCount(0);
      await expect(page.locator("[data-slot=tab-chip][data-blink=red]")).toHaveCount(0);
      await send(page, "After clearing");
      await expect(chat(page).getByText("After the clear")).toBeVisible();
    },
  );
});
