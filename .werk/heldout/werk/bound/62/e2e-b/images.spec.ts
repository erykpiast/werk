import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { basename } from "node:path";
import {
  apiUrl,
  chat,
  chips,
  composerOf,
  dropShot,
  expect,
  messages,
  pasteShot,
  PNG_BASE64,
  say,
  send,
  storedFiles,
  test,
  thumbNames,
  withChat,
} from "./common.ts";

const ok = { roles: { chat: { replies: [[say("m1", "Seen")], [say("m2", "Seen again")]] } } };
const thumbLoaded = (img: import("@playwright/test").Locator) =>
  expect.poll(() => img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);

test("24.1 pick a card from the hash menu", async ({ page }) => {
  await withChat(
    undefined,
    async (server) => {
      await page.goto(server.url);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByRole("region", { name: "Map pane" }).getByText("Pasted screenshots")).toBeVisible();
      const composer = composerOf(page);
      await composer.pressSequentially("Look at #wer");
      const menu = page.getByRole("listbox");
      await expect(menu).toBeVisible();
      const options = menu.getByRole("option");
      await expect(options).toHaveCount(1);
      await expect(options.first()).toContainText("#werk-shots");
      await expect(options.first()).toContainText("Pasted screenshots");
      const m = await menu.boundingBox();
      const c = await composer.boundingBox();
      expect.soft(m && c && m.y >= c.y, "menu opens below the caret (menu top is not above the composer top)").toBe(true);
      await composer.press("ArrowDown");
      await composer.press("Enter");
      await expect(composer).toHaveValue(/^Look at #werk-shots\s?$/);
      await expect(page.getByRole("listbox")).toHaveCount(0);
      await composer.fill("`#wer");
      await expect(page.getByRole("listbox")).toHaveCount(0);
    },
    (s) => {
      expect(s.werk("add", "werk-shots", "--title", "Pasted screenshots", "--parent", "root").code).toBe(0);
      expect(s.werk("accept", "werk-shots", "--actor", "you").code).toBe(0);
    },
  );
});

test("24.2 a pasted PNG uploads at once and reaches the agent as a stored path", async ({ page }) => {
  await withChat(ok, async (server) => {
    // Delay the upload answer so the spinner can be seen.
    await page.route("**/image", async (route) => {
      if (route.request().method() === "POST") await new Promise((r) => setTimeout(r, 1500));
      await route.continue();
    });
    await page.goto(server.url);
    const composer = composerOf(page);
    await composer.pressSequentially("What is wrong here? ");
    await pasteShot(page);
    await expect(composer).toHaveValue("What is wrong here? [Image #1]");
    await expect(chips(page)).toContainText("[Image #1]");
    await expect(chips(page).getByRole("status", { name: "Uploading" })).toBeVisible();
    const thumb = chips(page).getByRole("img");
    await expect(thumb).toBeVisible();
    await thumbLoaded(thumb);
    await composer.press("Enter");
    await expect(chat(page).getByText("Seen")).toBeVisible();
    const [text] = messages(server);
    const path = /\[Image #1\] = (.*\.werk\/attachments\/[^\n]+\.png)/.exec(text ?? "")?.[1];
    expect(path).toBeTruthy();
    expect(text).toContain("Open each image above with Read");
    expect(storedFiles(server)).toHaveLength(1);
    expect(path).toContain(storedFiles(server)[0]);
    const status = spawnSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: server.dir, encoding: "utf8" }).stdout;
    expect(status).not.toContain("attachments");
    const ignored = spawnSync("git", ["check-ignore", "-q", `.werk/attachments/${storedFiles(server)[0]}`], { cwd: server.dir });
    expect(ignored.status).toBe(0);
  }, (s) => {
    expect(s.werk("add", "x", "--title", "x", "--parent", "root").code).toBe(0);
  });
});

test("24.3 an oversized image is refused and is not sent", async ({ page }) => {
  await withChat(ok, async (server) => {
    await page.goto(server.url);
    const composer = composerOf(page);
    await composer.pressSequentially("Look: ");
    await dropShot(page, { kind: "png", size: 25 * 1024 * 1024 });
    await expect(composer).toHaveValue("Look: [Image #1]");
    await expect(chips(page)).toContainText("[Image #1]");
    await expect(chips(page).getByRole("alert")).toContainText("20 MB");
    await composer.press("Enter");
    await expect(chat(page).getByText("Seen")).toBeVisible();
    const [text] = messages(server);
    expect(text).not.toContain("attachments");
    expect(text).not.toMatch(/\[Image #1\] =/);
    expect(storedFiles(server)).toEqual([]);
  });
});

test("24.4 removing the first of two images renumbers the second", async ({ page }) => {
  await withChat(ok, async (server) => {
    await page.goto(server.url);
    const composer = composerOf(page);
    await pasteShot(page, { kind: "png" });
    await expect(chips(page).getByRole("img")).toHaveCount(1);
    await pasteShot(page, { kind: "jpeg" });
    await expect(chips(page).getByRole("img")).toHaveCount(2);
    await expect(composer).toHaveValue("[Image #1][Image #2]");
    const names = await thumbNames(page);
    expect(names[1]).toMatch(/\.jpg$/);
    await chips(page).getByRole("button", { name: "Remove [Image #1]" }).click();
    await expect(composer).toHaveValue("[Image #1]");
    await expect(chips(page).getByRole("listitem")).toHaveCount(1);
    await expect(chips(page)).toContainText("[Image #1]");
    expect(await thumbNames(page)).toEqual([names[1]]);
    await thumbLoaded(chips(page).getByRole("img"));
    await composer.press("Enter");
    await expect(chat(page).getByText("Seen")).toBeVisible();
    const [text] = messages(server);
    expect(text).toMatch(new RegExp(`\\[Image #1\\] = .*attachments/${names[1]}`));
    expect(text).not.toContain("[Image #2]");
  });
});

test("24.5 a bad image request does not harm the server", async ({ page }) => {
  const start = { event: { type: "system", subtype: "init", slash_commands: ["review", "recall"] } };
  await withChat({ roles: { chat: { replies: [[start, say("m1", "Hello")]] } } }, async (server) => {
    await page.goto(server.url);
    await send(page, "hi");
    await expect(chat(page).getByText("Hello")).toBeVisible();
    const empty = await page.request.get(apiUrl(server, "/image?name="));
    expect(empty.status()).toBe(404);
    for (const name of ["../log.jsonl", "..%2Flog.jsonl", "..%2F..%2Fpackage.json", "%2e%2e%2f%2e%2e%2fpackage.json", "/etc/passwd"]) {
      const res = await fetch(apiUrl(server, `/image?name=${name}`));
      expect(res.status, name).toBe(404);
      expect(await res.text()).not.toContain("node.proposed");
    }
    const bare = await page.request.get(apiUrl(server, "/image"));
    expect(bare.status()).toBe(404);
    const composer = composerOf(page);
    await composer.pressSequentially("/");
    await expect(page.getByRole("listbox").getByRole("option")).toHaveText(["/review", "/recall"]);
  });
});

test("25.1 a pasted screenshot becomes a numbered image the agent reads by path", async ({ page }) => {
  await withChat(ok, async (server) => {
    await page.route("**/image", async (route) => {
      if (route.request().method() === "POST") await new Promise((r) => setTimeout(r, 1500));
      await route.continue();
    });
    await page.goto(server.url);
    const composer = composerOf(page);
    await pasteShot(page);
    await expect(chips(page).getByRole("status", { name: "Uploading" })).toBeVisible();
    await expect(composer).toHaveValue("[Image #1]");
    const thumb = chips(page).getByRole("img");
    await expect(thumb).toBeVisible();
    await thumbLoaded(thumb);
    await expect(chips(page)).toContainText("[Image #1]");
    await composer.pressSequentially(" Why is this red?");
    await composer.press("Enter");
    const user = chat(page).locator("[data-role=user]");
    await expect(user).toContainText("[Image #1]");
    await expect(user).toContainText("Why is this red?");
    await expect(chat(page).getByText("Seen")).toBeVisible();
    expect.soft(await user.locator("img").count(), "the message shows the image under [Image #1]").toBeGreaterThan(0);
    const [text] = messages(server);
    expect(text).toMatch(/\[Image #1\] = .*\.werk\/attachments\/.+\.png/);
    expect(text).toContain("Open each image above with Read");
    expect(text).not.toContain(PNG_BASE64);
    expect(text).not.toContain("iVBORw0KGgo");
  });
});

test("25.2 an oversized image shows its refusal and is not sent", async ({ page }) => {
  await withChat(ok, async (server) => {
    await page.goto(server.url);
    const composer = composerOf(page);
    await pasteShot(page, { kind: "png", size: 2 * 1024 * 1024 });
    await expect(chips(page).getByRole("img")).toHaveCount(1);
    await pasteShot(page, { kind: "png", size: 25 * 1024 * 1024 });
    await expect(composer).toHaveValue("[Image #1][Image #2]");
    const items = chips(page).getByRole("listitem");
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toContainText("[Image #1]");
    await thumbLoaded(items.nth(0).getByRole("img"));
    await expect(items.nth(1).getByRole("alert")).toContainText("larger than 20 MB");
    await chips(page).getByRole("button", { name: "Remove [Image #2]" }).click();
    await expect(composer).not.toHaveValue(/\[Image #2\]/);
    await composer.pressSequentially(" Why is this red?");
    await composer.press("Enter");
    await expect(chat(page).getByText("Seen")).toBeVisible();
    const [text] = messages(server);
    expect(text).toMatch(/\[Image #1\] = .*attachments\/.+\.png/);
    expect(text).not.toContain("[Image #2]");
    expect(storedFiles(server)).toHaveLength(1);
  });
});

test("25.3 removing a chip renumbers the remaining images", async ({ page }) => {
  await withChat(ok, async (server) => {
    await page.goto(server.url);
    const composer = composerOf(page);
    await pasteShot(page, { kind: "png" });
    await expect(chips(page).getByRole("img")).toHaveCount(1);
    await pasteShot(page, { kind: "png", size: 5000 });
    await expect(chips(page).getByRole("img")).toHaveCount(2);
    await expect(composer).toHaveValue("[Image #1][Image #2]");
    const names = await thumbNames(page);
    await chips(page).getByRole("button", { name: "Remove [Image #1]" }).click();
    await expect(composer).toHaveValue("[Image #1]");
    await expect(chips(page).getByRole("listitem")).toHaveCount(1);
    await expect(chips(page)).toContainText("[Image #1]");
    await expect(chips(page)).not.toContainText("[Image #2]");
    await composer.press("Enter");
    await expect(chat(page).getByText("Seen")).toBeVisible();
    const [text] = messages(server);
    expect(text).toMatch(new RegExp(`\\[Image #1\\] = .*attachments/${names[1]}`));
    expect(text).not.toContain(names[0] as string);
  });
});

test("25.4 Enter waits for a running upload", async ({ page }) => {
  await withChat(ok, async (server) => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    await page.route("**/image", async (route) => {
      if (route.request().method() === "POST") await gate;
      await route.continue();
    });
    await page.goto(server.url);
    const composer = composerOf(page);
    await pasteShot(page);
    await expect(chips(page).getByRole("status", { name: "Uploading" })).toBeVisible();
    await composer.pressSequentially(" Why is this red?");
    await composer.press("Enter");
    await page.waitForTimeout(1000);
    expect(messages(server)).toHaveLength(0);
    await expect(chat(page).locator("article")).toHaveCount(0);
    release();
    const thumb = chips(page).getByRole("img");
    await expect(chat(page).getByText("Seen")).toBeVisible();
    void thumb;
    const [text] = messages(server);
    expect(text).toMatch(/\[Image #1\] = .*attachments\/.+\.png/);
    expect(text).toMatch(/Why is this red\?$/);
  });
});

test("25.5 a request for an image with no name answers 404 and the server stays up", async ({ page }) => {
  await withChat(ok, async (server) => {
    await page.goto(server.url);
    await pasteShot(page);
    await expect(chips(page).getByRole("img")).toHaveCount(1);
    const [name] = await thumbNames(page);
    expect((await page.request.get(apiUrl(server, `/image?name=${name}`))).status()).toBe(200);
    expect((await page.request.get(apiUrl(server, "/image?name="))).status()).toBe(404);
    for (const n of ["../log.jsonl", "..%2Flog.jsonl", "..%2F..%2Fpackage.json"]) {
      const res = await fetch(apiUrl(server, `/image?name=${n}`));
      expect(res.status, n).toBe(404);
    }
    await pasteShot(page);
    await expect(chips(page).getByRole("img")).toHaveCount(2);
    await thumbLoaded(chips(page).getByRole("img").nth(1));
    await composerOf(page).press("Enter");
    await expect(chat(page).getByText("Seen")).toBeVisible();
    expect(existsSync(`${server.dir}/.werk/attachments`)).toBe(true);
    void basename;
  });
});
