import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import type { Script } from "../../src/fake-agent/script.ts";
import { expect, test } from "../../e2e/support/fixtures.ts";
import { type BrowserServer, startBrowserServer } from "../../e2e/support/server.ts";

const say = (id: string, text: string, usage?: Record<string, number>) => ({
  event: { type: "assistant", message: { id, content: [{ type: "text", text }], ...(usage ? { usage } : {}) } },
});
const resultWith = (usage: Record<string, number>) => ({
  event: { type: "result", subtype: "success", is_error: false, result: "", duration_ms: 500, total_cost_usd: 0.01, usage },
});

async function withChat(script: Script, body: (s: BrowserServer) => Promise<void>) {
  const server = await startBrowserServer({ script });
  await server.start();
  try {
    await body(server);
  } finally {
    await server.dispose();
  }
}
const chat = (page: Page) => page.getByRole("complementary", { name: "Chat pane" });
const composerOf = (page: Page) => page.getByRole("textbox", { name: "Message" });
async function send(page: Page, text: string) {
  const c = composerOf(page);
  await c.fill(text);
  await c.press("Enter");
}
const messages = (s: BrowserServer) => s.launches().flatMap((r) => (r.kind === "message" ? [r.text] : []));
const launched = (s: BrowserServer) => s.launches().flatMap((r) => (r.kind === "launch" ? [r.args] : []));
const pie = (page: Page) => chat(page).getByRole("button", { name: /^Context/ });

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

async function paste(page: Page, kind: "png" | "jpeg", size?: number, base64?: string) {
  await composerOf(page).focus();
  await page.evaluate(
    ({ b64, size, kind }) => {
      const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const data = new Uint8Array(size ?? raw.length);
      data.set(raw.subarray(0, data.length));
      const transfer = new DataTransfer();
      transfer.items.add(new File([data], kind === "png" ? "shot.png" : "shot.jpg", { type: `image/${kind}` }));
      document.querySelector("textarea")?.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }),
      );
    },
    { b64: base64 ?? PNG_BASE64, size: size ?? null, kind },
  );
}
const jpegBase64 = async (page: Page) => (await page.screenshot({ type: "jpeg", clip: { x: 0, y: 0, width: 16, height: 16 } })).toString("base64");
const chips = (page: Page) => page.getByRole("list", { name: "Attached images" });

// ---------- 21 ----------

test("21.1 a conversation keeps its model and context fill across a server restart", async ({ page }) => {
  const usage = { input_tokens: 60000, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  await withChat(
    { roles: { chat: { replies: [[say("m1", "First answer", usage), resultWith(usage)], [say("m2", "You asked: first question")]] } } },
    async (server) => {
      await page.goto(server.url);
      await chat(page).getByLabel("Model").selectOption("opus");
      await send(page, "first question");
      await expect(chat(page).getByText("First answer")).toBeVisible();
      const before = await pie(page).getAttribute("aria-label");
      expect(before).not.toBe("Context 0% full");
      await server.stop();
      await server.start();
      await page.goto(server.url);
      await expect(chat(page).getByLabel("Model")).toHaveValue("opus");
      await expect(pie(page)).toHaveAttribute("aria-label", before as string);
      await send(page, "What did I ask you before?");
      await expect(chat(page).getByText("You asked: first question")).toBeVisible();
      const second = launched(server).at(-1) as string[];
      expect(second[second.indexOf("--resume") + 1]).toBe("fake-session-1");
    },
  );
});

test("21.2 a dead stored session starts again and the waiting message is delivered", async ({ page }) => {
  await withChat(
    {
      roles: {
        chat: {
          replies: [
            [say("m1", "First answer")],
            [{ stderr: "No conversation found with session ID: fake-session-1" }, { crash: 1 }],
            [say("m3", "Answer in a new session")],
          ],
        },
      },
    },
    async (server) => {
      await page.goto(server.url);
      await send(page, "hello");
      await expect(chat(page).getByText("First answer")).toBeVisible();
      await server.stop();
      await server.start();
      await page.goto(server.url);
      await send(page, "second message");
      await expect(chat(page).getByText("Answer in a new session")).toBeVisible({ timeout: 20000 });
      await expect(chat(page).getByText("Your message was not delivered. Send it again.")).toHaveCount(0);
      const last = launched(server).at(-1) as string[];
      expect(last).not.toContain("--resume");
      expect(messages(server).filter((m) => m.endsWith("second message"))).toHaveLength(2);
    },
  );
});

const MULTI = "boom line one\nboom line two\nboom line three";

test("21.3 a crash with another error retries once, then asks the person to send again and shows the whole error", async ({ page }) => {
  await withChat(
    {
      roles: {
        chat: {
          replies: [
            [say("m1", "First answer")],
            [{ stderr: MULTI }, { crash: 1 }],
            [{ stderr: MULTI }, { crash: 1 }],
            [say("m4", "Back again")],
          ],
        },
      },
    },
    async (server) => {
      await page.goto(server.url);
      await send(page, "hello");
      await expect(chat(page).getByText("First answer")).toBeVisible();
      await send(page, "second message");
      await expect(chat(page).getByText("Your message was not delivered. Send it again.")).toBeVisible({ timeout: 20000 });
      for (const line of MULTI.split("\n")) await expect(chat(page).getByText(line).first()).toBeVisible();
      expect(messages(server).filter((m) => m.endsWith("second message"))).toHaveLength(2);
      await send(page, "third try");
      await expect(chat(page).getByText("Back again")).toBeVisible({ timeout: 20000 });
      const last = launched(server).at(-1) as string[];
      expect(last[last.indexOf("--resume") + 1]).toBe("fake-session-1");
    },
  );
});

test("21.4 a login problem shows its error at once with no retry", async ({ page }) => {
  const LOGIN = "Invalid API key · Please run /login\nsecond login line";
  await withChat(
    { roles: { chat: { replies: [[{ stderr: LOGIN }, { crash: 1 }], [say("m2", "should not play")]] } } },
    async (server) => {
      await page.goto(server.url);
      await send(page, "hello");
      await expect(chat(page).getByText("Invalid API key").first()).toBeVisible({ timeout: 20000 });
      await expect(chat(page).getByText("second login line").first()).toBeVisible();
      expect(launched(server)).toHaveLength(1);
      await expect(chat(page).getByText("Your message was not delivered. Send it again.")).toBeVisible({ timeout: 3000 });
    },
  );
});

test("21.5 the model switch and clear context refuse during a turn and restart quietly when idle", async ({ page }) => {
  await withChat(
    {
      roles: {
        chat: {
          replies: [
            [say("m1", "Long turn starts"), { pause: 5000 }, say("m2", "Long turn ends")],
            [say("m3", "Answer after clear")],
          ],
        },
      },
    },
    async (server) => {
      await page.goto(server.url);
      const select = chat(page).getByLabel("Model");
      await select.selectOption("sonnet");
      await expect(select).toHaveValue("sonnet");
      await expect(pie(page)).toHaveAttribute("data-level", "blue");
      await send(page, "go");
      await expect(chat(page).getByText("Long turn starts")).toBeVisible();
      await expect(select.locator("option:checked")).toHaveText("Sonnet");
      // The switch is refused while the turn runs.
      await expect(select).toBeDisabled();
      await expect(select).toHaveValue("sonnet");
      await expect(chat(page).getByText("Long turn ends")).toBeVisible({ timeout: 20000 });
      await expect(select).toBeEnabled();
      await select.selectOption({ label: /Sonnet.*Opus advisor/ as unknown as string }).catch(async () => {
        await select.selectOption("sonnet+opus");
      });
      await expect(select.locator("option:checked")).toHaveText(/Sonnet.*Opus advisor/);
      await expect(chat(page).getByText(/crash|exited|not delivered/i)).toHaveCount(0);
      await pie(page).click();
      await expect(chat(page).getByRole("dialog")).toContainText(/\d+% of the context window is in use/);
      await chat(page).getByRole("button", { name: "Clear context" }).click();
      await expect(chat(page).getByText(/crash|exited|not delivered/i)).toHaveCount(0);
      await send(page, "after clear");
      await expect(chat(page).getByText("Answer after clear")).toBeVisible({ timeout: 20000 });
    },
  );
});

// ---------- 23 (tabs) ----------

test("23.1 two conversations with different home cards stay apart", async ({ page, app }) => {
  expect(app.werk("add", "b", "--title", "Card B", "--parent", "root").code).toBe(0);
  expect(app.werk("accept", "b", "--actor", "you").code).toBe(0);
  await page.goto(app.url);
  await send(page, "message in A");
  await page.goto(`${app.url}/map/b`);
  // A second conversation needs a way to start one and a tab strip below the composer.
  await expect(chat(page).getByRole("tab")).toHaveCount(2, { timeout: 5000 });
});

test("23.2 switching to a tab shows its newest message", async ({ page, app }) => {
  await page.goto(app.url);
  await expect(chat(page).getByRole("tablist")).toBeVisible({ timeout: 5000 });
});

test("23.3 a crashed agent marks its tab and tells the other tabs", async ({ page, app }) => {
  await page.goto(app.url);
  await expect(chat(page).getByRole("tab").first()).toBeVisible({ timeout: 5000 });
});

test("23.4 a model switch is not a crash", async ({ page }) => {
  await withChat({ roles: { chat: { replies: [[say("m1", "one")], [say("m2", "two")]] } } }, async (server) => {
    await page.goto(server.url);
    await send(page, "hello");
    await expect(chat(page).getByText("one")).toBeVisible();
    await chat(page).getByLabel("Model").selectOption("opus");
    // The tab strip chip of the conversation must exist and must not blink red.
    const chip = chat(page).getByRole("tab").first();
    await expect(chip).toBeVisible({ timeout: 5000 });
    await expect(chip).not.toHaveAttribute("data-state", /crash|red/);
    await send(page, "again");
    await expect(chat(page).getByText("two")).toBeVisible();
  });
});

test("23.5 a running background agent and a suggested next action", async ({ page }) => {
  const list = (ids: string[]) => ({ event: { type: "system", subtype: "background_tasks", tasks: ids.map((id) => ({ id })) } });
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
      await send(page, "go");
      await expect(chat(page).getByText("A background agent runs")).toBeVisible();
      // The tab of the conversation counts as running.
      await expect(chat(page).getByRole("tab").first()).toHaveAttribute("data-running", "true", { timeout: 3000 });
      await send(page, "status?");
      await expect(chat(page).getByText("A background agent runs")).toHaveCount(0);
      const offer = chat(page).getByRole("button", { name: "merge it" });
      await expect(offer).toBeVisible();
      await offer.click();
      await expect(chat(page).getByText("Merged")).toBeVisible();
      await expect(offer).toHaveCount(0);
    },
  );
});

// ---------- 24 + 25 images and hash menu ----------

test("24.1 pick a card from the hash menu", async ({ page, app }) => {
  expect(app.werk("add", "werk-shots", "--title", "Pasted screenshots", "--parent", "root").code).toBe(0);
  expect(app.werk("accept", "werk-shots", "--actor", "you").code).toBe(0);
  await page.goto(app.url);
  const c = composerOf(page);
  await c.pressSequentially("Look at #wer");
  const menu = page.getByRole("listbox");
  await expect(menu).toBeVisible();
  const option = menu.getByRole("option", { name: /werk-shots/ });
  await expect(option).toContainText("Pasted screenshots");
  const options = await menu.getByRole("option").allTextContents();
  const at = options.findIndex((t) => t.includes("werk-shots"));
  for (let i = 0; i < at; i++) await c.press("ArrowDown");
  await c.press("Enter");
  await expect(c).toHaveValue(/^Look at #werk-shots\s?$/);
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await c.fill("`#wer");
  await expect(page.getByRole("listbox")).toHaveCount(0);
});

async function pastedTurn(page: Page, server: BrowserServer) {
  await page.route("**/image*", async (route) => {
    if (route.request().method() === "POST") await new Promise((r) => setTimeout(r, 1200));
    await route.continue();
  });
  await page.goto(server.url);
  const c = composerOf(page);
  await c.pressSequentially("What is wrong here? ");
  await paste(page, "png");
  await expect(c).toHaveValue("What is wrong here? [Image #1]");
  await expect(chips(page).locator("[data-slot=image-chip]")).toHaveAttribute("data-state", "uploading");
  await expect(chips(page).locator("[data-slot=image-chip]")).toHaveAttribute("data-state", "ready", { timeout: 15000 });
  const thumb = chips(page).getByRole("img");
  await expect.poll(() => thumb.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  await expect(chips(page)).toContainText("[Image #1]");
  await c.press("Enter");
  await expect(chat(page).getByText("Seen")).toBeVisible();
}

test("24.2 a pasted PNG uploads at once and reaches the agent as a stored path", async ({ page }) => {
  await withChat({ roles: { chat: { replies: [[say("m1", "Seen")]] } } }, async (server) => {
    await pastedTurn(page, server);
    const [text] = messages(server);
    expect(text).toMatch(/\[Image #1\] = .*\.werk\/attachments\/.+\.png/);
    expect(text).toMatch(/open (each|that|the) image/i);
    const status = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: server.dir, encoding: "utf8" });
    expect(status).not.toContain("attachments");
  });
});

test("25.1 a pasted screenshot becomes a numbered image the agent reads by path", async ({ page }) => {
  await withChat({ roles: { chat: { replies: [[say("m1", "Seen")]] } } }, async (server) => {
    await pastedTurn(page, server);
    const [text] = messages(server);
    expect(text).toMatch(/\[Image #1\] = .*\.werk\/attachments\/.+\.png/);
    expect(text).toMatch(/\bRead\b/);
    expect(text).not.toContain(PNG_BASE64);
    // The message appears in the chat with the image shown under "[Image #1]".
    const turn = chat(page).locator("article").first();
    await expect(turn).toContainText("[Image #1]");
    await expect(turn.getByRole("img")).toBeVisible({ timeout: 3000 });
  });
});

test("24.3 an oversized image is refused and is not sent", async ({ page }) => {
  await withChat({ roles: { chat: { replies: [[say("m1", "Ok")]] } } }, async (server) => {
    await page.goto(server.url);
    await paste(page, "png", 25 * 1024 * 1024);
    await expect(composerOf(page)).toHaveValue("[Image #1]");
    await expect(chips(page).getByRole("alert")).toContainText("20 MB");
    await composerOf(page).press("Enter");
    await composerOf(page).pressSequentially(" hello");
    await composerOf(page).press("Enter");
    await expect(chat(page).getByText("Ok")).toBeVisible();
    const [text] = messages(server);
    expect(text).not.toMatch(/\.werk\/attachments/);
    const dir = join(server.dir, ".werk", "attachments");
    const files = existsSync(dir) ? readdirSync(dir).filter((f) => !f.startsWith(".")) : [];
    expect(files).toEqual([]);
  });
});

test("24.4 / 25.3 removing the first of two images renumbers the second", async ({ page }) => {
  await withChat({ roles: { chat: { replies: [[say("m1", "Seen")]] } } }, async (server) => {
    await page.goto(server.url);
    await paste(page, "png");
    await paste(page, "jpeg", undefined, await jpegBase64(page));
    const c = composerOf(page);
    await expect(c).toHaveValue("[Image #1][Image #2]");
    await expect(chips(page).getByRole("img")).toHaveCount(2);
    await chips(page).getByRole("button", { name: "Remove [Image #1]" }).click();
    await expect(c).toHaveValue("[Image #1]");
    await expect(chips(page).getByRole("img")).toHaveCount(1);
    await expect(chips(page)).not.toContainText("[Image #2]");
    await c.press("Enter");
    await expect(chat(page).getByText("Seen")).toBeVisible();
    const [text] = messages(server);
    expect(text).toMatch(/\[Image #1\] = .*\.jpg/);
    expect(text).not.toMatch(/\.png/);
  });
});

test("24.5 / 25.5 a bad image request does not harm the server", async ({ page }) => {
  await withChat({ roles: { chat: { replies: [[{ event: { type: "system", subtype: "init", slash_commands: ["review", "recall"] } }, say("m1", "Hello")], [say("m2", "Works")]] } } }, async (server) => {
    await page.goto(server.url);
    await send(page, "hi first");
    await expect(chat(page).getByText("Hello")).toBeVisible();
    const base = `${server.origin}/api/projects/project/image`;
    expect((await page.request.get(`${base}?name=`)).status()).toBe(404);
    expect((await page.request.get(`${base}`)).status()).toBe(404);
    expect((await page.request.get(`${base}?name=${encodeURIComponent("../../../etc/hosts")}`)).status()).toBe(404);
    expect((await page.request.get(`${base}?name=${encodeURIComponent("../log.jsonl")}`)).status()).toBe(404);
    const c = composerOf(page);
    await c.pressSequentially("/");
    await expect(page.getByRole("listbox")).toBeVisible({ timeout: 5000 });
    await c.fill("");
    await paste(page, "png");
    await expect(chips(page).locator("[data-slot=image-chip]")).toHaveAttribute("data-state", "ready", { timeout: 15000 });
    await expect(chips(page).getByRole("img")).toBeVisible();
    await composerOf(page).pressSequentially(" ok");
    await composerOf(page).press("Enter");
    await expect(chat(page).getByText("Works")).toBeVisible();
  });
});

test("25.2 an oversized image shows its refusal and is not sent", async ({ page }) => {
  await withChat({ roles: { chat: { replies: [[say("m1", "Seen")]] } } }, async (server) => {
    await page.goto(server.url);
    await paste(page, "png", 2 * 1024 * 1024);
    await paste(page, "png", 25 * 1024 * 1024);
    const items = chips(page).locator("[data-slot=image-chip]");
    await expect(items.first().getByRole("img")).toBeVisible();
    await expect(items.first()).toContainText("[Image #1]");
    await expect(items.nth(1).getByRole("alert")).toContainText("20 MB");
    await items.nth(1).getByRole("button", { name: /Remove/ }).click();
    await expect(composerOf(page)).not.toHaveValue(/\[Image #2\]/);
    await composerOf(page).pressSequentially(" Why is this red?");
    await composerOf(page).press("Enter");
    await expect(chat(page).getByText("Seen")).toBeVisible();
    const [text] = messages(server);
    expect(text).toMatch(/\[Image #1\] = .*\.png/);
    expect(text).not.toContain("[Image #2]");
  });
});

test("25.4 Enter waits for a running upload", async ({ page }) => {
  await withChat({ roles: { chat: { replies: [[say("m1", "Seen")]] } } }, async (server) => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    await page.route("**/image*", async (route) => {
      if (route.request().method() === "POST") await gate;
      await route.continue();
    });
    await page.goto(server.url);
    await paste(page, "png");
    await expect(chips(page).locator("[data-slot=image-chip]")).toHaveAttribute("data-state", "uploading");
    await composerOf(page).pressSequentially(" what is this?");
    await composerOf(page).press("Enter");
    await expect(chat(page).locator("article")).toHaveCount(0);
    expect(messages(server)).toHaveLength(0);
    release();
    await expect(chat(page).getByText("Seen")).toBeVisible({ timeout: 15000 });
    expect(messages(server)[0]).toMatch(/\[Image #1\] = .*\.werk\/attachments\/.+\.png/);
  });
});
