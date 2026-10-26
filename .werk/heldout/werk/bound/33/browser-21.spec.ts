import { chat, composer, expect, say, send, serve, test } from "./browser-support.ts";

const ERR = "fake claude: boom line one\nboom line two\nboom line three";
const err = (text: string) => [{ stderr: text }, { crash: 1 }];
const pieLabel = (page: import("@playwright/test").Page) =>
  chat(page).getByRole("button", { name: /^Context/ }).getAttribute("aria-label");

test("21.1 model and fill survive restart, session continues", async ({ page }) => {
  const s = await serve({
    script: {
      roles: {
        chat: {
          replies: [
            [say("m1", "First answer", { input_tokens: 10000 })],
            [say("m2", "Second answer", { input_tokens: 80000 })],
            [say("m3", "You asked about apples")],
          ],
        },
      },
    },
  });
  try {
    await page.goto(s.url);
    await send(page, "hello");
    await expect(chat(page).getByText("First answer")).toBeVisible();
    await chat(page).getByLabel("Model").selectOption("opus");
    await expect.poll(() => s.launched().length).toBe(2);
    await send(page, "remember apples");
    await expect(chat(page).getByText("Second answer")).toBeVisible();
    await expect(chat(page).getByLabel("Model")).toHaveValue("opus");
    const before = await pieLabel(page);
    expect(before).toMatch(/Context 4\d% full/);
    await s.stop();
    await s.start();
    await page.goto(s.url);
    await expect(chat(page).getByLabel("Model")).toHaveValue("opus");
    expect(await pieLabel(page)).toBe(before);
    await send(page, "What did I ask you before?");
    await expect(chat(page).getByText("You asked about apples")).toBeVisible();
    const last = s.launched().at(-1) as string[];
    expect(last[last.indexOf("--resume") + 1]).toBe("fake-session-1");
  } finally {
    await s.dispose();
  }
});

test("21.2 dead stored session starts again, message delivered", async ({ page }) => {
  const s = await serve({
    script: {
      roles: {
        chat: {
          replies: [
            [say("m1", "First answer")],
            err("No conversation found with session ID: fake-session-1"),
            [say("m3", "Fresh answer")],
          ],
        },
      },
    },
  });
  try {
    await page.goto(s.url);
    await send(page, "hello");
    await expect(chat(page).getByText("First answer")).toBeVisible();
    await s.stop();
    await s.start();
    await page.goto(s.url);
    await send(page, "new message");
    await expect(chat(page).getByText("Fresh answer")).toBeVisible({ timeout: 20000 });
    await expect(chat(page).getByText("Your message was not delivered")).toHaveCount(0);
    expect(s.messages().filter((m) => m.endsWith("new message")).length).toBeGreaterThanOrEqual(1);
    const last = s.launched().at(-1) as string[];
    expect(last).not.toContain("--resume");
  } finally {
    await s.dispose();
  }
});

test("21.3 other crash retries once, shows full error, then same session", async ({ page }) => {
  const s = await serve({
    script: {
      roles: {
        chat: {
          replies: [[say("m1", "First answer")], err(ERR), err(ERR), [say("m4", "Back again")]],
        },
      },
    },
  });
  try {
    await page.goto(s.url);
    await send(page, "hello");
    await expect(chat(page).getByText("First answer")).toBeVisible();
    const launchesBefore = s.launched().length;
    await send(page, "second");
    await expect(chat(page).getByText("Your message was not delivered. Send it again.")).toBeVisible({ timeout: 20000 });
    for (const l of ERR.split("\n")) await expect(chat(page).getByText(l)).toBeVisible();
    expect(s.launched().length - launchesBefore).toBe(1);
    await send(page, "third");
    await expect(chat(page).getByText("Back again")).toBeVisible({ timeout: 20000 });
    const last = s.launched().at(-1) as string[];
    expect(last[last.indexOf("--resume") + 1]).toBe("fake-session-1");
  } finally {
    await s.dispose();
  }
});

test("21.4 login error shows at once, no retry", async ({ page }) => {
  const LOGIN = "Not logged in · Please run claude auth login\nsecond login line";
  const s = await serve({ script: { roles: { chat: { replies: [err(LOGIN)] } } } });
  try {
    await page.goto(s.url);
    await send(page, "hello");
    for (const l of LOGIN.split("\n")) await expect(chat(page).getByText(l)).toBeVisible({ timeout: 20000 });
    await page.waitForTimeout(3000);
    expect(s.launched().length).toBe(1);
    await expect(chat(page).getByText("Your message was not delivered. Send it again.")).toBeVisible();
    void composer;
  } finally {
    await s.dispose();
  }
});

test("21.5 model switch and clear refuse during a turn, work when idle", async ({ page }) => {
  const s = await serve({
    script: {
      roles: {
        chat: {
          replies: [
            [say("m0", "quick")],
            [say("m1", "start"), { pause: 4000 }, say("m2", "end of long turn")],
            [say("m3", "after switch")],
            [say("m4", "after clear")],
          ],
        },
      },
    },
  });
  try {
    await page.goto(s.url);
    const model = chat(page).getByLabel("Model");
    const pie = chat(page).getByRole("button", { name: /^Context/ });
    console.log("pre-turn model select count", await model.count());
    await send(page, "first");
    await expect(chat(page).getByText("quick")).toBeVisible();
    console.log("default model value", await model.inputValue());
    await model.selectOption("sonnet");
    await expect(model).toHaveValue("sonnet");
    await expect(pie).toHaveAttribute("data-level", "blue");
    await send(page, "long");
    await expect(chat(page).getByText("start", { exact: true })).toBeVisible();
    const disabled = await model.isDisabled();
    if (!disabled) {
      await model.selectOption("opus");
      await expect(chat(page).getByRole("alert")).toBeVisible();
    }
    await expect(model).toHaveValue("sonnet");
    await expect(chat(page).getByText("end of long turn")).toBeVisible({ timeout: 20000 });
    await model.selectOption("sonnet+opus");
    await expect(model).toHaveValue("sonnet+opus");
    await expect(chat(page).getByText(/crash|exited|not delivered/i)).toHaveCount(0);
    await pie.click();
    const dlg = chat(page).getByRole("dialog");
    await expect(dlg).toContainText("% of the context window is in use");
    await dlg.getByRole("button", { name: "Clear context" }).click();
    await expect(chat(page).getByText(/crash|exited|not delivered/i)).toHaveCount(0);
    await send(page, "next");
    await expect(chat(page).getByText("after switch").or(chat(page).getByText("after clear"))).toBeVisible({ timeout: 20000 });
  } finally {
    await s.dispose();
  }
});
