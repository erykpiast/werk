import { expect, test } from "@playwright/test";
import { chat, chatScript, composer, launched, left, messages, ROOT_EVENTS, say, send, serve } from "./helpers.ts";

const usage = (id: string, text: string, tokens: number) => ({
  event: { type: "assistant", message: { id, content: [{ type: "text", text }], usage: { input_tokens: tokens, output_tokens: 0 } } },
});
const arg = (args: string[], flag: string) => args[args.indexOf(flag) + 1];
const NOT_DELIVERED = "Your message was not delivered. Send it again.";

test("21.1 a conversation keeps its model and context fill across a server restart", async ({ page }) => {
  await serve({ log: ROOT_EVENTS, script: chatScript([usage("m1", "First answer", 80000)], [say("m2", "You asked: Hello")]) }, async (server) => {
    await page.goto(server.url);
    await expect(left(page).getByRole("heading", { level: 1 })).toBeVisible();
    await chat(page).getByLabel("Model").selectOption({ label: "Opus" });
    await send(page, "Hello");
    await expect(chat(page).getByText("First answer")).toBeVisible();
    const pie = chat(page).getByRole("button", { name: /^Context/ });
    await expect(pie).toHaveAttribute("aria-label", "Context 40% full");
    const before = await pie.getAttribute("aria-label");
    await server.stop();
    await server.start();
    await page.goto(server.url);
    await expect(chat(page).getByLabel("Model")).toHaveValue("opus");
    await expect(chat(page).getByLabel("Model").locator("option:checked")).toHaveText("Opus");
    await expect(chat(page).getByRole("button", { name: /^Context/ })).toHaveAttribute("aria-label", before as string);
    await send(page, "What did I ask you before?");
    await expect(chat(page).getByText("You asked: Hello")).toBeVisible();
    const launches = launched(server);
    const last = launches.at(-1) as string[];
    expect(arg(last, "--resume")).toBe("fake-session-1");
    expect(arg(last, "--model")).toBe("claude-opus-5-5");
  });
});

test("21.2 a dead stored session starts again and the waiting message is delivered", async ({ page }) => {
  const script = chatScript(
    [say("m1", "First answer")],
    [{ stderr: "No conversation found with session ID: fake-session-1" }, { crash: 1 }],
    [say("m3", "Fresh answer")],
  );
  await serve({ log: ROOT_EVENTS, script }, async (server) => {
    await page.goto(server.url);
    await send(page, "Hello");
    await expect(chat(page).getByText("First answer")).toBeVisible();
    await server.stop();
    await server.start();
    await page.goto(server.url);
    await send(page, "Second message");
    await expect(chat(page).getByText("Fresh answer")).toBeVisible({ timeout: 30000 });
    await expect(chat(page).getByText(NOT_DELIVERED)).toHaveCount(0);
    const launches = launched(server);
    const last = launches.at(-1) as string[];
    expect(last).not.toContain("--resume");
    expect(messages(server).filter((m) => m.endsWith("Second message"))).toHaveLength(2);
  });
});

test("21.3 a crash with another error retries once, then asks the person to send again and shows the whole error", async ({ page }) => {
  const err = "boom line one\nboom line two\nboom line three";
  const script = chatScript(
    [say("m1", "First answer")],
    [{ stderr: err }, { crash: 1 }],
    [{ stderr: err }, { crash: 1 }],
    [say("m4", "Recovered")],
  );
  await serve({ log: ROOT_EVENTS, script }, async (server) => {
    await page.goto(server.url);
    await send(page, "Hello");
    await expect(chat(page).getByText("First answer")).toBeVisible();
    expect(launched(server)).toHaveLength(1);
    await send(page, "Second message");
    await expect(chat(page).getByText(NOT_DELIVERED)).toBeVisible({ timeout: 30000 });
    for (const line of err.split("\n")) await expect(chat(page)).toContainText(line);
    expect(launched(server)).toHaveLength(2);
    await send(page, "Again");
    await expect(chat(page).getByText("Recovered")).toBeVisible({ timeout: 30000 });
    const last = launched(server).at(-1) as string[];
    expect(arg(last, "--resume")).toBe("fake-session-1");
  });
});

test("21.4 a login problem shows its error at once with no retry", async ({ page }) => {
  const err = "Invalid API key\nPlease run claude auth login\nthird line";
  await serve({ log: ROOT_EVENTS, script: chatScript([{ stderr: err }, { crash: 1 }], [say("m2", "never")]) }, async (server) => {
    await page.goto(server.url);
    await send(page, "Hello");
    for (const line of err.split("\n")) await expect(chat(page)).toContainText(line, { timeout: 30000 });
    await expect(chat(page).getByText(NOT_DELIVERED)).toBeVisible();
    expect(launched(server)).toHaveLength(1);
  });
});

test("21.5 the model switch and clear context refuse during a turn and restart quietly when idle", async ({ page }) => {
  const script = chatScript([say("m1", "Working"), { pause: 5000 }, say("m2", "Long done")], [say("m3", "After clear")], [say("m4", "x")], [say("m5", "y")]);
  await serve({ log: ROOT_EVENTS, script }, async (server) => {
    await page.goto(server.url);
    const select = chat(page).getByLabel("Model");
    // the default pick is Sonnet with the advisor, so the person picks plain Sonnet first
    await select.selectOption({ label: "Sonnet" });
    await expect(select.locator("option:checked")).toHaveText("Sonnet");
    await expect(chat(page).getByRole("button", { name: /^Context/ })).toHaveAttribute("data-level", "blue");
    await send(page, "Make a long turn");
    await expect(chat(page).getByText("Working")).toBeVisible();
    // the person tries Opus while the turn runs
    await select.selectOption({ label: "Opus" }, { timeout: 2000, force: true }).catch(() => {});
    await expect(select.locator("option:checked")).toHaveText("Sonnet");
    await expect(chat(page).getByText("Long done")).toBeVisible({ timeout: 30000 });
    // the third choice is labelled "Sonnet + Opus advisor" in the product
    await select.selectOption("sonnet+opus", { timeout: 5000 });
    await expect(select.locator("option:checked")).toHaveText(/^Sonnet\W+(with\W+)?Opus advisor$/);
    await expect(chat(page).getByText(/not delivered|crash|exited/i)).toHaveCount(0);
    await chat(page).getByRole("button", { name: /^Context/ }).click();
    const dialog = chat(page).getByRole("dialog");
    await expect(dialog).toContainText("% of the context window is in use");
    await dialog.getByRole("button", { name: "Clear context" }).click();
    await expect(chat(page).getByText(/not delivered|crash|exited/i)).toHaveCount(0);
    await send(page, "Next one");
    await expect(chat(page).getByText("After clear")).toBeVisible({ timeout: 30000 });
  });
});
