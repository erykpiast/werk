import { appendFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "../../e2e/support/fixtures.ts";
import {
  type BrowserServer,
  startBrowserServer,
} from "../../e2e/support/server.ts";

type Script = NonNullable<Parameters<typeof startBrowserServer>[0]>["script"];

const say = (id: string, text: string, tokens?: number) => ({
  event: {
    type: "assistant",
    message: {
      id,
      content: [{ type: "text", text }],
      ...(tokens ? { usage: { input_tokens: tokens, output_tokens: 0 } } : {}),
    },
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
const model = (page: Page) => chat(page).getByLabel("Model");
const pie = (page: Page) =>
  chat(page).getByRole("button", { name: /^Context/ });
const NOT_DELIVERED = "Your message was not delivered. Send it again.";

async function send(page: Page, text: string) {
  const composer = page.getByRole("textbox", { name: "Message" });
  await composer.fill(text);
  await composer.press("Enter");
}
const launched = (server: BrowserServer) =>
  server.launches().flatMap((r) => (r.kind === "launch" ? [r.args] : []));
const messages = (server: BrowserServer) =>
  server.launches().flatMap((r) => (r.kind === "message" ? [r.text] : []));

function addCards(server: BrowserServer, cards: [string, string][]) {
  for (const [id, title] of cards) {
    appendFileSync(
      join(server.dir, ".werk", "log.jsonl"),
      `${JSON.stringify({ type: "node.proposed", id, kind: "card", title, status: "open", parent: "root" })}\n`,
    );
  }
}
const cardUrl = (server: BrowserServer, id: string) =>
  `${server.url}/map/${id}`;

const ERR = ["agent boom line one", "agent boom line two", "agent boom line three"];
const errText = ERR.join("\n");

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
      await expect(model(page)).toBeVisible();
      await model(page).selectOption({ label: "Opus" });
      await send(page, "Hello");
      await expect(chat(page).getByText("First answer")).toBeVisible();
      await expect(pie(page)).toHaveAttribute("aria-label", /Context [1-9]\d*% full/);
      const before = await pie(page).getAttribute("aria-label");
      await server.stop();
      await server.start();
      await page.goto(server.url);
      await expect(model(page).locator("option:checked")).toHaveText("Opus");
      await expect(pie(page)).toHaveAttribute("aria-label", before as string);
      await send(page, "What did I ask you before?");
      await expect(chat(page).getByText("You asked: Hello")).toBeVisible();
      const second = launched(server)[1] ?? [];
      expect(second[second.indexOf("--resume") + 1]).toBe("fake-session-1");
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
              { stderr: "No conversation found with session ID: fake-session-1" },
              { crash: 1 },
            ],
            [say("m3", "New session answer")],
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
      const launches = launched(server);
      expect(launches).toHaveLength(3);
      expect(launches[2]).not.toContain("--resume");
      expect(messages(server).filter((m) => m.endsWith("Second message"))).toHaveLength(2);
    },
  );
});

test("21.3 a crash with another error retries once, then asks the person to send again and shows the whole error", async ({
  page,
}) => {
  const crash = [{ stderr: errText }, { crash: 1 }];
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
      await send(page, "Hello");
      await expect(chat(page).getByText("First answer")).toBeVisible();
      await send(page, "Second message");
      await expect(chat(page).getByText(NOT_DELIVERED)).toBeVisible();
      expect(launched(server)).toHaveLength(2);
      for (const line of ERR) {
        await expect(chat(page).getByText(line, { exact: false }).first()).toBeVisible();
      }
      await send(page, "Second message");
      await expect(chat(page).getByText("Back again")).toBeVisible();
      const last = launched(server).at(-1) ?? [];
      expect(last[last.indexOf("--resume") + 1]).toBe("fake-session-1");
    },
  );
});

test("21.4 a login problem shows its error at once with no retry", async ({
  page,
}) => {
  const login = ["Not logged in", "Run claude auth login to sign in", "third login line"];
  await withChat(
    {
      roles: {
        chat: { replies: [[{ stderr: login.join("\n") }, { crash: 1 }], [say("m2", "x")]] },
      },
    },
    async (server) => {
      await page.goto(server.url);
      await send(page, "Hello");
      for (const line of login) {
        await expect(chat(page).getByText(line, { exact: false }).first()).toBeVisible();
      }
      expect(launched(server)).toHaveLength(1);
      await expect(chat(page).getByText(NOT_DELIVERED)).toBeVisible();
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
            [say("m1", "Long start"), { pause: 4000 }, say("m2", "Long end")],
            [say("m3", "After clear")],
          ],
        },
      },
    },
    async (server) => {
      await page.goto(server.url);
      await expect(model(page)).toBeVisible();
      await model(page).selectOption({ label: "Sonnet" });
      await expect(model(page).locator("option:checked")).toHaveText("Sonnet");
      await expect(pie(page)).toHaveAttribute("data-level", "blue");
      await send(page, "Make a long turn");
      await expect(chat(page).getByText("Long start")).toBeVisible();
      await model(page)
        .selectOption({ label: "Opus" }, { timeout: 2000 })
        .catch(() => {});
      await expect(model(page).locator("option:checked")).toHaveText("Sonnet");
      await expect(chat(page).getByText("Long end")).toBeVisible({ timeout: 15000 });
      // The step names the option "Sonnet with Opus advisor". Record a miss, then use the real option so the later checks still run.
      const named = await model(page)
        .selectOption({ label: "Sonnet with Opus advisor" }, { timeout: 3000 })
        .then(() => true)
        .catch(() => false);
      expect.soft(named, 'an option labelled "Sonnet with Opus advisor"').toBe(true);
      if (!named) await model(page).selectOption({ label: "Sonnet + Opus advisor" });
      await expect.soft(model(page).locator("option:checked")).toHaveText(
        "Sonnet with Opus advisor",
      );
      await expect(chat(page).getByText(NOT_DELIVERED)).toHaveCount(0);
      await expect(chat(page).getByRole("alert")).toHaveCount(0);
      await pie(page).click();
      const popover = chat(page).getByRole("dialog");
      await expect(popover).toContainText(/\d+%/);
      await popover.getByRole("button", { name: "Clear context" }).click();
      await expect(chat(page).getByText(NOT_DELIVERED)).toHaveCount(0);
      await expect(chat(page).getByRole("alert")).toHaveCount(0);
      await send(page, "Next one");
      await expect(chat(page).getByText("After clear")).toBeVisible();
    },
  );
});

test("23.1 two conversations with different home cards stay apart", async ({ page }) => {
  await withChat(
    {
      roles: {
        chat: {
          replies: [
            [say("a1", "Reply for A")],
            [say("b1", "Reply for B")],
            [{ ask: { id: "q1", tool: "AskUserQuestion", input: { questions: [{ question: "Which db?", header: "DB", multiSelect: false, options: [{ label: "Postgres", description: "SQL" }, { label: "SQLite", description: "file" }] }] } } }, say("a2", "Noted")],
          ],
        },
      },
    },
    async (server) => {
      addCards(server, [["a", "Card Alpha"], ["b", "Card Beta"]]);
      await page.goto(cardUrl(server, "a"));
      await expect(page.getByRole("heading", { level: 1, name: "Card Alpha" })).toBeVisible();
      await send(page, "Message in A");
      await expect(chat(page).getByText("Reply for A")).toBeVisible();
      await page.goto(cardUrl(server, "b"));
      await expect(page.getByRole("heading", { level: 1, name: "Card Beta" })).toBeVisible();
      await send(page, "Message in B");
      await expect(chat(page).getByText("Reply for B")).toBeVisible();
      const tabs = page.getByRole("tablist");
      await expect(tabs.getByRole("tab")).toHaveCount(2);
      await expect(tabs.getByRole("tab").nth(0)).toContainText("Card Alpha");
      await expect(tabs.getByRole("tab").nth(1)).toContainText("Card Beta");
    },
  );
});

test("23.2 switching to a tab shows its newest message", async ({ page }) => {
  const long = Array.from({ length: 40 }, (_, i) => say(`l${i}`, `Long line ${i}`));
  await withChat(
    {
      roles: {
        chat: {
          replies: [
            [say("a1", "Reply for A")],
            long,
            [say("b2", "Newest B reply")],
          ],
        },
      },
    },
    async (server) => {
      addCards(server, [["a", "Card Alpha"], ["b", "Card Beta"]]);
      await page.goto(cardUrl(server, "a"));
      await send(page, "Message in A");
      await expect(chat(page).getByText("Reply for A")).toBeVisible();
      await page.goto(cardUrl(server, "b"));
      await send(page, "Message in B");
      await expect(chat(page).getByText("Long line 39")).toBeVisible();
      const tabs = page.getByRole("tablist");
      await tabs.getByRole("tab", { name: /Card Alpha/ }).click();
      await tabs.getByRole("tab", { name: /Card Beta/ }).click();
      const scroller = chat(page).locator("[data-slot=chat-scroll]");
      await expect
        .poll(() =>
          scroller.evaluate((n) => n.scrollHeight - n.scrollTop - n.clientHeight),
        )
        .toBeLessThan(5);
    },
  );
});

test("23.3 a crashed agent marks its tab and tells the other tabs", async ({ page }) => {
  await withChat(
    {
      roles: {
        chat: {
          replies: [
            [say("a1", "Reply for A")],
            [say("b1", "Reply for B")],
            [{ stderr: errText }, { crash: 1 }],
            [{ stderr: errText }, { crash: 1 }],
            [say("a3", "A is back")],
          ],
        },
      },
    },
    async (server) => {
      addCards(server, [["a", "Card Alpha"], ["b", "Card Beta"]]);
      await page.goto(cardUrl(server, "a"));
      await send(page, "Message in A");
      await expect(chat(page).getByText("Reply for A")).toBeVisible();
      await page.goto(cardUrl(server, "b"));
      await send(page, "Message in B");
      await expect(chat(page).getByText("Reply for B")).toBeVisible();
      const tabs = page.getByRole("tablist");
      const chipA = tabs.getByRole("tab", { name: /Card Alpha/ });
      await expect(chipA).toBeVisible();
      await expect(chipA).toHaveAttribute("data-blink", "red");
      await expect(chat(page).getByText(/Card Alpha.*agent boom line one/)).toBeVisible();
    },
  );
});

test("23.4 a model switch is not a crash", async ({ page }) => {
  await withChat(
    {
      roles: {
        chat: { replies: [[say("m1", "First answer")], [say("m2", "Second answer")]] },
      },
    },
    async (server) => {
      await page.goto(server.url);
      await send(page, "Hello");
      await expect(chat(page).getByText("First answer")).toBeVisible();
      await model(page).selectOption({ label: "Opus" });
      await expect(model(page).locator("option:checked")).toHaveText("Opus");
      const chip = page.getByRole("tablist").getByRole("tab").first();
      await expect(chip).toBeVisible();
      await expect(chip).not.toHaveAttribute("data-blink", "red");
      await expect(chat(page).getByText(/agent .*(died|exited|crash)/i)).toHaveCount(0);
      await send(page, "Again");
      await expect(chat(page).getByText("Second answer")).toBeVisible();
    },
  );
});

test("23.5 a running background agent and a suggested next action", async ({ page }) => {
  const list = (ids: string[]) => ({
    event: { type: "system", subtype: "background_tasks", tasks: ids.map((id) => ({ id })) },
  });
  await withChat(
    {
      roles: {
        chat: {
          replies: [
            [list(["a"]), say("m1", "Started")],
            [list([]), say("m2", 'Done.\n\nNext: say "merge it"')],
            [say("m3", "Merged")],
          ],
        },
      },
    },
    async (server) => {
      await page.goto(server.url);
      await send(page, "Go");
      const line = chat(page).getByText("A background agent runs");
      await expect(line).toBeVisible();
      const chip = page.getByRole("tablist").getByRole("tab").first();
      await expect(chip).toHaveAttribute("data-running", "true");
      await send(page, "Status?");
      await expect(line).toHaveCount(0);
      await expect(chip).not.toHaveAttribute("data-running", "true");
      const offer = chat(page).getByRole("button", { name: "merge it" });
      await expect(offer).toBeVisible();
      await offer.click();
      await expect(chat(page).locator("article").filter({ hasText: "merge it" }).first()).toBeVisible();
      await expect(chat(page).getByText("Merged")).toBeVisible();
      await expect(offer).toHaveCount(0);
    },
  );
});
