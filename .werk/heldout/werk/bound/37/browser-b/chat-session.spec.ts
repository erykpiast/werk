import { expect, test } from "@playwright/test";
import {
  chat,
  launchArgs,
  messages,
  readSession,
  say,
  send,
  withServer,
  writeSession,
} from "./helpers.ts";

const flag = (args: string[], name: string) => args[args.indexOf(name) + 1];

test("21.1 a conversation keeps its model and context fill across a server restart", async ({
  page,
}) => {
  const usage = {
    input_tokens: 10,
    output_tokens: 20,
    cache_read_input_tokens: 60_000,
    cache_creation_input_tokens: 10_000,
  };
  await withServer(
    {
      roles: {
        chat: {
          replies: [
            [say("m1", "First answer", usage)],
            [say("m2", "You asked: Remember this", usage)],
          ],
        },
      },
    },
    async (server) => {
      await page.goto(server.url);
      await send(page, "Remember this");
      await expect(chat(page).getByText("First answer")).toBeVisible();
      const select = chat(page).getByLabel("Model");
      await select.selectOption({ label: "Opus" });
      const pie = chat(page).locator("[data-slot=context-pie]");
      const before = await pie.getAttribute("aria-label");
      expect(before).toMatch(/Context \d+% full/);
      expect(before).not.toBe("Context 0% full");
      await server.stop();
      await server.start();
      await page.goto(server.url);
      await expect(chat(page).getByLabel("Model")).toHaveValue("opus");
      await expect(
        chat(page).getByLabel("Model").locator("option:checked"),
      ).toHaveText("Opus");
      await expect(pie).toHaveAttribute("aria-label", before as string);
      await send(page, "What did I ask you before?");
      await expect(
        chat(page).getByText("You asked: Remember this"),
      ).toBeVisible();
      const args = launchArgs(server);
      const last = args[args.length - 1] as string[];
      expect(flag(last, "--resume")).toBe("fake-session-1");
    },
  );
});

test("21.2 a dead stored session starts again and the waiting message is delivered", async ({
  page,
}) => {
  const dead = {
    event: {
      type: "result",
      is_error: true,
      errors: ["No conversation found with session ID: dead-id"],
    },
  };
  await withServer(
    {
      roles: {
        chat: {
          replies: [
            [say("m1", "Earlier answer")],
            [dead, { crash: 1 }],
            [say("m3", "Answer in a new session")],
          ],
        },
      },
    },
    async (server) => {
      await page.goto(server.url);
      await send(page, "Earlier");
      await expect(chat(page).getByText("Earlier answer")).toBeVisible();
      writeSession(server, "dead-id");
      await server.stop();
      await server.start();
      await page.goto(server.url);
      await send(page, "New message");
      await expect(chat(page).getByText("Answer in a new session")).toBeVisible();
      await expect(
        chat(page).getByText("Your message was not delivered. Send it again."),
      ).toHaveCount(0);
      const args = launchArgs(server);
      expect(flag(args[args.length - 2] as string[], "--resume")).toBe("dead-id");
      expect(args[args.length - 1]).not.toContain("--resume");
      expect(messages(server).filter((t) => t.endsWith("New message")).length).toBe(2);
      expect(readSession(server)).not.toBe("dead-id");
    },
  );
});

const bang = (n: number) => `Error line ${n}: something broke`;
const multi = [1, 2, 3].map(bang).join("\n");

test("21.3 another crash retries once, shows the notice and the whole error, then resumes", async ({
  page,
}) => {
  await withServer(
    {
      roles: {
        chat: {
          replies: [
            [say("m1", "Earlier answer")],
            [{ stderr: multi }, { crash: 1 }],
            [{ stderr: multi }, { crash: 1 }],
            [say("m4", "Back again")],
          ],
        },
      },
    },
    async (server) => {
      await page.goto(server.url);
      await send(page, "Earlier");
      await expect(chat(page).getByText("Earlier answer")).toBeVisible();
      const before = launchArgs(server).length;
      await send(page, "Second");
      await expect(
        chat(page).getByText("Your message was not delivered. Send it again."),
      ).toBeVisible();
      expect(launchArgs(server).length - before).toBe(1);
      for (const n of [1, 2, 3]) {
        await expect(chat(page).getByText(bang(n)).first()).toBeVisible();
      }
      await send(page, "Third");
      await expect(chat(page).getByText("Back again")).toBeVisible();
      const args = launchArgs(server);
      expect(flag(args[args.length - 1] as string[], "--resume")).toBe(
        "fake-session-1",
      );
    },
  );
});

test("21.4 a login problem shows its error at once with no retry", async ({
  page,
}) => {
  const text =
    "Invalid credential.\nRemove the credential and run: claude auth login";
  await withServer(
    { roles: { chat: { replies: [[{ stderr: text }, { crash: 1 }], [say("m", "x")]] } } },
    async (server) => {
      await page.goto(server.url);
      await send(page, "Hello");
      await expect(chat(page).getByText("Invalid credential.").first()).toBeVisible();
      await expect(
        chat(page).getByText("Remove the credential and run: claude auth login").first(),
      ).toBeVisible();
      expect(launchArgs(server)).toHaveLength(1);
      await expect(
        chat(page).getByText("Your message was not delivered. Send it again."),
      ).toBeVisible({ timeout: 5000 });
    },
  );
});

test("21.5 the model switch and clear context refuse during a turn and restart quietly when idle", async ({
  page,
}) => {
  await withServer(
    {
      roles: {
        chat: {
          replies: [
            [say("m1", "Start"), { pause: 4000 }, say("m2", "Long turn done")],
            [say("m3", "After clear")],
          ],
        },
      },
    },
    async (server) => {
      await page.goto(server.url);
      const select = chat(page).getByLabel("Model");
      await expect.soft(select.locator("option:checked")).toHaveText("Sonnet");
      await expect
        .soft(chat(page).locator("[data-slot=context-pie]"))
        .toHaveAttribute("data-level", "blue");
      await select.selectOption({ value: "sonnet" });
      await send(page, "Make a long turn");
      await expect(chat(page).getByText("Start")).toBeVisible();
      // A person cannot pick in a disabled select.
      await expect(select).toBeDisabled();
      await expect(select.locator("option:checked")).toHaveText("Sonnet");
      await expect(chat(page).getByText("Long turn done")).toBeVisible({
        timeout: 15000,
      });
      await expect(select).toBeEnabled();
      await select.selectOption({ label: "Sonnet with Opus advisor" });
      await expect(select.locator("option:checked")).toHaveText(
        "Sonnet with Opus advisor",
      );
      await expect(chat(page).getByRole("alert")).toHaveCount(0);
      await chat(page).getByRole("button", { name: /^Context/ }).click();
      const dialog = chat(page).getByRole("dialog");
      await expect(dialog).toContainText(/\d+% of the context window is in use/);
      await dialog.getByRole("button", { name: "Clear context" }).click();
      await expect(chat(page).getByRole("alert")).toHaveCount(0);
      await send(page, "Next one");
      await expect(chat(page).getByText("After clear")).toBeVisible();
    },
  );
});
