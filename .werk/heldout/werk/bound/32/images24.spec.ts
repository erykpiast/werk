import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  attachments, chips, composer, gitStatus, give, MB, messages, say, START, withServer,
} from "./img-support.ts";

const open = async (page: import("@playwright/test").Page, url: string) => {
  await page.goto(url);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
};

test("24.1 pick a card from the hash menu", async ({ page }) => {
  await withServer(
    {
      before: (s) =>
        appendFileSync(
          join(s.dir, ".werk", "log.jsonl"),
          `${JSON.stringify({ type: "node.proposed", id: "werk-shots", kind: "card", title: "Pasted screenshots", status: "open", parent: "root" })}\n${JSON.stringify({ type: "node.accepted", id: "werk-shots", actor: "you" })}\n`,
        ),
    },
    async (s) => {
      await open(page, s.url);
      const box = composer(page);
      await box.click();
      await box.pressSequentially("Look at #wer");
      const menu = page.getByRole("listbox");
      await expect(menu).toBeVisible();
      const option = menu.getByRole("option");
      await expect(option).toHaveCount(1);
      await expect(option).toContainText("#werk-shots");
      await expect(option).toContainText("Pasted screenshots");
      // "a menu opens below the caret"
      const m = await menu.boundingBox();
      const b = await box.boundingBox();
      expect.soft(m!.y, "menu opens below the caret/composer top").toBeGreaterThanOrEqual(b!.y);
      await box.press("ArrowDown");
      await expect(option).toHaveAttribute("aria-selected", "true");
      await box.press("Enter");
      expect((await box.inputValue()).trim()).toBe("Look at #werk-shots");
      await expect(page.getByRole("listbox")).toHaveCount(0);
      await box.fill("");
      await box.pressSequentially("`#wer");
      await expect(page.getByRole("listbox")).toHaveCount(0);
    },
  );
});

test("24.2 a pasted PNG uploads at once and reaches the agent as a stored path", async ({ page }) => {
  await withServer({}, async (s) => {
    await open(page, s.url);
    const box = composer(page);
    await box.click();
    await box.pressSequentially("What is wrong here? ");
    await give(page, "paste");
    await expect(box).toHaveValue("What is wrong here? [Image #1]");
    await expect(chips(page)).toHaveCount(1);
    await expect(chips(page).first()).toContainText("[Image #1]");
    await expect(chips(page).first().locator("img")).toBeVisible();
    await expect
      .poll(() => chips(page).first().locator("img").evaluate((i: HTMLImageElement) => i.naturalWidth))
      .toBeGreaterThan(0);
    await box.press("Enter");
    await expect.poll(() => messages(s).length).toBe(1);
    const dir = join(s.dir, ".werk", "attachments");
    const msg = messages(s)[0];
    const m = /\[Image #1\] = (\S+)/.exec(msg);
    expect(m, msg).not.toBeNull();
    expect(m![1].startsWith(dir) || m![1].includes("/.werk/attachments/")).toBe(true);
    expect(attachments(s)).toHaveLength(1);
    expect(msg).toMatch(/Open each image above with Read/);
    expect(gitStatus(s)).not.toContain("attachments");
  });
});

test("24.3 an oversized image is refused and is not sent", async ({ page }) => {
  await withServer({}, async (s) => {
    await open(page, s.url);
    await give(page, "drop", { pad: 25 * MB });
    await expect(composer(page)).toHaveValue("[Image #1]");
    await expect(chips(page)).toHaveCount(1);
    await expect(chips(page).first().locator("[data-slot=image-reason]")).toContainText(/20 MB/);
    const box = composer(page);
    await box.click();
    await box.pressSequentially(" hello");
    await box.press("Enter");
    await expect.poll(() => messages(s).length).toBe(1);
    expect(messages(s)[0]).not.toContain("= /");
    expect(messages(s)[0]).not.toContain("attachments");
    expect(attachments(s)).toHaveLength(0);
  });
});

test("24.4 removing the first of two images renumbers the second", async ({ page }) => {
  await withServer({}, async (s) => {
    await open(page, s.url);
    await give(page, "paste", { type: "image/png", color: "red" });
    await expect(chips(page)).toHaveCount(1);
    await give(page, "paste", { type: "image/jpeg", color: "blue" });
    await expect(chips(page)).toHaveCount(2);
    await expect(composer(page)).toHaveValue("[Image #1][Image #2]");
    await expect(chips(page).locator("img")).toHaveCount(2);
    await page.getByRole("button", { name: "Remove [Image #1]" }).click();
    await expect(composer(page)).toHaveValue("[Image #1]");
    await expect(chips(page)).toHaveCount(1);
    await expect(chips(page).first()).toContainText("[Image #1]");
    const src = await chips(page).first().locator("img").getAttribute("src");
    const res = await page.request.get(new URL(src!, s.origin).toString());
    expect(res.headers()["content-type"]).toBe("image/jpeg");
    const name = new URL(src!, s.origin).searchParams.get("name")!;
    await composer(page).press("Enter");
    await expect.poll(() => messages(s).length).toBe(1);
    const m = /\[Image #1\] = (\S+)/.exec(messages(s)[0]);
    expect(m, messages(s)[0]).not.toBeNull();
    expect(m![1].endsWith(name)).toBe(true);
    expect(m![1]).toMatch(/\.jpg$/);
  });
});

test("24.5 a bad image request does not harm the server", async ({ page }) => {
  await withServer({}, async (s) => {
    await open(page, s.url);
    const name = s.dir.split("/").pop();
    const base = `${s.origin}/api/projects/${encodeURIComponent(name!)}/image`;
    const send = composer(page);
    await send.fill("hi");
    await send.press("Enter");
    await expect(page.getByRole("complementary", { name: "Chat pane" }).getByText("Seen")).toBeVisible();
    expect((await page.request.get(`${base}?name=`)).status()).toBe(404);
    expect((await page.request.get(`${base}`)).status()).toBe(404);
    for (const bad of ["../log.jsonl", "..%2Flog.jsonl", "%2e%2e%2f%2e%2e%2fproject%2f.werk%2flog.jsonl", "../../../../etc/passwd"]) {
      const r = await page.request.get(`${base}?name=${bad}`);
      expect(r.status(), bad).toBe(404);
      expect(await r.text()).not.toContain("node.proposed");
    }
    const r2 = await page.request.fetch(`${s.origin}/api/projects/${encodeURIComponent(name!)}/image/../log.jsonl`);
    expect(r2.status()).not.toBe(200);
    await send.fill("");
    await send.pressSequentially("/");
    const menu = page.getByRole("listbox");
    await expect(menu.getByRole("option")).toHaveText(["/review", "/recall"]);
  });
});
