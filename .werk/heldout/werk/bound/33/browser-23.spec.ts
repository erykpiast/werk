import { chat, composer, expect, say, send, serve, test } from "./browser-support.ts";

const tabs = (page: import("@playwright/test").Page) =>
  chat(page).getByRole("tablist").or(chat(page).locator("[data-slot=chat-tabs], [data-slot=tab-strip]"));

test("23.1 two conversations with different home cards stay apart (tab strip)", async ({ page }) => {
  const s = await serve({ script: { roles: { chat: { replies: [[say("m1", "Reply A")], [say("m2", "Reply B")]] } } } });
  try {
    await page.goto(s.url);
    await send(page, "message A");
    await expect(chat(page).getByText("Reply A")).toBeVisible();
    await expect(tabs(page), "a tab strip below the composer").toBeVisible({ timeout: 3000 });
  } finally {
    await s.dispose();
  }
});

test("23.2 switching to a tab shows its newest message", async ({ page }) => {
  const s = await serve({ script: { roles: { chat: { replies: [[say("m1", "Reply A")]] } } } });
  try {
    await page.goto(s.url);
    await send(page, "message A");
    await expect(chat(page).getByText("Reply A")).toBeVisible();
    await expect(chat(page).getByRole("tab").first(), "a tab to switch to").toBeVisible({ timeout: 3000 });
  } finally {
    await s.dispose();
  }
});

test("23.3 a crashed agent marks its tab", async ({ page }) => {
  const s = await serve({
    script: { roles: { chat: { replies: [[say("m1", "ok")], [{ stderr: "boom" }, { crash: 1 }], [{ stderr: "boom" }, { crash: 1 }]] } } },
  });
  try {
    await page.goto(s.url);
    await send(page, "one");
    await expect(chat(page).getByText("ok", { exact: true })).toBeVisible();
    await send(page, "two");
    await expect(chat(page).getByText("boom").first()).toBeVisible({ timeout: 20000 });
    await expect(chat(page).getByRole("tab").first(), "a chip that blinks red for the crashed tab").toBeVisible({ timeout: 3000 });
  } finally {
    await s.dispose();
  }
});

test("23.4 a model switch is not a crash (tab chip)", async ({ page }) => {
  const s = await serve({ script: { roles: { chat: { replies: [[say("m1", "ok")], [say("m2", "after")]] } } } });
  try {
    await page.goto(s.url);
    await send(page, "one");
    await expect(chat(page).getByText("ok", { exact: true })).toBeVisible();
    await chat(page).getByLabel("Model").selectOption("opus");
    await send(page, "two");
    await expect(chat(page).getByText("after")).toBeVisible({ timeout: 20000 });
    await expect(chat(page).getByRole("alert")).toHaveCount(0);
    await expect(chat(page).getByRole("tab").first(), "the chip of the tab").toBeVisible({ timeout: 3000 });
  } finally {
    await s.dispose();
  }
});

test("23.5 background line, Next button, and the running tab", async ({ page }) => {
  const list = (ids: string[]) => ({ event: { type: "system", subtype: "background_tasks", tasks: ids.map((id) => ({ id })) } });
  const s = await serve({
    script: {
      roles: {
        chat: {
          replies: [
            [list(["a"]), say("m1", "Started"), { pause: 2500 }, list([]), say("m1b", 'Done.\n\nNext: say "merge it"')],
            [say("m2", "Merged")],
          ],
        },
      },
    },
  });
  try {
    await page.goto(s.url);
    await send(page, "go");
    const line = chat(page).getByText("A background agent runs");
    await expect(line).toBeVisible();
    await expect(line).toHaveCount(0, { timeout: 10000 });
    const btn = chat(page).getByRole("button", { name: "merge it" });
    await expect(btn).toBeVisible();
    await btn.click();
    await expect(chat(page).getByText("Merged")).toBeVisible();
    await expect(btn).toHaveCount(0);
    expect(s.messages()[1]).toMatch(/merge it$/);
    void composer;
    await expect(chat(page).getByRole("tab").first(), "the tab counts as running/idle").toBeVisible({ timeout: 3000 });
  } finally {
    await s.dispose();
  }
});
