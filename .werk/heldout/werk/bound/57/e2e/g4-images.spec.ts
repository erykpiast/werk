import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  chat,
  chips,
  composer,
  dropImage,
  messages,
  pasteImage,
  say,
  send,
  withChat,
} from "./g4-support.ts";

const ok = {
  roles: { chat: { replies: [[say("m1", "Seen")], [say("m2", "Seen2")]] } },
};
const attachments = (dir: string) => join(dir, ".werk", "attachments");
const stored = (dir: string) =>
  existsSync(attachments(dir))
    ? readdirSync(attachments(dir)).filter((n) => !n.startsWith("."))
    : [];

test("24.1 hash menu picks a card", async ({ page }) => {
  await withChat(ok, async (server) => {
    const added = server.werk(
      "add",
      "werk-shots",
      "--title",
      "Pasted screenshots",
      "--parent",
      "root",
      "--why",
      "w",
    );
    expect(added.stderr).toBe("");
    expect(server.werk("accept", "werk-shots", "--actor", "you").code).toBe(0);
    await page.goto(server.url);
    const box = composer(page);
    await box.focus();
    await box.pressSequentially("Look at #wer");
    const menu = page.getByRole("listbox");
    await expect(menu).toBeVisible();
    const opt = menu.getByRole("option").filter({ hasText: "werk-shots" });
    await expect(opt).toContainText("Pasted screenshots");
    await box.press("ArrowDown").catch(() => {});
    await expect(menu.getByRole("option", { selected: true })).toContainText(
      "werk-shots",
    );
    await box.press("Enter");
    await expect(box).toHaveValue(/^Look at #werk-shots\s*$/);
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await box.fill("");
    await box.pressSequentially("`#wer");
    await expect(page.getByRole("listbox")).toHaveCount(0);
  });
});

test("24.2 a pasted PNG uploads at once and reaches the agent as a stored path", async ({
  page,
}) => {
  await withChat(ok, async (server) => {
    await page.goto(server.url);
    await page.route("**/image", async (route) => {
      await new Promise((r) => setTimeout(r, 1500));
      await route.continue();
    });
    const box = composer(page);
    await box.fill("What is wrong here? ");
    await pasteImage(page);
    await expect(box).toHaveValue("What is wrong here? [Image #1]");
    await expect(chips(page)).toContainText("[Image #1]");
    await expect(chips(page).locator("[data-slot=spinner]")).toBeVisible();
    const thumb = chips(page).getByRole("img");
    await expect(thumb).toBeVisible();
    await expect
      .poll(() => thumb.evaluate((i: HTMLImageElement) => i.naturalWidth))
      .toBeGreaterThan(0);
    await box.press("Enter");
    await expect(chat(page).getByText("Seen")).toBeVisible();
    const [text] = messages(server);
    expect(text).toMatch(/\[Image #1\] = .*\.werk\/attachments\/.+\.png/);
    expect(text).toMatch(/open/i);
    const status = spawnSync("git", ["status", "--porcelain", "-uall"], {
      cwd: server.dir,
      encoding: "utf8",
    });
    expect(status.stdout).not.toContain("attachments");
  });
});

test("24.3 an oversized image is refused and not sent", async ({ page }) => {
  await withChat(ok, async (server) => {
    await page.goto(server.url);
    await dropImage(page, 25 * 1024 * 1024);
    await expect(composer(page)).toHaveValue("[Image #1]");
    await expect(chips(page).getByRole("alert")).toContainText("20 MB");
    await composer(page).fill("[Image #1] hello");
    await composer(page).press("Enter");
    await expect(chat(page).getByText("Seen")).toBeVisible();
    const [text] = messages(server);
    expect(text).not.toContain("[Image #1] =");
    expect(stored(server.dir)).toHaveLength(0);
  });
});

test("24.4 removing the first of two images renumbers the second", async ({
  page,
}) => {
  await withChat(ok, async (server) => {
    await page.goto(server.url);
    await pasteImage(page, null, "image/png");
    await pasteImage(page, 2000, "image/jpeg");
    const box = composer(page);
    await expect(box).toHaveValue("[Image #1][Image #2]");
    await expect(chips(page).locator("li")).toHaveCount(2);
    await expect(chips(page).getByRole("img")).toHaveCount(2);
    await chips(page)
      .getByRole("button", { name: "Remove [Image #1]" })
      .click();
    await expect(box).toHaveValue("[Image #1]");
    await expect(chips(page).locator("li")).toHaveCount(1);
    await box.press("Enter");
    await expect(chat(page).getByText("Seen")).toBeVisible();
    const [text] = messages(server);
    expect(text).toMatch(/\[Image #1\] = .*\.(jpg|jpeg)/);
    expect(text).not.toContain("[Image #2]");
  });
});

test("24.5 a bad image request does not harm the server", async ({ page }) => {
  await withChat(
    {
      roles: {
        chat: {
          replies: [
            [
              {
                event: {
                  type: "system",
                  subtype: "init",
                  slash_commands: ["review"],
                },
              },
              say("m1", "hi"),
            ],
          ],
        },
      },
    },
    async (server) => {
      await page.goto(server.url);
      await send(page, "hello");
      await expect(chat(page).getByText("hi")).toBeVisible();
      const base = `${server.origin}/api/projects/project/image`;
      expect((await fetch(`${base}?name=`)).status).toBe(404);
      expect((await fetch(`${base}?name=../log.jsonl`)).status).toBe(404);
      expect((await fetch(`${base}?name=..%2F..%2Flog.jsonl`)).status).toBe(
        404,
      );
      await composer(page).fill("/");
      await expect(
        page.getByRole("listbox").getByRole("option").first(),
      ).toBeVisible();
    },
  );
});
