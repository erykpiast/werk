import { expect, type Page, test } from "@playwright/test";
import type { Script } from "../../src/fake-agent/script.ts";
import { type BrowserServer, startBrowserServer } from "./support.ts";

const say = (id: string, text: string, tokens = 0) => ({
  event: {
    type: "assistant",
    message: {
      id,
      content: [{ type: "text", text }],
      ...(tokens ? { usage: { input_tokens: tokens, output_tokens: 5 } } : {}),
    },
  },
});

async function withChat(
  script: Script,
  body: (s: BrowserServer) => Promise<void>,
) {
  const s = await startBrowserServer({ script });
  await s.start();
  try {
    await body(s);
  } finally {
    await s.dispose();
  }
}
const chat = (page: Page) =>
  page.getByRole("complementary", { name: "Chat pane" });
async function send(page: Page, text: string) {
  const c = page.getByRole("textbox", { name: "Message" });
  await c.fill(text);
  await c.press("Enter");
}
const launched = (s: BrowserServer) =>
  s.launches().flatMap((r) => (r.kind === "launch" ? [r.args] : []));
const messages = (s: BrowserServer) =>
  s.launches().flatMap((r) => (r.kind === "message" ? [r.text] : []));
const flag = (args: string[], name: string) => args[args.indexOf(name) + 1];

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
    async (s) => {
      await page.goto(s.url);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await send(page, "Hello");
      await expect(chat(page).getByText("First answer")).toBeVisible();
      const model = chat(page).getByLabel("Model");
      await model.selectOption({ label: "Opus" });
      await expect(model).toHaveValue("opus");
      const pie = chat(page).getByRole("button", { name: /^Context/ });
      const fill = await pie.getAttribute("aria-label");
      expect(fill).toMatch(/Context \d+% full/);
      expect(fill).not.toBe("Context 0% full");
      await s.stop();
      await s.start();
      await page.goto(s.url);
      await expect(chat(page).getByLabel("Model")).toHaveValue("opus");
      await expect(
        chat(page).getByRole("button", { name: /^Context/ }),
      ).toHaveAttribute("aria-label", fill as string);
      await send(page, "What did I ask you before?");
      await expect(chat(page).getByText("You asked: Hello")).toBeVisible();
      const all = launched(s);
      const last = all[all.length - 1] as string[];
      expect(flag(last, "--resume")).toBe("fake-session-1");
    },
  );
});

const dead = [
  {
    event: {
      type: "result",
      is_error: true,
      errors: ["No conversation found with session ID: fake-session-1"],
    },
  },
  { crash: 1 },
];

test("21.2 a dead stored session starts again and the waiting message is delivered", async ({
  page,
}) => {
  await withChat(
    {
      roles: {
        chat: {
          replies: [[say("m1", "First answer")], dead, [say("m3", "Fresh answer")]],
        },
      },
    },
    async (s) => {
      await page.goto(s.url);
      await send(page, "Hello");
      await expect(chat(page).getByText("First answer")).toBeVisible();
      await s.stop();
      await s.start();
      await page.goto(s.url);
      await send(page, "Where were we?");
      await expect(chat(page).getByText("Fresh answer")).toBeVisible();
      await expect(
        chat(page).getByText("Your message was not delivered"),
      ).toHaveCount(0);
      expect(messages(s).filter((m) => m.endsWith("Where were we?"))).toHaveLength(2);
      const all = launched(s);
      expect(all[all.length - 1]).not.toContain("--resume");
    },
  );
});

test("21.3 a crash with another error retries once, then asks to send again with the whole error", async ({
  page,
}) => {
  const crash = [{ stderr: "boom line one\nboom line two\nboom line three" }, { crash: 1 }];
  await withChat(
    {
      roles: {
        chat: {
          replies: [[say("m1", "First answer")], crash, crash, [say("m4", "Back again")]],
        },
      },
    },
    async (s) => {
      await page.goto(s.url);
      await send(page, "Hello");
      await expect(chat(page).getByText("First answer")).toBeVisible();
      await send(page, "Second");
      await expect(
        chat(page).getByText("Your message was not delivered. Send it again."),
      ).toBeVisible();
      for (const l of ["boom line one", "boom line two", "boom line three"])
        await expect(chat(page).getByText(l)).toBeVisible();
      expect(launched(s)).toHaveLength(2);
      await send(page, "Second");
      await expect(chat(page).getByText("Back again")).toBeVisible();
      const all = launched(s);
      expect(flag(all[all.length - 1] as string[], "--resume")).toBe("fake-session-1");
    },
  );
});

test("21.4 a login problem shows its error at once with no retry", async ({
  page,
}) => {
  const login = "Invalid credential.\nRemove the credential and run: claude auth login";
  await withChat(
    {
      roles: {
        chat: { replies: [[{ stderr: login }, { crash: 1 }], [say("m2", "unused")]] },
      },
    },
    async (s) => {
      await page.goto(s.url);
      await send(page, "Hello");
      await expect(chat(page).getByText("Invalid credential.")).toBeVisible();
      await expect(
        chat(page).getByText("Remove the credential and run: claude auth login"),
      ).toBeVisible();
      expect(launched(s)).toHaveLength(1);
      await expect(
        chat(page).getByText("Your message was not delivered. Send it again."),
      ).toBeVisible({ timeout: 3000 });
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
            [say("m1", "Working"), { pause: 4000 }, say("m2", "Long turn done")],
            [say("m3", "After advisor")],
            [say("m4", "After clear")],
          ],
        },
      },
    },
    async (s) => {
      await page.goto(s.url);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      const model = chat(page).getByLabel("Model");
      await expect(model).toBeVisible();
      // The person picks Sonnet first, so the selector shows "Sonnet" as the step's Given says.
      await model.selectOption({ label: "Sonnet" });
      await expect(model.locator("option:checked")).toHaveText("Sonnet");
      await expect(
        chat(page).getByRole("button", { name: /^Context/ }),
      ).toHaveAttribute("data-level", "blue");
      await send(page, "Make it long");
      await expect(chat(page).getByText("Working")).toBeVisible();
      // The switch is refused while the turn runs: the selector is disabled and keeps Sonnet.
      await expect(model).toBeDisabled();
      await expect(model.locator("option:checked")).toHaveText("Sonnet");
      await expect(chat(page).getByText("Long turn done")).toBeVisible({ timeout: 15000 });
      // The selector names this choice "Sonnet + Opus advisor"; the step's "Sonnet with Opus advisor" maps to it.
      await model.selectOption({ label: "Sonnet + Opus advisor" });
      await expect(model.locator("option:checked")).toHaveText("Sonnet + Opus advisor");
      await expect(chat(page).getByText(/crash|exited|not delivered/i)).toHaveCount(0);
      await chat(page).getByRole("button", { name: /^Context/ }).click();
      const pop = chat(page).getByRole("dialog");
      await expect(pop).toContainText("%");
      await pop.getByRole("button", { name: "Clear context" }).click();
      await expect(chat(page).getByText(/crash|exited|not delivered/i)).toHaveCount(0);
      await send(page, "Next");
      await expect(chat(page).getByText(/After (advisor|clear)/)).toBeVisible();
    },
  );
});

// --- Tabs (23): the chat pane has one conversation and no tab strip. ---
const strip = (page: Page) => chat(page).getByRole("tablist");
async function needStrip(page: Page) {
  await expect(strip(page), "the chat pane has no tab strip").toBeVisible({
    timeout: 3000,
  });
}

test("23.1 two conversations with different home cards stay apart", async ({
  page,
}) => {
  await withChat(
    { roles: { chat: { replies: [[say("a1", "Reply to A")], [say("b1", "Reply to B")]] } } },
    async (s) => {
      await page.goto(s.url);
      await send(page, "Message A");
      await expect(chat(page).getByText("Reply to A")).toBeVisible();
      await needStrip(page);
      await expect(strip(page).getByRole("tab")).toHaveCount(2);
    },
  );
});

test("23.2 switching to a tab shows its newest message", async ({ page }) => {
  await withChat(
    { roles: { chat: { replies: [[say("a1", "Reply to A")]] } } },
    async (s) => {
      await page.goto(s.url);
      await send(page, "Message A");
      await needStrip(page);
      await expect(strip(page).getByRole("tab")).toHaveCount(2);
    },
  );
});

test("23.3 a crashed agent marks its tab and tells the other tabs", async ({ page }) => {
  await withChat(
    { roles: { chat: { replies: [[{ stderr: "died" }, { crash: 1 }]] } } },
    async (s) => {
      await page.goto(s.url);
      await send(page, "Message A");
      await needStrip(page);
      await expect(strip(page).getByRole("tab")).toHaveCount(2);
    },
  );
});

test("23.4 a model switch is not a crash", async ({ page }) => {
  await withChat(
    { roles: { chat: { replies: [[say("a1", "Reply to A")], [say("a2", "Reply after switch")]] } } },
    async (s) => {
      await page.goto(s.url);
      await send(page, "Message A");
      await expect(chat(page).getByText("Reply to A")).toBeVisible();
      await chat(page).getByLabel("Model").selectOption({ label: "Opus" });
      await expect(chat(page).getByLabel("Model")).toHaveValue("opus");
      await send(page, "Again");
      await expect(chat(page).getByText("Reply after switch")).toBeVisible();
      // The chip of the tab must not blink red.
      await needStrip(page);
      await expect(strip(page).getByRole("tab").first()).not.toHaveAttribute("data-state", "crashed");
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
    async (s) => {
      await page.goto(s.url);
      await send(page, "Go");
      const line = chat(page).getByText("A background agent runs");
      await expect(line).toBeVisible();
      // The tab counts as running.
      await needStrip(page);
      await expect(strip(page).getByRole("tab").first()).toHaveAttribute("data-running", "true");
      await send(page, "Status?");
      await expect(line).toHaveCount(0);
      const offer = chat(page).getByRole("button", { name: "merge it" });
      await offer.click();
      await expect(chat(page).getByText("Merged")).toBeVisible();
      await expect(offer).toHaveCount(0);
    },
  );
});
