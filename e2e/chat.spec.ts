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

const mkdirAsk = {
  id: "a1",
  tool: "Bash",
  input: { command: "mkdir -p /tmp/werk-e2e" },
  reason: "rule",
  suggestions: [
    {
      type: "addRules",
      behavior: "allow",
      destination: "session",
      rules: [{ toolName: "Bash", ruleContent: "mkdir:*" }],
    },
  ],
};

test("a permission ask holds the turn until Allow, and Always allow shows its rule", async ({
  page,
  evidence,
}) => {
  await withChat(
    {
      roles: { chat: { replies: [[{ ask: mkdirAsk }, say("m1", "Made it")]] } },
    },
    async (server) => {
      await page.goto(server.url);
      await send(page, "Make a folder");
      const bar = page.locator('[data-slot="ask-bar"]');
      await expect(bar).toContainText(
        "Bash wants to run. The turn is waiting.",
      );
      await expect(bar).toContainText("mkdir -p /tmp/werk-e2e");
      await expect(bar).toContainText("Claude Code could not decide: rule");
      await expect(
        bar.getByRole("button", { name: "Always allow Bash(mkdir:*)" }),
      ).toBeVisible();
      // The turn is open while the ask waits.
      const head = page.locator('[data-slot="chat-head"]');
      await expect(head).toHaveAttribute("data-busy", "true");
      await evidence(page, "chat-ask");
      await page.keyboard.press("Meta+Enter");
      await expect(bar).toBeHidden();
      await expect(head).not.toHaveAttribute("data-busy", "true");
      await expect(chat(page).getByText("Made it")).toBeVisible();
      // Cmd+Enter was the bar's, so the composer sent nothing.
      expect(messages(server)).toHaveLength(1);
    },
  );
});

test("a question form sends its picks as one line, and Escape denies a permission ask", async ({
  page,
}) => {
  const question = {
    id: "q1",
    tool: "AskUserQuestion",
    input: {
      questions: [
        {
          question: "Which db?",
          header: "DB",
          multiSelect: false,
          options: [
            { label: "Postgres", description: "SQL" },
            { label: "SQLite", description: "file" },
          ],
        },
      ],
    },
  };
  await withChat(
    {
      roles: {
        chat: {
          replies: [
            [{ ask: question }, say("m1", "Noted")],
            [{ ask: { ...mkdirAsk, suggestions: [] } }, say("m2", "Stopped")],
          ],
        },
      },
    },
    async (server) => {
      await page.goto(server.url);
      await send(page, "Pick a database");
      const bar = page.locator('[data-slot="ask-bar"]');
      await expect(bar).toContainText("A. Postgres");
      await expect(
        bar.getByRole("button", { name: "Submit answer" }),
      ).toBeDisabled();
      await bar.getByLabel(/B\. SQLite/).check();
      await bar.getByRole("button", { name: "Submit answer" }).click();
      await expect(bar).toBeHidden();
      await expect(chat(page).getByText("Noted")).toBeVisible();
      await send(page, "Make a folder");
      await expect(
        bar.getByRole("button", { name: /Always allow/ }),
      ).toHaveCount(0);
      await page.keyboard.press("Escape");
      await expect(chat(page).getByText("Stopped")).toBeVisible();
    },
  );
});

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/** Pastes one image into the composer, as a clipboard with one file. */
async function pasteImage(page: Page, bytes: "png" | number) {
  await page.getByRole("textbox", { name: "Message" }).focus();
  await page.evaluate(
    ({ base64, size }) => {
      const png = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const data = new Uint8Array(size ?? png.length);
      data.set(png);
      const transfer = new DataTransfer();
      transfer.items.add(new File([data], "shot.png", { type: "image/png" }));
      const event = new ClipboardEvent("paste", {
        clipboardData: transfer,
        bubbles: true,
        cancelable: true,
      });
      document.querySelector("textarea")?.dispatchEvent(event);
    },
    { base64: PNG_BASE64, size: bytes === "png" ? null : bytes },
  );
}

test("a pasted image shows a chip with a thumbnail, and the agent gets its path", async ({
  page,
}) => {
  await withChat(
    { roles: { chat: { replies: [[say("m1", "Seen")]] } } },
    async (server) => {
      await page.goto(server.url);
      await pasteImage(page, "png");
      const composer = page.getByRole("textbox", { name: "Message" });
      await expect(composer).toHaveValue("[Image #1]");
      const chip = page.getByRole("list", { name: "Attached images" });
      await expect(chip).toContainText("[Image #1]");
      const thumb = chip.getByRole("img");
      await expect(thumb).toBeVisible();
      await expect
        .poll(() => thumb.evaluate((img: HTMLImageElement) => img.naturalWidth))
        .toBeGreaterThan(0);
      await composer.pressSequentially(" why is it red?");
      await composer.press("Enter");
      await expect(chat(page).getByText("Seen")).toBeVisible();
      const [text] = messages(server);
      expect(text).toMatch(/\[Image #1\] = .*\.werk\/attachments\/.+\.png/);
      expect(text).toContain("Open each image above with Read");
      expect(text).toMatch(/\[Image #1\] why is it red\?$/);
      expect(text).not.toContain(PNG_BASE64);
    },
  );
});

test("a 25 MB image shows its refusal on the chip and is not sent", async ({
  page,
}) => {
  await withChat(
    { roles: { chat: { replies: [[say("m1", "Ok")]] } } },
    async (server) => {
      await page.goto(server.url);
      await pasteImage(page, 25 * 1024 * 1024);
      const chip = page.getByRole("list", { name: "Attached images" });
      await expect(chip.getByRole("alert")).toContainText("20 MB");
      await send(page, "hello");
      await expect(chat(page).getByText("Ok")).toBeVisible();
      const [text] = messages(server);
      expect(text).not.toContain("[Image");
      expect(text).toMatch(/hello$/);
    },
  );
});

test("removing chip 1 of two renumbers the other to [Image #1]", async ({
  page,
}) => {
  await withChat({}, async (server) => {
    await page.goto(server.url);
    await pasteImage(page, "png");
    await pasteImage(page, "png");
    const composer = page.getByRole("textbox", { name: "Message" });
    await expect(composer).toHaveValue("[Image #1][Image #2]");
    const chips = page.getByRole("list", { name: "Attached images" });
    await expect(chips.getByRole("img")).toHaveCount(2);
    await chips.getByRole("button", { name: "Remove [Image #1]" }).click();
    await expect(composer).toHaveValue("[Image #1]");
    await expect(chips).toContainText("[Image #1]");
    await expect(chips).not.toContainText("[Image #2]");
  });
});

test("a slash opens the commands the agent named, and a hash opens the card search", async ({
  page,
}) => {
  const start = {
    event: {
      type: "system",
      subtype: "init",
      slash_commands: ["review", "recall"],
    },
  };
  await withChat(
    { roles: { chat: { replies: [[start, say("m1", "Hello")]] } } },
    async (server) => {
      await page.goto(server.url);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await send(page, "hi");
      await expect(chat(page).getByText("Hello")).toBeVisible();

      const composer = page.getByRole("textbox", { name: "Message" });
      await composer.pressSequentially("run /re");
      await expect(page.getByRole("option")).toHaveText(["/review", "/recall"]);
      await composer.press("Enter");
      await expect(composer).toHaveValue("run /review ");

      await composer.fill("`#ro");
      await expect(page.getByRole("listbox")).toHaveCount(0);
      await composer.fill("see #ro");
      await expect(page.getByRole("option").first()).toContainText("#root");
      await composer.press("Enter");
      await expect(composer).toHaveValue("see #root ");
    },
  );
});
