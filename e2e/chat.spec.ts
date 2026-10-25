import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import type { Script } from "../src/fake-agent/script.ts";
import { expect, test } from "./support/fixtures.ts";
import { type BrowserServer, startBrowserServer } from "./support/server.ts";

const FIXTURE_LOG = readFileSync(
  join(import.meta.dirname, "fixtures", "project", ".werk", "log.jsonl"),
  "utf8",
);

const say = (id: string, text: string) => ({
  event: {
    type: "assistant",
    message: { id, content: [{ type: "text", text }] },
  },
});
const tool = (id: string, name: string, command: string) => ({
  event: {
    type: "assistant",
    message: {
      id,
      content: [{ type: "tool_use", id: `u-${id}`, name, input: { command } }],
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

async function send(page: Page, text: string) {
  const composer = page.getByRole("textbox", { name: "Message" });
  await composer.fill(text);
  await composer.press("Enter");
}

const messages = (server: BrowserServer) =>
  server.launches().flatMap((r) => (r.kind === "message" ? [r.text] : []));

test("a message goes with the open card, and the next one with the reminder", async ({
  page,
}) => {
  await withChat(
    {
      roles: {
        chat: {
          replies: [[say("m1", "First answer")], [say("m2", "Second answer")]],
        },
      },
    },
    async (server) => {
      await page.goto(server.url);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await send(page, "What is open?");
      await expect(chat(page).getByText("First answer")).toBeVisible();
      await send(page, "And now?");
      await expect(chat(page).getByText("Second answer")).toBeVisible();

      const [first, second] = messages(server);
      expect(first).toContain(
        "[the map is now at #root — We build software with agents]",
      );
      expect(first).toContain(
        "why: One repeating pipeline keeps the work in step.",
      );
      expect(first).toMatch(/What is open\?$/);
      expect(second).toMatch(
        /^\[still on #root — We build software with agents\]/,
      );
    },
  );
});

test("a card that the agent adds appears in the map while the reply streams", async ({
  page,
  evidence,
}) => {
  const added = `${FIXTURE_LOG}${JSON.stringify({
    type: "node.proposed",
    id: "seats",
    kind: "card",
    title: "We charge per seat",
    status: "open",
    parent: "root",
  })}\n`;
  await withChat(
    {
      roles: {
        chat: {
          replies: [
            [
              say("m1", "Adding the card"),
              { edit: ".werk/log.jsonl", content: added },
              { pause: 4000 },
              say("m2", "Done"),
            ],
          ],
        },
      },
    },
    async (server) => {
      await page.goto(server.url);
      await send(page, "Add a seat card");
      await expect(
        page
          .getByRole("region", { name: "Map pane" })
          .getByText("We charge per seat"),
      ).toBeVisible();
      await expect(chat(page).getByText("Adding the card")).toBeVisible();
      await expect(chat(page).getByText("Done")).toBeHidden();
      await expect(chat(page).getByText("Done")).toBeVisible({
        timeout: 15000,
      });
      await evidence(page, "chat-add");
    },
  );
});

test("a message sent during a reply waits, and the first reply stays above it", async ({
  page,
  evidence,
}) => {
  await withChat(
    {
      roles: {
        chat: {
          replies: [
            [say("m1", "Part one"), { pause: 2500 }, say("m2", "Part two")],
            [say("m3", "Reply to B")],
          ],
        },
      },
    },
    async (server) => {
      await page.goto(server.url);
      await send(page, "Message A");
      await expect(chat(page).getByText("Part one")).toBeVisible();
      await send(page, "Message B");
      const waiting = chat(page).getByText("waits for the reply above");
      await expect(waiting).toBeVisible();
      await evidence(page, "chat-waiting");

      await expect(chat(page).getByText("Part two")).toBeVisible({
        timeout: 15000,
      });
      await expect(chat(page).getByText("Reply to B")).toBeVisible({
        timeout: 15000,
      });
      await expect(waiting).toBeHidden();

      const turns = chat(page).locator("article");
      await expect(turns).toHaveCount(2);
      await expect(turns.nth(0)).toContainText("Message A");
      await expect(turns.nth(0)).toContainText("Part one");
      await expect(turns.nth(0)).toContainText("Part two");
      await expect(turns.nth(0)).not.toContainText("Reply to B");
      await expect(turns.nth(1)).toContainText("Reply to B");
    },
  );
});

test("three tool calls in a row show as one collapsed line with the count 3", async ({
  page,
  evidence,
}) => {
  await withChat(
    {
      roles: {
        chat: {
          replies: [
            [
              tool("a", "Bash", "ls"),
              tool("b", "Read", "a.ts"),
              tool("c", "Bash", "git status"),
              say("d", "Checked"),
            ],
          ],
        },
      },
    },
    async (server) => {
      await page.goto(server.url);
      await send(page, "Look around");
      await expect(chat(page).getByText("Checked")).toBeVisible();
      const runs = chat(page).locator("details[data-slot=tool-run]");
      await expect(runs).toHaveCount(1);
      await expect(runs.locator("[data-slot=tool-count]")).toHaveText("3");
      await expect(runs.locator("[data-slot=tool-latest]")).toContainText(
        "git status",
      );
      await expect(runs).not.toHaveAttribute("open", "");
      await evidence(page, "chat-tools");
    },
  );
});

test("the header row sits right above the composer, and the end line shows the duration", async ({
  page,
}) => {
  await withChat(
    {
      roles: {
        chat: {
          replies: [
            [
              say("m1", "Hi"),
              {
                event: {
                  type: "result",
                  duration_ms: 1200,
                  total_cost_usd: 0.04,
                },
              },
            ],
          ],
        },
      },
    },
    async (server) => {
      await page.goto(server.url);
      await send(page, "Hello");
      await expect(chat(page).getByText("1s · $0.04")).toBeVisible();
      const head = await chat(page)
        .locator("[data-slot=chat-head]")
        .boundingBox();
      const composer = await page
        .getByRole("textbox", { name: "Message" })
        .boundingBox();
      expect(
        head &&
          composer &&
          head.y < composer.y &&
          composer.y - (head.y + head.height) < 12,
      ).toBe(true);
    },
  );
});

test("a send without the token is refused", async ({ page, app }) => {
  await page.goto(app.url);
  const res = await page.request.post(
    `${app.origin}/api/projects/project/chat`,
    {
      data: { text: "hello", card: null, turn: "t1" },
    },
  );
  expect(res.status()).toBe(403);
});
