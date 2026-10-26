import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import type { Script } from "../../src/fake-agent/script.ts";
import { type Srv, startServer } from "../server.ts";

const say = (id: string, text: string, usage?: Record<string, number>) => ({
  event: { type: "assistant", message: { id, content: [{ type: "text", text }], ...(usage ? { usage } : {}) } },
});
const stderrCrash = (text: string) => [{ stderr: text }, { crash: 1 }];

async function withChat(script: Script | undefined, body: (s: Srv) => Promise<void>) {
  const s = await startServer(script ? { script } : {});
  await s.start();
  try {
    await body(s);
  } finally {
    await s.dispose();
  }
}
const chat = (page: Page) => page.getByRole("complementary", { name: "Chat pane" });
const composer = (page: Page) => page.getByRole("textbox", { name: "Message" });
async function send(page: Page, text: string) {
  await composer(page).fill(text);
  await composer(page).press("Enter");
}
const messages = (s: Srv) => s.launches().flatMap((r) => (r.kind === "message" ? [r.text] : []));
const launched = (s: Srv) => s.launches().flatMap((r) => (r.kind === "launch" ? [r.args] : []));
const pie = (page: Page) => chat(page).getByRole("button", { name: /^Context/ });
const modelSel = (page: Page) => chat(page).getByLabel("Model");
const DELIVER = "Your message was not delivered. Send it again.";

const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const JPG_BASE64 = "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";

async function giveImage(page: Page, kind: "paste" | "drop", type: "png" | "jpg", bytes?: number) {
  await composer(page).focus();
  await page.evaluate(
    ({ kind, type, base64, size }) => {
      const raw = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const data = new Uint8Array(size ?? raw.length);
      data.set(raw);
      const transfer = new DataTransfer();
      transfer.items.add(new File([data], `shot.${type}`, { type: type === "png" ? "image/png" : "image/jpeg" }));
      if (kind === "paste") {
        document.querySelector("textarea")?.dispatchEvent(new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }));
      } else {
        const target = document.querySelector("[data-slot=composer]")!;
        target.dispatchEvent(new DragEvent("dragover", { dataTransfer: transfer, bubbles: true, cancelable: true }));
        target.dispatchEvent(new DragEvent("drop", { dataTransfer: transfer, bubbles: true, cancelable: true }));
      }
    },
    { kind, type, base64: type === "png" ? PNG_BASE64 : JPG_BASE64, size: bytes ?? null },
  );
}
const chips = (page: Page) => page.getByRole("list", { name: "Attached images" });
const slow = (page: Page, ms: number) =>
  page.route("**/image", async (route) => {
    if (route.request().method() === "POST") await new Promise((r) => setTimeout(r, ms));
    await route.continue();
  });
const ok = (id = "m1", text = "Seen") => ({ roles: { chat: { replies: [[say(id, text)]] } } }) as Script;

test("21.1 model and context fill survive a server restart, and the same session continues", async ({ page }) => {
  const script: Script = {
    roles: { chat: { replies: [[say("m1", "Hello", { input_tokens: 60000, output_tokens: 10 })], [say("m2", "You asked: hi there")]] } },
  };
  await withChat(script, async (s) => {
    await page.goto(s.url);
    await modelSel(page).selectOption("opus");
    await send(page, "hi there");
    await expect(chat(page).getByText("Hello")).toBeVisible();
    await expect(pie(page)).toHaveAttribute("aria-label", /Context [1-9]\d*% full/);
    const fill = await pie(page).getAttribute("aria-label");
    await s.stop();
    await s.start();
    await page.goto(s.url);
    await expect(modelSel(page)).toHaveValue("opus");
    await expect(modelSel(page).locator("option:checked")).toHaveText("Opus");
    await expect(pie(page)).toHaveAttribute("aria-label", fill!);
    await send(page, "What did I ask you before?");
    await expect(chat(page).getByText("You asked: hi there")).toBeVisible();
    const ls = launched(s);
    const last = ls[ls.length - 1]!;
    expect(last[last.indexOf("--resume") + 1]).toBe("fake-session-1");
    expect(last[last.indexOf("--model") + 1]).toBe("claude-opus-5-5");
  });
});

test("21.2 a dead stored session starts again and the waiting message is delivered", async ({ page }) => {
  const script: Script = {
    roles: { chat: { replies: [[say("m1", "First")], stderrCrash("No conversation found with session ID: fake-session-1"), [say("m3", "Answer in a new session")]] } },
  };
  await withChat(script, async (s) => {
    await page.goto(s.url);
    await send(page, "one");
    await expect(chat(page).getByText("First")).toBeVisible();
    await s.stop();
    await s.start();
    await page.goto(s.url);
    await send(page, "two");
    await expect(chat(page).getByText("Answer in a new session")).toBeVisible({ timeout: 30000 });
    await expect(chat(page).getByText(DELIVER)).toHaveCount(0);
    const ls = launched(s);
    expect(ls[ls.length - 1]).not.toContain("--resume");
    expect(messages(s).filter((m) => m.endsWith("two")).length).toBeGreaterThanOrEqual(1);
  });
});

test("21.3 another crash retries once, asks to send again, shows the whole error, then continues the session", async ({ page }) => {
  const err = "boom line one\nboom line two\nboom line three";
  const script: Script = {
    roles: { chat: { replies: [[say("m1", "First")], stderrCrash(err), stderrCrash(err), [say("m4", "Back again")]] } },
  };
  await withChat(script, async (s) => {
    await page.goto(s.url);
    await send(page, "one");
    await expect(chat(page).getByText("First")).toBeVisible();
    const before = launched(s).length;
    await send(page, "two");
    await expect(chat(page).getByText(DELIVER)).toBeVisible({ timeout: 30000 });
    for (const l of ["boom line one", "boom line two", "boom line three"]) await expect(chat(page)).toContainText(l);
    expect(launched(s).length - before).toBe(1);
    await send(page, "three");
    await expect(chat(page).getByText("Back again")).toBeVisible({ timeout: 30000 });
    const ls = launched(s);
    const last = ls[ls.length - 1]!;
    expect(last[last.indexOf("--resume") + 1]).toBe("fake-session-1");
  });
});

test("21.4 a login problem shows its error at once with no retry", async ({ page }) => {
  const err = "Not logged in\nPlease run claude auth login\nthen try again";
  const script: Script = { roles: { chat: { replies: [stderrCrash(err), [say("m2", "unreachable")]] } } };
  await withChat(script, async (s) => {
    await page.goto(s.url);
    await send(page, "hello");
    await expect(chat(page)).toContainText("Please run claude auth login", { timeout: 30000 });
    for (const l of ["Not logged in", "Please run claude auth login", "then try again"]) await expect(chat(page)).toContainText(l);
    expect(launched(s)).toHaveLength(1);
    await expect(chat(page).getByText(DELIVER)).toBeVisible();
  });
});

test("21.5 the model switch refuses during a turn and restarts quietly when idle", async ({ page }) => {
  const script: Script = {
    roles: { chat: { replies: [[say("m1", "Working"), { pause: 4000 }, say("m2", "Finished")], [say("m3", "After clear")]] } },
  };
  await withChat(script, async (s) => {
    await page.goto(s.url);
    await modelSel(page).selectOption("sonnet");
    await expect(modelSel(page).locator("option:checked")).toHaveText("Sonnet");
    await expect(pie(page)).toHaveAttribute("data-level", "blue");
    await send(page, "a long turn");
    await expect(chat(page).getByText("Working")).toBeVisible();
    // The person tries to pick Opus while the turn runs.
    const refused = await modelSel(page).selectOption("opus", { timeout: 1500 }).then(() => false, () => true);
    expect(refused || (await modelSel(page).inputValue()) === "sonnet").toBe(true);
    await expect(modelSel(page)).toHaveValue("sonnet");
    await expect(chat(page).getByText("Finished")).toBeVisible({ timeout: 20000 });
    await modelSel(page).selectOption("sonnet+opus");
    await expect(modelSel(page)).toHaveValue("sonnet+opus");
    await expect(modelSel(page).locator("option:checked")).toHaveText(/^Sonnet.*Opus advisor$/);
    await expect(chat(page).getByText(/not delivered|crash|exited/i)).toHaveCount(0);
    await pie(page).click();
    const dialog = chat(page).getByRole("dialog");
    await expect(dialog).toContainText(/\d+% of the context window is in use/);
    await dialog.getByRole("button", { name: "Clear context" }).click();
    await expect(chat(page).getByText(/not delivered|crash|exited/i)).toHaveCount(0);
    await send(page, "next one");
    await expect(chat(page).getByText("After clear")).toBeVisible({ timeout: 20000 });
  });
});

test("24.1 the hash menu picks a card", async ({ page }) => {
  await withChat(undefined, async (s) => {
    s.appendLog(
      { type: "node.proposed", id: "werk-shots", kind: "card", title: "Pasted screenshots", status: "open", parent: "root" },
      { type: "node.accepted", id: "werk-shots", actor: "you" },
    );
    await page.goto(s.url);
    await expect(page.locator("a.tile", { hasText: "Pasted screenshots" })).toBeVisible();
    const box = composer(page);
    await box.focus();
    await box.pressSequentially("Look at #wer");
    const menu = page.getByRole("listbox");
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("option", { name: /werk-shots/ })).toContainText("Pasted screenshots");
    const m = (await menu.boundingBox())!;
    const t = (await box.boundingBox())!;
    await box.press("ArrowDown");
    await box.press("ArrowUp");
    await box.press("Enter");
    await expect(box).toHaveValue(/^Look at #werk-shots\s?$/);
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await box.fill("");
    await box.pressSequentially("`#wer");
    await expect(page.getByRole("listbox")).toHaveCount(0);
    // the menu opens below the caret: its top is not above the composer's top
    expect(m.y).toBeGreaterThanOrEqual(t.y);
  });
});

test("24.2 a pasted PNG uploads and reaches the agent as a stored path", async ({ page }) => {
  await withChat(ok(), async (s) => {
    await slow(page, 1500);
    await page.goto(s.url);
    await composer(page).pressSequentially("What is wrong here? ");
    await giveImage(page, "paste", "png");
    await expect(composer(page)).toHaveValue("What is wrong here? [Image #1]");
    await expect(chips(page)).toContainText("[Image #1]");
    await expect(chips(page).getByRole("status", { name: "Uploading" })).toBeVisible();
    const thumb = chips(page).getByRole("img");
    await expect(thumb).toBeVisible();
    await expect.poll(() => thumb.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
    await composer(page).press("Enter");
    await expect(chat(page).getByText("Seen")).toBeVisible();
    const [text] = messages(s);
    expect(text).toMatch(/\[Image #1\] = .*\.werk\/attachments\/.+\.png/);
    expect(text).toMatch(/open (each|that|the) image/i);
    const status = execFileSync("git", ["status", "--porcelain", "-uall"], { cwd: s.dir, encoding: "utf8" });
    expect(status).not.toContain("attachments");
    expect(readdirSync(join(s.dir, ".werk", "attachments")).some((f) => f.endsWith(".png"))).toBe(true);
  });
});

test("24.3 an oversized image is refused and is not sent", async ({ page }) => {
  await withChat(ok("m1", "Ok"), async (s) => {
    await page.goto(s.url);
    await composer(page).pressSequentially("What is this? ");
    await giveImage(page, "drop", "png", 25 * 1024 * 1024);
    await expect(composer(page)).toHaveValue("What is this? [Image #1]");
    await expect(chips(page)).toContainText("[Image #1]");
    await expect(chips(page).getByRole("alert")).toContainText(/20 MB/);
    await composer(page).press("Enter");
    await expect(chat(page).getByText("Ok")).toBeVisible();
    for (const text of messages(s)) expect(text).not.toMatch(/\[Image #1\] =/);
    const dir = join(s.dir, ".werk", "attachments");
    const files = existsSync(dir) ? readdirSync(dir).filter((f) => f !== ".gitignore") : [];
    expect(files).toEqual([]);
  });
});

test("24.4 removing the first of two images renumbers the second", async ({ page }) => {
  await withChat(ok(), async (s) => {
    await page.goto(s.url);
    await giveImage(page, "paste", "png");
    await expect(chips(page).getByRole("img")).toHaveCount(1);
    await giveImage(page, "paste", "jpg");
    await expect(composer(page)).toHaveValue("[Image #1][Image #2]");
    await expect(chips(page).locator("[data-slot=image-chip]")).toHaveCount(2);
    await expect(chips(page).locator("[data-slot=image-chip][data-state=ready]")).toHaveCount(2);
    await chips(page).getByRole("button", { name: "Remove [Image #1]" }).click();
    await expect(composer(page)).toHaveValue("[Image #1]");
    await expect(chips(page).locator("[data-slot=image-chip]")).toHaveCount(1);
    await expect(chips(page).locator("img")).toHaveAttribute("src", /\.jpg/);
    await composer(page).press("Enter");
    await expect(chat(page).getByText("Seen")).toBeVisible();
    const [text] = messages(s);
    expect(text).toMatch(/\[Image #1\] = .*\.jpg/);
    expect(text).not.toContain("[Image #2]");
  });
});

test("24.5 a bad image request does not harm the server", async ({ page }) => {
  const start = { event: { type: "system", subtype: "init", slash_commands: ["review", "recall"] } };
  await withChat({ roles: { chat: { replies: [[start, say("m1", "Hello")]] } } }, async (s) => {
    await page.goto(s.url);
    await expect(composer(page)).toBeVisible();
    await send(page, "hi");
    await expect(chat(page).getByText("Hello")).toBeVisible();
    const base = `${s.origin}/api/projects/project/image`;
    expect((await page.request.get(`${base}?name=`)).status()).toBe(404);
    expect((await page.request.get(base)).status()).toBe(404);
    const up = await page.request.get(`${base}?name=${encodeURIComponent("../../log.jsonl")}`);
    expect(up.status()).toBe(404);
    expect(await up.text()).not.toContain("node.proposed");
    const up2 = await page.request.get(`${base}?name=..%2F..%2Flog.jsonl`);
    expect(up2.status()).toBe(404);
    await composer(page).focus();
    await composer(page).pressSequentially("/");
    await expect(page.getByRole("listbox").getByRole("option").first()).toBeVisible();
  });
});

test("25.1 a pasted screenshot becomes a numbered image the agent reads by path", async ({ page }) => {
  await withChat(ok(), async (s) => {
    await slow(page, 1500);
    await page.goto(s.url);
    await giveImage(page, "paste", "png");
    await expect(chips(page).getByRole("status", { name: "Uploading" })).toBeVisible();
    await expect(composer(page)).toHaveValue("[Image #1]");
    const thumb = chips(page).getByRole("img");
    await expect(thumb).toBeVisible();
    await expect(chips(page)).toContainText("[Image #1]");
    await composer(page).pressSequentially(" Why is this red?");
    await composer(page).press("Enter");
    await expect(chat(page).getByText("Seen")).toBeVisible();
    await expect(chat(page).locator("article").first().getByRole("img")).toBeVisible();
    const [text] = messages(s);
    expect(text).toMatch(/\[Image #1\] = .*\.werk\/attachments\/.+\.png/);
    expect(text).toMatch(/Read/);
    expect(text).not.toContain(PNG_BASE64);
  });
});

test("25.2 an oversized image shows its refusal and is not sent", async ({ page }) => {
  await withChat(ok(), async (s) => {
    await page.goto(s.url);
    await giveImage(page, "paste", "png", 2 * 1024 * 1024);
    await expect(chips(page).locator("[data-slot=image-chip][data-state=ready]")).toHaveCount(1);
    await giveImage(page, "paste", "png", 25 * 1024 * 1024);
    const items = chips(page).locator("[data-slot=image-chip]");
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toContainText("[Image #1]");
    await expect(items.nth(0).getByRole("img")).toBeVisible();
    await expect(items.nth(1).getByRole("alert")).toContainText(/larger than 20 MB/);
    await items.nth(1).getByRole("button", { name: "Remove [Image #2]" }).click();
    await expect(composer(page)).not.toHaveValue(/\[Image #2\]/);
    await composer(page).pressSequentially(" Why is this red?");
    await composer(page).press("Enter");
    await expect(chat(page).getByText("Seen")).toBeVisible();
    const [text] = messages(s);
    expect(text).toMatch(/\[Image #1\] = .*\.png/);
    expect(text).not.toContain("[Image #2]");
  });
});

test("25.3 removing a chip renumbers the remaining images", async ({ page }) => {
  await withChat(ok(), async (s) => {
    await page.goto(s.url);
    await giveImage(page, "paste", "png");
    await giveImage(page, "paste", "jpg");
    await expect(chips(page).locator("[data-slot=image-chip][data-state=ready]")).toHaveCount(2);
    await expect(composer(page)).toHaveValue("[Image #1][Image #2]");
    await chips(page).getByRole("button", { name: "Remove [Image #1]" }).click();
    const value = await composer(page).inputValue();
    expect(value.match(/\[Image #1\]/g)).toHaveLength(1);
    expect(value).not.toContain("[Image #2]");
    await expect(chips(page).locator("[data-slot=image-token]")).toHaveText(["[Image #1]"]);
    await composer(page).press("Enter");
    await expect(chat(page).getByText("Seen")).toBeVisible();
    const [text] = messages(s);
    expect(text).toMatch(/\[Image #1\] = .*\.jpg/);
  });
});

test("25.4 Enter waits for a running upload", async ({ page }) => {
  await withChat(ok(), async (s) => {
    await slow(page, 2500);
    await page.goto(s.url);
    await giveImage(page, "paste", "png");
    await expect(chips(page).getByRole("status", { name: "Uploading" })).toBeVisible();
    await composer(page).pressSequentially(" what is this?");
    await composer(page).press("Enter");
    await page.waitForTimeout(800);
    expect(messages(s)).toHaveLength(0);
    await expect(chat(page).getByText("Seen")).toBeVisible({ timeout: 10000 });
    const [text] = messages(s);
    expect(text).toMatch(/\[Image #1\] = .*\.werk\/attachments\/.+\.png/);
  });
});

test("25.5 a request for an image with no name answers 404 and the server stays up", async ({ page }) => {
  const two = { roles: { chat: { replies: [[say("m1", "Seen")], [say("m2", "Seen again")]] } } } as Script;
  await withChat(two, async (s) => {
    await page.goto(s.url);
    await giveImage(page, "paste", "png");
    await expect(chips(page).getByRole("img")).toBeVisible();
    await composer(page).press("Enter");
    await expect(chat(page).getByText("Seen")).toBeVisible();
    const base = `${s.origin}/api/projects/project/image`;
    expect((await page.request.get(`${base}?name=`)).status()).toBe(404);
    expect((await page.request.get(`${base}?name=${encodeURIComponent("../../log.jsonl")}`)).status()).toBe(404);
    await giveImage(page, "paste", "png");
    await expect(chips(page).getByRole("img")).toBeVisible();
    await composer(page).pressSequentially(" again");
    await composer(page).press("Enter");
    await expect(chat(page).locator("article")).toHaveCount(2);
  });
});
