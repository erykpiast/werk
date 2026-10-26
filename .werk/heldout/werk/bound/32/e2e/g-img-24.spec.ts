import { appendFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import {
  chat,
  chipsOf,
  composerOf,
  expectThumb,
  giveImage,
  messages,
  say,
  send,
  withServer,
} from "./support-img.ts";

const ok = { roles: { chat: { replies: [[say("m1", "Seen")]] } } };

test("24.1 a hash menu picks a card", async ({ page }) => {
  await withServer(
    undefined,
    async (server) => {
      await page.goto(server.url);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      const composer = composerOf(page);
      await composer.pressSequentially("Look at #wer");
      const menu = page.getByRole("listbox");
      await expect(menu).toBeVisible();
      const option = menu.getByRole("option");
      await expect(option).toHaveCount(1);
      await expect(option).toContainText("#werk-shots");
      await expect(option).toContainText("Pasted screenshots");
      // below the caret: the menu is under the textarea's top edge or at least not above the composer
      await composer.press("ArrowDown");
      await expect(option.first()).toHaveAttribute("aria-selected", "true");
      await composer.press("Enter");
      await expect(composer).toHaveValue(/^Look at #werk-shots\s*$/);
      await expect(page.getByRole("listbox")).toHaveCount(0);
      await composer.fill("`#wer");
      await expect(page.getByRole("listbox")).toHaveCount(0);
    },
    (server) => {
      appendFileSync(
        join(server.dir, ".werk", "log.jsonl"),
        `${JSON.stringify({ type: "node.proposed", id: "werk-shots", kind: "card", title: "Pasted screenshots", status: "open", parent: "root" })}\n${JSON.stringify({ type: "node.accepted", id: "werk-shots", actor: "you" })}\n`,
      );
    },
  );
});

test("24.2 a pasted PNG uploads at once and reaches the agent as a stored path", async ({
  page,
}) => {
  await withServer(ok, async (server) => {
    await page.goto(server.url);
    const composer = composerOf(page);
    await composer.pressSequentially("What is wrong here? ");
    await giveImage(page, "paste");
    await expect(composer).toHaveValue("What is wrong here? [Image #1]");
    await expect(chipsOf(page)).toContainText("[Image #1]");
    await expectThumb(page, 0);
    await composer.press("Enter");
    await expect(chat(page).getByText("Seen")).toBeVisible();
    const [text] = messages(server);
    const m = /\[Image #1\] = (\S+\.png)/.exec(text ?? "");
    expect(m).not.toBeNull();
    expect(m?.[1]).toContain(`${join(".werk", "attachments")}`);
    expect(existsSync(m?.[1] ?? "")).toBe(true);
    expect(text).toContain("Open each image above with Read");
    const status = spawnSync("git", ["status", "--porcelain", "-uall"], {
      cwd: server.dir,
      encoding: "utf8",
    }).stdout;
    expect(status).not.toContain("attachments");
  });
});

test("24.3 an oversized dropped image is refused and not sent", async ({
  page,
}) => {
  await withServer(ok, async (server) => {
    await page.goto(server.url);
    await giveImage(page, "drop", { size: 25 * 1024 * 1024 });
    await expect(composerOf(page)).toHaveValue("[Image #1]");
    await expect(chipsOf(page)).toContainText("[Image #1]");
    await expect(chipsOf(page).getByRole("alert")).toContainText("20 MB");
    await composerOf(page).pressSequentially(" hello");
    await composerOf(page).press("Enter");
    await expect(chat(page).getByText("Seen")).toBeVisible();
    const [text] = messages(server);
    expect(text).not.toContain("= ");
    expect(text).not.toContain("attachments");
    const dir = join(server.dir, ".werk", "attachments");
    const files = existsSync(dir)
      ? readdirSync(dir).filter((f) => f !== ".gitignore")
      : [];
    expect(files).toEqual([]);
  });
});

test("24.4 removing the first of two images renumbers the second", async ({
  page,
}) => {
  await withServer(ok, async (server) => {
    await page.goto(server.url);
    await giveImage(page, "paste", { kind: "png", color: "red" });
    await giveImage(page, "paste", { kind: "jpeg", color: "blue" });
    const composer = composerOf(page);
    await expect(composer).toHaveValue("[Image #1][Image #2]");
    await expect(chipsOf(page).getByRole("img")).toHaveCount(2);
    await expectThumb(page, 0);
    await expectThumb(page, 1);
    await chipsOf(page)
      .getByRole("button", { name: "Remove [Image #1]" })
      .click();
    await expect(composer).toHaveValue("[Image #1]");
    await expect(composer).not.toHaveValue(/Image #2/);
    await expect(chipsOf(page).getByRole("listitem")).toHaveCount(1);
    await expectThumb(page, 0);
    await expect(chipsOf(page).getByRole("img")).toHaveAttribute(
      "src",
      /name=.+\.jpg/,
    );
    await composer.press("Enter");
    await expect(chat(page).getByText("Seen")).toBeVisible();
    const [text] = messages(server);
    expect(text).toMatch(/\[Image #1\] = \S+\.jpg/);
    expect(text).not.toContain("[Image #2]");
  });
});

test("24.5 a bad image request does not harm the server", async ({ page }) => {
  const init = {
    event: {
      type: "system",
      subtype: "init",
      slash_commands: ["review", "recall"],
    },
  };
  await withServer(
    { roles: { chat: { replies: [[init, say("m1", "Hello")]] } } },
    async (server) => {
      await page.goto(server.url);
      await send(page, "hi");
      await expect(chat(page).getByText("Hello")).toBeVisible();
      const base = `${server.origin}/api/projects/project/image`;
      expect((await fetch(`${base}?name=`)).status).toBe(404);
      expect((await fetch(base)).status).toBe(404);
      for (const name of [
        "../log.jsonl",
        "../../etc/passwd",
        "..%2F..%2Fx.png",
        "/etc/passwd",
      ]) {
        const res = await fetch(
          `${base}?name=${name.includes("%") ? name : encodeURIComponent(name)}`,
        );
        expect(res.status).toBe(404);
      }
      await composerOf(page).pressSequentially("/");
      await expect(page.getByRole("listbox").getByRole("option")).toHaveText([
        "/review",
        "/recall",
      ]);
    },
  );
});
