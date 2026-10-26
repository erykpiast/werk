import { chat, composerOf, expect, launchArgs, messages, say, send, withServer } from "./chatkit.ts";
import { test } from "./fixtures.ts";

const usage = (tokens: number) => ({
  event: { type: "assistant", message: { id: `u${tokens}`, content: [{ type: "text", text: "Answer" }], usage: { input_tokens: tokens, output_tokens: 0 } } },
});
const model = (page: import("@playwright/test").Page) => chat(page).getByLabel("Model");
const selectedLabel = (page: import("@playwright/test").Page) => model(page).evaluate((el: HTMLSelectElement) => el.selectedOptions[0]?.textContent);
const pie = (page: import("@playwright/test").Page) => chat(page).locator("[data-slot=context-pie]");
const DEAD = "No conversation found with session ID: fake-session-1";

test("21.1 a conversation keeps its model and context fill across a server restart", async ({ page }) => {
  await withServer({ roles: { chat: { replies: [[usage(60000)], [say("m2", "You asked: Hello")]] } } }, async (server) => {
    await page.goto(server.url);
    await expect(model(page)).toBeVisible();
    await model(page).selectOption({ label: "Opus" });
    await send(page, "Hello");
    await expect(chat(page).getByText("Answer")).toBeVisible();
    const fill = await pie(page).getAttribute("aria-label");
    expect(fill).toMatch(/Context \d+% full/);
    expect(fill).not.toBe("Context 0% full");
    await server.stop();
    await server.start();
    await page.goto(server.url);
    expect(await selectedLabel(page)).toBe("Opus");
    await expect(pie(page)).toHaveAttribute("aria-label", fill as string);
    await send(page, "What did I ask you before?");
    await expect(chat(page).getByText("You asked: Hello")).toBeVisible();
    const launches = launchArgs(server);
    const last = launches.at(-1) as string[];
    expect(last).toContain("--resume");
    expect(last[last.indexOf("--resume") + 1]).toBe("fake-session-1");
  });
});

test("21.2 a dead stored session starts again and the waiting message is delivered", async ({ page }) => {
  const dead = [{ stderr: DEAD }, { crash: 1 }];
  await withServer({ roles: { chat: { replies: [[say("m1", "First answer")], dead, [say("m3", "New session answer")]] } } }, async (server) => {
    await page.goto(server.url);
    await send(page, "Hello");
    await expect(chat(page).getByText("First answer")).toBeVisible();
    await server.stop();
    await server.start();
    await page.goto(server.url);
    await send(page, "Second message");
    await expect(chat(page).getByText("New session answer")).toBeVisible();
    await expect(chat(page).getByText("Your message was not delivered. Send it again.")).toHaveCount(0);
    expect(messages(server).filter((m) => m.endsWith("Second message")).length).toBeGreaterThanOrEqual(1);
    const launches = launchArgs(server);
    expect(launches.at(-1)).not.toContain("--resume");
  });
});

test("21.3 a crash with another error retries once, asks to send again, shows the whole error", async ({ page }) => {
  const boom = [{ stderr: "boom line one\nboom line two\nboom line three" }, { crash: 1 }];
  await withServer({ roles: { chat: { replies: [[say("m1", "First answer")], boom, boom, [say("m4", "Back again")]] } } }, async (server) => {
    await page.goto(server.url);
    await send(page, "Hello");
    await expect(chat(page).getByText("First answer")).toBeVisible();
    const before = launchArgs(server).length;
    await send(page, "Second");
    await expect(chat(page).getByText("Your message was not delivered. Send it again.")).toBeVisible();
    for (const line of ["boom line one", "boom line two", "boom line three"]) await expect(chat(page).getByText(line).first()).toBeVisible();
    // one first start of the failing turn and one retry
    expect(launchArgs(server).length - before).toBe(1);
    expect(launchArgs(server).length).toBe(3);
    await send(page, "Third");
    await expect(chat(page).getByText("Back again")).toBeVisible();
    const last = launchArgs(server).at(-1) as string[];
    expect(last[last.indexOf("--resume") + 1]).toBe("fake-session-1");
  });
});

test("21.4 a login problem shows its error at once with no retry", async ({ page }) => {
  const login = [{ stderr: "Error: not logged in\nPlease run claude auth login" }, { crash: 1 }];
  await withServer({ roles: { chat: { replies: [login, login] } } }, async (server) => {
    await page.goto(server.url);
    await send(page, "Hello");
    await expect(chat(page).getByText("Please run claude auth login").first()).toBeVisible();
    await expect(chat(page).getByText("Error: not logged in").first()).toBeVisible();
    await page.waitForTimeout(1500);
    expect(launchArgs(server)).toHaveLength(1);
    await expect(chat(page).getByText("Your message was not delivered. Send it again.")).toBeVisible({ timeout: 2000 });
  });
});

test("21.5 model switch and clear context refuse during a turn and restart quietly when idle", async ({ page }) => {
  await withServer({ roles: { chat: { replies: [[say("m1", "Working"), { pause: 3500 }, say("m2", "Finished")], [say("m3", "After clear")]] } } }, async (server) => {
    await page.goto(server.url);
    await expect(model(page)).toBeVisible();
    await model(page).selectOption({ label: "Sonnet" });
    expect(await selectedLabel(page)).toBe("Sonnet");
    await expect(pie(page)).toHaveAttribute("data-level", "blue");
    await send(page, "Make a long turn");
    await expect(chat(page).getByText("Working")).toBeVisible();
    // The switch is refused: the control is disabled and the choice stays.
    await expect(model(page)).toBeDisabled();
    expect(await selectedLabel(page)).toBe("Sonnet");
    await expect(chat(page).getByText("Finished")).toBeVisible({ timeout: 15000 });
    await expect(model(page)).toBeEnabled();
    await model(page).selectOption({ value: "sonnet+opus" });
    expect(await selectedLabel(page)).toBe("Sonnet with Opus advisor");
    await expect(chat(page).getByText(/crash|exited|failed|stopped/i)).toHaveCount(0);
    await pie(page).click();
    const dialog = chat(page).getByRole("dialog");
    await expect(dialog).toContainText(/\d+% of the context window is in use/);
    await dialog.getByRole("button", { name: "Clear context" }).click();
    await expect(chat(page).getByText(/crash|exited|failed|stopped/i)).toHaveCount(0);
    await send(page, "Another one");
    await expect(chat(page).getByText("After clear")).toBeVisible();
  });
});
