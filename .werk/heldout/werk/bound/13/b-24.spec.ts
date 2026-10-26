import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { startBrowserServer } from "../e2e/support/server.ts";
import {
  chat,
  composer,
  messages,
  PNG_1PX,
  say,
  send,
  withServer,
} from "./b-support.ts";

const REPLY = { roles: { chat: { replies: [[say("m1", "ok")], [say("m2", "ok2")]] } } };

async function paste(
  page: import("@playwright/test").Page,
  name: string,
  type: string,
  b64: string,
) {
  await composer(page).focus();
  await composer(page).evaluate(
    (el, a) => {
      const bytes = Uint8Array.from(atob(a.b64), (c) => c.charCodeAt(0));
      const file = new File([bytes], a.name, { type: a.type });
      const dt = new DataTransfer();
      dt.items.add(file);
      el.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: dt,
          bubbles: true,
          cancelable: true,
        }),
      );
    },
    { name, type, b64 },
  );
}

test("24.1 pick a card from the hash menu", async ({ page }) => {
  await withServer(REPLY, [["werk-shots", "Pasted screenshots"]], async (server) => {
    await page.goto(server.url);
    await composer(page).click();
    await composer(page).pressSequentially("Look at #wer");
    const menu = page.getByRole("listbox");
    await expect(menu).toBeVisible();
    await expect(menu).toContainText("werk-shots");
    await expect(menu).toContainText("Pasted screenshots");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(composer(page)).toHaveValue(/^Look at #werk-shots/);
    await expect(menu).toBeHidden();
    await composer(page).fill("");
    await composer(page).pressSequentially("`#wer");
    await expect(page.getByRole("listbox")).toHaveCount(0);
  });
});

test("24.2 a pasted PNG uploads at once and reaches the agent as a stored path", async ({
  page,
}) => {
  await withServer(REPLY, [], async (server) => {
    await page.goto(server.url);
    await composer(page).click();
    await composer(page).pressSequentially("What is wrong here? ");
    await paste(page, "shot.png", "image/png", PNG_1PX);
    await expect(composer(page)).toHaveValue(/\[Image #1\]/);
    await expect(page.locator("[data-slot=image-chip]").first()).toBeVisible();
    await composer(page).press("Enter");
    await expect(chat(page).getByText("ok")).toBeVisible();
    expect(messages(server).join("\n")).toMatch(/\[Image #1\].*attachments/s);
  });
});

test("24.3 an oversized image is refused and is not sent", async ({ page }) => {
  await withServer(REPLY, [], async (server) => {
    await page.goto(server.url);
    const big = Buffer.alloc(25 * 1024 * 1024).toString("base64");
    await paste(page, "big.png", "image/png", big);
    await expect(composer(page)).toHaveValue(/\[Image #1\]/);
    await expect(page.locator("[data-slot=image-chip]").first()).toContainText(
      /limit|MB/i,
    );
    await composer(page).press("Enter");
    await expect(chat(page).getByText("ok")).toBeVisible();
    expect(messages(server).join("\n")).not.toMatch(/attachments/);
    expect(existsSync(join(server.dir, ".werk", "attachments"))).toBe(false);
    void readdirSync;
  });
});

test("24.4 removing the first of two images renumbers the second", async ({
  page,
}) => {
  await withServer(REPLY, [], async (server) => {
    await page.goto(server.url);
    await paste(page, "a.png", "image/png", PNG_1PX);
    await paste(page, "b.jpg", "image/jpeg", PNG_1PX);
    await expect(composer(page)).toHaveValue(/\[Image #1\].*\[Image #2\]/s);
    const chips = page.locator("[data-slot=image-chip]");
    await expect(chips).toHaveCount(2);
    await chips.first().getByRole("button").click();
    await expect(composer(page)).not.toHaveValue(/\[Image #2\]/);
    await expect(composer(page)).toHaveValue(/\[Image #1\]/);
    await expect(chips).toHaveCount(1);
  });
});

test("24.5 a bad image request does not harm the server", async ({ page }) => {
  const server = await startBrowserServer({});
  await server.start();
  try {
    await page.goto(server.url);
    const base = `${server.origin}/api/projects/project`;
    const empty = await page.request.get(`${base}/images/`);
    const climb = await page.request.get(`${base}/images/..%2F..%2F.werk%2Flog.jsonl`);
    const status = [empty.status(), climb.status()];
    const known = await page.request.get(`${base}/chat`);
    expect(known.status()).toBe(200);
    await composer(page).click();
    await composer(page).pressSequentially("/");
    await expect(page.getByRole("listbox")).toBeVisible();
    expect(status).toEqual([404, 404]);
  } finally {
    await server.dispose();
  }
});
