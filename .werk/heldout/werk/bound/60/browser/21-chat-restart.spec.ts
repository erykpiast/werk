import type { Page } from "@playwright/test";
import type { Script } from "../../src/fake-agent/script.ts";
import { expect, test } from "../../e2e/support/fixtures.ts";
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

async function withChat(
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
async function send(page: Page, text: string) {
  const composer = page.getByRole("textbox", { name: "Message" });
  await composer.fill(text);
  await composer.press("Enter");
}
const launches = (s: BrowserServer) =>
  s.launches().flatMap((r) => (r.kind === "launch" ? [r] : []));
const argsOf = (r: unknown) => (r as { args: string[] }).args;
const NOT_DELIVERED = "Your message was not delivered. Send it again.";

test("21.1 a conversation keeps its model and context fill across a server restart", async ({
  page,
}) => {
  await withChat(
    {
      roles: {
        chat: {
          replies: [
            [say("m1", "First answer", { input_tokens: 50000, output_tokens: 10000 })],
            [say("m2", "You asked: Remember this")],
          ],
        },
      },
    },
    async (server) => {
      await page.goto(server.url);
      const select = page.getByRole("combobox", { name: "Model" });
      await select.selectOption({ label: "Opus" });
      await send(page, "Remember this");
      await expect(chat(page).getByText("First answer")).toBeVisible();
      const pie = page.locator("[data-slot=context-pie]");
      const before = await pie.getAttribute("aria-label");
      expect(before).not.toBe("Context 0% full");
      await server.stop();
      await server.start();
      await page.goto(server.url);
      await expect(page.getByRole("combobox", { name: "Model" })).toHaveValue("opus");
      await expect(page.locator("[data-slot=context-pie]")).toHaveAttribute(
        "aria-label",
        before as string,
      );
      await send(page, "What did I ask you before?");
      await expect(chat(page).getByText("You asked: Remember this")).toBeVisible();
      const ls = launches(server);
      expect(ls).toHaveLength(2);
      const resumed = argsOf(ls[1]);
      expect(resumed).toContain("--resume");
      expect(resumed[resumed.indexOf("--resume") + 1]).toBe("fake-session-1");
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
            [say("m1", "Earlier answer")],
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
      await send(page, "Earlier question");
      await expect(chat(page).getByText("Earlier answer")).toBeVisible();
      await server.stop();
      await server.start();
      await page.goto(server.url);
      await send(page, "New question");
      await expect(chat(page).getByText("Answer in a new session")).toBeVisible({
        timeout: 20000,
      });
      await expect(chat(page).getByText(NOT_DELIVERED)).toHaveCount(0);
      const ls = launches(server);
      expect(ls).toHaveLength(3);
      expect(argsOf(ls[1])).toContain("--resume");
      expect(argsOf(ls[2])).not.toContain("--resume");
    },
  );
});

test("21.3 another crash retries once, asks to send again, shows the whole error", async ({
  page,
}) => {
  const err = "boom line one\nboom line two\nboom line three";
  await withChat(
    {
      roles: {
        chat: {
          replies: [
            [say("m1", "Earlier answer")],
            [{ stderr: err }, { crash: 1 }],
            [{ stderr: err }, { crash: 1 }],
            [say("m4", "Back again")],
          ],
        },
      },
    },
    async (server) => {
      await page.goto(server.url);
      await send(page, "Earlier question");
      await expect(chat(page).getByText("Earlier answer")).toBeVisible();
      await send(page, "Doomed question");
      await expect(chat(page).getByText(NOT_DELIVERED).first()).toBeVisible({
        timeout: 20000,
      });
      for (const l of ["boom line one", "boom line two", "boom line three"]) {
        await expect(chat(page).getByText(l).first()).toBeVisible();
      }
      // the first agent lives on and fails; werk starts one more, which fails; werk gives up
      expect(launches(server)).toHaveLength(2);
      await send(page, "Try again");
      await expect(chat(page).getByText("Back again")).toBeVisible({ timeout: 20000 });
      const ls = launches(server);
      const sessionOf = (r: unknown) => {
        const a = argsOf(r);
        return a.includes("--resume") ? a[a.indexOf("--resume") + 1] : null;
      };
      expect(sessionOf(ls[ls.length - 1])).toBe("fake-session-1");
    },
  );
});

test("21.4 a login problem shows its error at once with no retry", async ({
  page,
}) => {
  const err = "Not logged in\nPlease run claude auth login\nthen try again";
  await withChat(
    {
      roles: { chat: { replies: [[{ stderr: err }, { crash: 1 }]] } },
    },
    async (server) => {
      await page.goto(server.url);
      await send(page, "Hello");
      for (const l of ["Not logged in", "Please run claude auth login", "then try again"]) {
        await expect(chat(page).getByText(l).first()).toBeVisible({ timeout: 20000 });
      }
      expect(launches(server)).toHaveLength(1);
      await expect.soft(chat(page).getByText(NOT_DELIVERED).first()).toBeVisible();
    },
  );
});

test("21.5 model switch and clear context refuse during a turn and restart quietly when idle", async ({
  page,
}) => {
  await withChat(
    {
      roles: {
        chat: {
          replies: [
            [say("m1", "Working"), { pause: 4000 }, say("m2", "Finished long turn")],
            [say("m3", "Answer after clear")],
          ],
        },
      },
    },
    async (server) => {
      await page.goto(server.url);
      const select = page.getByRole("combobox", { name: "Model" });
      await select.selectOption({ label: "Sonnet" });
      await expect(select.locator("option:checked")).toHaveText("Sonnet");
      await expect(page.locator("[data-slot=context-pie]")).toHaveAttribute("data-level", "blue");
      await send(page, "Long one");
      await expect(chat(page).getByText("Working")).toBeVisible();
      // A person picks Opus while the turn runs.
      await select.selectOption({ label: "Opus" }, { force: true }).catch(() => {});
      await expect(select.locator("option:checked")).toHaveText("Sonnet");
      await expect(chat(page).getByText("Finished long turn")).toBeVisible({ timeout: 15000 });
      await select.selectOption({ value: "sonnet+opus" });
      await expect(select).toHaveValue("sonnet+opus");
      await expect.soft(select.locator("option:checked")).toHaveText("Sonnet with Opus advisor");
      await expect(page.getByText(/exited|crash|stopped/i)).toHaveCount(0);
      await page.locator("[data-slot=context-pie]").click();
      const dialog = page.getByRole("dialog", { name: "Context" });
      await expect(dialog).toContainText("%");
      await dialog.getByRole("button", { name: "Clear context" }).click();
      await expect(page.getByText(/exited|crash|stopped/i)).toHaveCount(0);
      await send(page, "After clear");
      await expect(chat(page).getByText("Answer after clear")).toBeVisible({ timeout: 20000 });
    },
  );
});
