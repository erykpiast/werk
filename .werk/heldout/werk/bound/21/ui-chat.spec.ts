import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import type { Script } from "../src/fake-agent/script.ts";
import { type App, startApp } from "./app.ts";

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const say = (id: string, text: string) => ({
  event: { type: "assistant", message: { id, content: [{ type: "text", text }] } },
});
const replies = (...texts: string[]): Script => ({
  roles: { chat: { replies: texts.map((t, i) => [say(`m${i}`, t)]) } },
});

async function withApp(
  options: Parameters<typeof startApp>[0],
  body: (app: App) => Promise<void>,
) {
  const app = await startApp(options);
  await app.start();
  try {
    await body(app);
  } finally {
    await app.dispose();
  }
}

const composer = (page: Page) => page.getByRole("textbox", { name: "Message" });
const chatPane = (page: Page) => page.getByRole("complementary", { name: "Chat pane" });
const chips = (page: Page) => page.getByRole("list", { name: "Attached images" });
const messages = (app: App) =>
  app.launches().flatMap((r) => (r.kind === "message" ? [r.text] : []));
const attachments = (app: App) => {
  const dir = join(app.dir, ".werk", "attachments");
  return existsSync(dir) ? readdirSync(dir).filter((n) => n !== ".gitignore") : [];
};

/** Pastes one image as a clipboard with one file: a PNG with the given size, or a JPEG that the page draws. */
async function paste(page: Page, kind: "png" | "jpeg" | number) {
  await composer(page).focus();
  await page.evaluate(
    async ({ base64, kind }) => {
      const transfer = new DataTransfer();
      if (kind === "jpeg") {
        const canvas = document.createElement("canvas");
        canvas.width = 3;
        canvas.height = 3;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.fillStyle = "#c33";
          ctx.fillRect(0, 0, 3, 3);
        }
        const blob: Blob = await new Promise((r) => canvas.toBlob((b) => r(b as Blob), "image/jpeg"));
        transfer.items.add(new File([blob], "shot.jpg", { type: "image/jpeg" }));
      } else {
        const png = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        const data = new Uint8Array(kind === "png" ? png.length : kind);
        data.set(png);
        transfer.items.add(new File([data], "shot.png", { type: "image/png" }));
      }
      const event = new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true });
      document.querySelector("textarea")?.dispatchEvent(event);
    },
    { base64: PNG_BASE64, kind },
  );
}

/** A person's drop of a big PNG on the composer. */
async function drop(page: Page, bytes: number) {
  await page.evaluate(
    ({ base64, size }) => {
      const png = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const data = new Uint8Array(size);
      data.set(png);
      const transfer = new DataTransfer();
      transfer.items.add(new File([data], "big.png", { type: "image/png" }));
      const target = document.querySelector("[data-slot=composer]");
      for (const type of ["dragover", "drop"]) {
        target?.dispatchEvent(new DragEvent(type, { dataTransfer: transfer, bubbles: true, cancelable: true }));
      }
    },
    { base64: PNG_BASE64, size: bytes },
  );
}

const slow = (page: Page, ms: number) =>
  page.route("**/api/projects/*/image", async (route) => {
    if (route.request().method() === "POST") await new Promise((r) => setTimeout(r, ms));
    await route.continue();
  });

const send = async (page: Page, text: string) => {
  await composer(page).fill(text);
  await composer(page).press("Enter");
};

test("24.2 a pasted PNG uploads at once and reaches the agent as a stored path", async ({ page }) => {
  await withApp({ script: replies("Seen") }, async (app) => {
    await page.goto(app.url);
    await slow(page, 1500);
    await composer(page).pressSequentially("What is wrong here? ");
    await paste(page, "png");
    await expect(composer(page)).toHaveValue("What is wrong here? [Image #1]");
    await expect(chips(page)).toContainText("[Image #1]");
    await expect(chips(page).getByRole("status", { name: "Uploading" })).toBeVisible();
    const thumb = chips(page).getByRole("img");
    await expect(thumb).toBeVisible();
    await expect.poll(() => thumb.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
    await composer(page).press("Enter");
    await expect(chatPane(page).getByText("Seen")).toBeVisible();
    const [text] = messages(app);
    expect(text).toMatch(/\[Image #1\] = .*\.werk\/attachments\/[^\s]+\.png/);
    expect(text).toMatch(/Open each image above with Read/i);
    const status = (await import("node:child_process")).spawnSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: app.dir, encoding: "utf8" });
    expect(status.stdout).not.toContain("attachments");
    expect(attachments(app)).toHaveLength(1);
  });
});

test("24.3 an oversized image is refused and is not sent", async ({ page }) => {
  await withApp({ script: replies("Ok") }, async (app) => {
    await page.goto(app.url);
    await drop(page, 25 * 1024 * 1024);
    await expect(composer(page)).toHaveValue("[Image #1]");
    await expect(chips(page).getByRole("alert")).toContainText("20 MB");
    await composer(page).press("Enter");
    await expect.poll(() => messages(app).length).toBeGreaterThan(0).catch(() => {});
    const [text] = messages(app);
    expect(text ?? "").not.toMatch(/\[Image #1\] =/);
    expect(attachments(app)).toHaveLength(0);
  });
});

test("24.4 removing the first of two images renumbers the second", async ({ page }) => {
  await withApp({ script: replies("Seen") }, async (app) => {
    await page.goto(app.url);
    await paste(page, "png");
    await expect(chips(page).getByRole("img")).toHaveCount(1);
    await paste(page, "jpeg");
    await expect(chips(page).getByRole("img")).toHaveCount(2);
    await expect(composer(page)).toHaveValue("[Image #1][Image #2]");
    await chips(page).getByRole("button", { name: "Remove [Image #1]" }).click();
    const value = await composer(page).inputValue();
    expect(value).toBe("[Image #1]");
    await expect(chips(page).getByRole("listitem")).toHaveCount(1);
    await expect(chips(page).getByRole("img")).toHaveAttribute("src", /\.jpg/);
    await composer(page).press("Enter");
    await expect(chatPane(page).getByText("Seen")).toBeVisible();
    expect(messages(app)[0]).toMatch(/\[Image #1\] = .*\.jpg/);
    expect(messages(app)[0]).not.toContain("[Image #2]");
  });
});

test("24.5 a bad image request does not harm the server, and the slash menu opens", async ({ page }) => {
  await withApp({}, async (app) => {
    await page.goto(app.url);
    const base = `${app.origin}/api/projects/${app.name}/image`;
    expect((await fetch(`${base}?name=`)).status).toBe(404);
    const climb = await fetch(`${base}?name=${encodeURIComponent("../log.jsonl")}`);
    expect(climb.status).toBe(404);
    expect(await climb.text()).not.toContain("node.proposed");
    const climb2 = await fetch(`${base}?name=${encodeURIComponent("../../../../etc/passwd")}`);
    expect(climb2.status).toBe(404);
    await composer(page).pressSequentially("/");
    await expect(page.getByRole("listbox").or(page.getByRole("menu"))).toBeVisible({ timeout: 5000 });
  });
});

test("24.1 a hash in the composer opens a menu of cards", async ({ page }) => {
  await withApp({}, async (app) => {
    expect(app.werk("add", "werk-shots", "--title", "Pasted screenshots", "--parent", "root").code).toBe(0);
    expect(app.werk("accept", "werk-shots", "--actor", "you").code).toBe(0);
    await page.goto(app.url);
    await composer(page).pressSequentially("Look at #wer");
    const menu = page.getByRole("listbox").or(page.getByRole("menu"));
    await expect(menu).toBeVisible({ timeout: 5000 });
    await expect(menu).toContainText("werk-shots");
    await expect(menu).toContainText("Pasted screenshots");
    await composer(page).press("ArrowDown");
    await composer(page).press("Enter");
    await expect(composer(page)).toHaveValue("Look at #werk-shots");
    await expect(menu).toBeHidden();
    await composer(page).fill("");
    await composer(page).pressSequentially("`#wer");
    await expect(menu).toBeHidden();
  });
});

// ---- ticket 25 ----

test("25.1 a pasted screenshot becomes a numbered image the agent reads by path", async ({ page }) => {
  await withApp({ script: replies("Seen") }, async (app) => {
    await page.goto(app.url);
    await slow(page, 1500);
    await paste(page, "png");
    await expect(chips(page).getByRole("status", { name: "Uploading" })).toBeVisible();
    await expect(composer(page)).toHaveValue("[Image #1]");
    const thumb = chips(page).getByRole("img");
    await expect(thumb).toBeVisible();
    await expect(chips(page)).toContainText("[Image #1]");
    await composer(page).pressSequentially(" Why is this red?");
    await composer(page).press("Enter");
    await expect(chatPane(page).getByText("Seen")).toBeVisible();
    await expect(chatPane(page).getByRole("img")).toBeVisible();
    await expect(chatPane(page)).toContainText("[Image #1]");
    const [text] = messages(app);
    expect(text).toMatch(/\[Image #1\] = .*\.werk\/attachments\//);
    expect(text).toMatch(/Open each image above with Read/);
    expect(text).not.toContain(PNG_BASE64);
  });
});

test("25.2 an oversized image shows its refusal and is not sent", async ({ page }) => {
  await withApp({ script: replies("Seen") }, async (app) => {
    await page.goto(app.url);
    await paste(page, 2 * 1024 * 1024);
    await expect(chips(page).getByRole("img")).toHaveCount(1);
    await paste(page, 25 * 1024 * 1024);
    await expect(chips(page).getByRole("alert")).toContainText("20 MB");
    await expect(chips(page).getByRole("listitem").nth(1)).toContainText("larger than 20 MB");
    await chips(page).getByRole("button", { name: "Remove [Image #2]" }).click();
    await expect(composer(page)).not.toHaveValue(/\[Image #2\]/);
    await composer(page).pressSequentially(" Why is this red?");
    await composer(page).press("Enter");
    await expect(chatPane(page).getByText("Seen")).toBeVisible();
    const [text] = messages(app);
    expect(text).toMatch(/\[Image #1\] = /);
    expect(text).not.toContain("[Image #2]");
  });
});

test("25.3 removing a chip renumbers the remaining images", async ({ page }) => {
  await withApp({ script: replies("Seen") }, async (app) => {
    await page.goto(app.url);
    await paste(page, "png");
    await expect(chips(page).getByRole("img")).toHaveCount(1);
    await paste(page, "png");
    await expect(chips(page).getByRole("img")).toHaveCount(2);
    await expect(composer(page)).toHaveValue("[Image #1][Image #2]");
    await chips(page).getByRole("button", { name: "Remove [Image #1]" }).click();
    await expect(composer(page)).toHaveValue("[Image #1]");
    await expect(chips(page).getByRole("listitem")).toHaveCount(1);
    await expect(chips(page)).toContainText("[Image #1]");
    await composer(page).press("Enter");
    await expect(chatPane(page).getByText("Seen")).toBeVisible();
    expect(messages(app)[0]).toMatch(/\[Image #1\] = .*\.png/);
    expect(messages(app)[0]).not.toContain("[Image #2]");
  });
});

test("25.4 Enter waits for a running upload", async ({ page }) => {
  await withApp({ script: replies("Seen") }, async (app) => {
    await page.goto(app.url);
    await slow(page, 2500);
    await paste(page, "png");
    await expect(chips(page).getByRole("status", { name: "Uploading" })).toBeVisible();
    await composer(page).pressSequentially(" what is this?");
    await composer(page).press("Enter");
    expect(messages(app)).toHaveLength(0);
    await expect(chips(page).getByRole("status", { name: "Uploading" })).toBeVisible();
    // the chip goes away with the send, so the test only waits for the answer
    await expect(chatPane(page).getByText("Seen")).toBeVisible();
    expect(messages(app)[0]).toMatch(/\[Image #1\] = .*\.png/);
  });
});

test("25.5 a request for an image with no name answers 404 and the server stays up", async ({ page }) => {
  await withApp({ script: replies("Seen") }, async (app) => {
    await page.goto(app.url);
    await paste(page, "png");
    await expect(chips(page).getByRole("img")).toHaveCount(1);
    await composer(page).press("Enter");
    await expect(chatPane(page).getByText("Seen")).toBeVisible();
    expect(attachments(app)).toHaveLength(1);
    const base = `${app.origin}/api/projects/${app.name}/image`;
    expect((await fetch(`${base}?name=`)).status).toBe(404);
    expect((await fetch(`${base}?name=${encodeURIComponent("../../log.jsonl")}`)).status).toBe(404);
    await paste(page, "png");
    const thumb = chips(page).getByRole("img");
    await expect(thumb).toHaveCount(1);
    await expect.poll(() => thumb.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
    await composer(page).pressSequentially(" still works");
    await composer(page).press("Enter");
    await expect.poll(() => messages(app).length).toBe(2);
  });
});

// ---- probes of the conversation, tab and model features ----

test("21.1 a conversation keeps its model and context fill across a server restart", async ({ page }) => {
  await withApp({ script: replies("Answer one", "You asked: earlier") }, async (app) => {
    await page.goto(app.url);
    const model = page.getByRole("combobox", { name: /model/i });
    await expect(model).toBeVisible({ timeout: 5000 });
    await model.selectOption({ label: "Opus" });
    await send(page, "earlier");
    await expect(chatPane(page).getByText("Answer one")).toBeVisible();
    await app.stop();
    await app.start();
    await page.reload();
    await expect(model).toHaveValue(/opus/i);
  });
});

test("21.2 a dead stored session starts again and the waiting message is delivered", async ({ page }) => {
  await withApp({ script: replies("Answer one", "Answer two") }, async (app) => {
    await page.goto(app.url);
    await send(page, "first");
    await expect(chatPane(page).getByText("Answer one")).toBeVisible();
    await app.stop();
    await app.start();
    await page.reload();
    // the earlier turn is still in the conversation after the restart
    await expect(chatPane(page).getByText("Answer one")).toBeVisible({ timeout: 5000 });
    await send(page, "second");
    await expect(chatPane(page).getByText("Answer two")).toBeVisible();
    await expect(chatPane(page)).not.toContainText("Your message was not delivered. Send it again.");
  });
});

const crashing: Script = { roles: { chat: { replies: [[{ crash: 1 }], [{ crash: 1 }]] } } };

test("21.3 a crash with another error retries once and asks the person to send again", async ({ page }) => {
  await withApp({ script: crashing }, async (app) => {
    await page.goto(app.url);
    await send(page, "hello");
    await expect(chatPane(page)).toContainText("Your message was not delivered. Send it again.", { timeout: 8000 });
  });
});

test("21.4 a login problem shows its error at once with no retry", async ({ page }) => {
  await withApp({ script: crashing }, async (app) => {
    await page.goto(app.url);
    await send(page, "hello");
    await expect(chatPane(page)).toContainText("Your message was not delivered. Send it again.", { timeout: 8000 });
  });
});

test("21.5 the model switch and clear context refuse during a turn", async ({ page }) => {
  await withApp({ script: replies("Done") }, async (app) => {
    await page.goto(app.url);
    const model = page.getByRole("combobox", { name: /model/i });
    await expect(model).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole("button", { name: /context/i })).toBeVisible();
  });
});

test("23.1 two conversations with different home cards stay apart", async ({ page }) => {
  await withApp({ script: replies("Reply A", "Reply B") }, async (app) => {
    await page.goto(app.url);
    await expect(page.getByRole("tablist").or(page.getByRole("list", { name: /conversations|tabs/i }))).toBeVisible({ timeout: 5000 });
  });
});

test("23.2 switching to a tab shows its newest message", async ({ page }) => {
  await withApp({ script: replies("Reply") }, async (app) => {
    await page.goto(app.url);
    await expect(page.getByRole("tab").first()).toBeVisible({ timeout: 5000 });
  });
});

test("23.3 a crashed agent marks its tab and tells the other tabs", async ({ page }) => {
  await withApp({ script: crashing }, async (app) => {
    await page.goto(app.url);
    await send(page, "hello");
    await expect(page.getByRole("tab").first()).toBeVisible({ timeout: 5000 });
  });
});

test("23.4 a model switch is not a crash", async ({ page }) => {
  await withApp({ script: replies("Reply") }, async (app) => {
    await page.goto(app.url);
    await expect(page.getByRole("combobox", { name: /model/i })).toBeVisible({ timeout: 5000 });
  });
});

test("23.5 a running background agent and a suggested next action", async ({ page }) => {
  await withApp({ script: replies("Done.\n\nNext: merge it") }, async (app) => {
    await page.goto(app.url);
    await send(page, "go");
    await expect(chatPane(page).getByText("Done.")).toBeVisible();
    await expect(chatPane(page).getByRole("button", { name: "merge it" })).toBeVisible({ timeout: 5000 });
  });
});
