import { expect, test } from "@playwright/test";
import type { BrowserServer } from "../../e2e/support/server.ts";
import type { Script } from "../../src/fake-agent/script.ts";
import { chat, say, send, serverWith } from "./g3-support.ts";

const DEAD = "No conversation found with session ID: gone-1234";
const NOT_DELIVERED = "Your message was not delivered. Send it again.";

const launched = (server: BrowserServer) =>
  server.launches().flatMap((r) => (r.kind === "launch" ? [r.args] : []));
const resumeOf = (args: string[]) =>
  args.includes("--resume") ? args[args.indexOf("--resume") + 1] : undefined;

async function withChat(
  script: Script,
  body: (server: BrowserServer) => Promise<void>,
) {
  const server = await serverWith({ script });
  try {
    await body(server);
  } finally {
    await server.dispose();
  }
}

const pie = (page: import("@playwright/test").Page) =>
  chat(page).getByRole("button", { name: /^Context/ });

test("21.1 a conversation keeps its model and context fill across a server restart", async ({
  page,
}) => {
  await withChat(
    {
      roles: {
        chat: {
          replies: [
            [say("m1", "Noted", { input_tokens: 50000, output_tokens: 10 })],
            [say("m2", "You asked: Hello")],
          ],
        },
      },
    },
    async (server) => {
      await page.goto(server.url);
      const model = chat(page).getByLabel("Model");
      await model.selectOption({ label: "Opus" });
      await send(page, "Hello");
      await expect(chat(page).getByText("Noted")).toBeVisible();
      await expect(pie(page)).not.toHaveAttribute("aria-label", "Context 0% full");
      const fill = await pie(page).getAttribute("aria-label");

      await server.stop();
      await server.start();
      await page.goto(server.url);
      await expect(chat(page).getByLabel("Model").locator("option:checked")).toHaveText("Opus");
      await expect(pie(page)).toHaveAttribute("aria-label", fill as string);

      await send(page, "What did I ask you before?");
      await expect(chat(page).getByText("You asked: Hello")).toBeVisible();
      const resumed = launched(server).map(resumeOf).filter(Boolean);
      expect(resumed).toContain("fake-session-1");
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
            [say("m2", "New session answer")],
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
      await expect(chat(page).getByText("New session answer")).toBeVisible();
      await expect(chat(page).getByText(NOT_DELIVERED)).toHaveCount(0);
      await expect(chat(page).getByText("Second message")).toHaveCount(1);
      const all = launched(server);
      expect(resumeOf(all[all.length - 1] as string[])).toBeUndefined();
    },
  );
});

const ERROR = "Error: upstream exploded\n  at step two\n  at step three";

test("21.3 a crash with another error retries once, then asks the person to send again and shows the whole error", async ({
  page,
}) => {
  await withChat(
    {
      roles: {
        chat: {
          replies: [
            [say("m1", "First answer")],
            [{ stderr: ERROR }, { crash: 1 }],
            [{ stderr: ERROR }, { crash: 1 }],
            [say("m2", "Recovered")],
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
      await expect(chat(page).getByText(NOT_DELIVERED)).toBeVisible();
      expect(launched(server).length - before).toBe(1);
      for (const line of ERROR.split("\n"))
        await expect(chat(page)).toContainText(line.trim());

      await send(page, "Second message");
      await expect(chat(page).getByText("Recovered")).toBeVisible();
      const all = launched(server);
      expect(resumeOf(all[all.length - 1] as string[])).toBe("fake-session-1");
    },
  );
});

test("21.4 a login problem shows its error at once with no retry", async ({
  page,
}) => {
  const LOGIN = "Error: not logged in\nPlease run /login\nthen send it again";
  await withChat(
    { roles: { chat: { replies: [[{ stderr: LOGIN }, { crash: 1 }]] } } },
    async (server) => {
      await page.goto(server.url);
      await send(page, "Hello");
      for (const line of LOGIN.split("\n"))
        await expect(chat(page)).toContainText(line);
      expect(launched(server)).toHaveLength(1);
      await expect(chat(page).getByText(NOT_DELIVERED)).toBeVisible();
    },
  );
});

const long = {
  roles: {
    chat: {
      replies: [
        [say("m1", "Long start"), { pause: 3000 }, say("m2", "Long end")],
        [say("m3", "After the switch")],
        [say("m4", "After the clear")],
      ],
    },
  },
} satisfies Script;

test("21.5 the model switch refuses during a turn and the advisor choice reads 'Sonnet with Opus advisor'", async ({
  page,
}) => {
  await withChat(long, async (server) => {
    await page.goto(server.url);
    const model = chat(page).getByLabel("Model");
    await model.selectOption({ label: "Sonnet" });
    await expect(pie(page)).toHaveAttribute("data-level", "blue");
    await send(page, "Make a long turn");
    await expect(chat(page).getByText("Long start")).toBeVisible();
    await expect(model).toBeDisabled();
    await expect(model.locator("option:checked")).toHaveText("Sonnet");
    await expect(chat(page).getByText("Long end")).toBeVisible({ timeout: 15000 });
    await model.selectOption({ label: "Sonnet with Opus advisor" }, { timeout: 3000 });
  });
});

test("21.5 (rest, with the option the product labels 'Sonnet + Opus advisor')", async ({
  page,
}) => {
  await withChat(long, async (server) => {
    await page.goto(server.url);
    const model = chat(page).getByLabel("Model");
    await model.selectOption({ label: "Sonnet" });
    await send(page, "Make a long turn");
    await expect(chat(page).getByText("Long start")).toBeVisible();
    await expect(model).toBeDisabled();
    await expect(chat(page).getByText("Long end")).toBeVisible({ timeout: 15000 });
    await model.selectOption("sonnet+opus");
    await expect(model.locator("option:checked")).toHaveText(/Sonnet.*Opus advisor/);
    await expect(chat(page).getByText(/the agent exited/)).toHaveCount(0);
    await pie(page).click();
    await expect(chat(page).getByRole("dialog")).toContainText("of the context window is in use");
    await chat(page).getByRole("button", { name: "Clear context" }).click();
    await expect(chat(page).getByText(/the agent exited/)).toHaveCount(0);
    await send(page, "Next one");
    await expect(chat(page).getByText("After the switch")).toBeVisible();
  });
});
