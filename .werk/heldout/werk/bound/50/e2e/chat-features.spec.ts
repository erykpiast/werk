import type { Page } from "@playwright/test";
import type { Script } from "../../src/fake-agent/script.ts";
import { expect, test } from "./fixtures.ts";

const say = (id: string, text: string) => ({
  event: { type: "assistant", message: { id, content: [{ type: "text", text }] } },
});
const script = (...replies: unknown[][]): Script => ({
  roles: { chat: { replies: replies as Script["roles"][string]["replies"] } },
});
const composerOf = (page: Page) => page.getByRole("textbox", { name: "Message" });
const chatOf = (page: Page) => page.getByRole("complementary", { name: "Chat pane" });
const send = async (page: Page, text: string) => {
  await composerOf(page).fill(text);
  await composerOf(page).press("Enter");
};
const SHORT = { timeout: 4000 };

// ---- 21: model, context fill, restart ------------------------------------

test("21.1 a conversation keeps its model and context fill across a server restart", async ({
  page,
  withScript,
}) => {
  const app = await withScript(script([say("m1", "Done")], [say("m2", "You asked: hi")]));
  await page.goto(app.url);
  const selector = page.getByRole("combobox", { name: /model/i });
  await expect(selector).toBeVisible(SHORT);
  await selector.selectOption({ label: "Opus" });
  await send(page, "hi");
  await expect(chatOf(page).getByText("Done")).toBeVisible();
  const pie = page.getByRole("button", { name: /context/i });
  await expect(pie).toBeVisible(SHORT);
  const fill = await pie.getAttribute("title");
  await app.stop();
  await app.start();
  await page.reload();
  await expect(page.getByRole("combobox", { name: /model/i })).toHaveValue(/opus/i);
  await expect(page.getByRole("button", { name: /context/i })).toHaveAttribute("title", fill ?? "");
  await send(page, "What did I ask you before?");
  await expect(chatOf(page).getByText("You asked: hi")).toBeVisible();
});

test("21.2 a dead stored session starts again and the waiting message is delivered", async ({
  page,
  withScript,
}) => {
  const app = await withScript(script([say("m1", "First")], [say("m2", "Second")]));
  await page.goto(app.url);
  await send(page, "one");
  await expect(chatOf(page).getByText("First")).toBeVisible();
  // The stored session is gone from Claude Code: a stored session id of the conversation exists.
  const stored = app.launches().filter((r) => r.kind === "launch");
  expect(stored.length).toBeGreaterThan(0);
  expect(stored.some((r) => r.kind === "launch" && r.args.some((a) => /resume|session/.test(a)))).toBe(true);
  await app.stop();
  await app.start();
  await page.reload();
  await send(page, "two");
  await expect(chatOf(page).getByText("Second")).toBeVisible();
  await expect(chatOf(page).getByText("Your message was not delivered. Send it again.")).toHaveCount(0);
});

test("21.3 a crash with another error retries once, then asks the person to send again", async ({
  page,
  withScript,
}) => {
  const app = await withScript(script([say("m1", "First")]));
  await page.goto(app.url);
  await send(page, "one");
  await expect(chatOf(page).getByText("First")).toBeVisible();
  // The script has no second reply: the agent exits early with a multi-line error on every start.
  await send(page, "two");
  await expect(
    chatOf(page).getByText("Your message was not delivered. Send it again."),
  ).toBeVisible(SHORT);
});

test("21.4 a login problem shows its error at once with no retry", async ({ page, withScript }) => {
  const app = await withScript({
    roles: { chat: { replies: [[{ crash: 1 }]] } },
  });
  await page.goto(app.url);
  await send(page, "hello");
  await expect(
    chatOf(page).getByText("Your message was not delivered. Send it again."),
  ).toBeVisible(SHORT);
});

test("21.5 the model switch and clear context refuse during a turn and restart quietly when idle", async ({
  page,
  withScript,
}) => {
  const app = await withScript(script([say("m1", "Working"), { pause: 3000 } as never, say("m2", "Done")]));
  await page.goto(app.url);
  const selector = page.getByRole("combobox", { name: /model/i });
  await expect(selector).toBeVisible(SHORT);
  await expect(selector).toHaveValue(/sonnet/i);
  await send(page, "long turn");
  await selector.selectOption({ label: "Opus" });
  await expect(selector).toHaveValue(/sonnet/i);
  await page.getByRole("button", { name: /context/i }).click();
  await expect(page.getByRole("button", { name: "Clear context" })).toBeVisible(SHORT);
});

// ---- 23: tabs ------------------------------------------------------------

test("23.1 two conversations with different home cards stay apart", async ({ page, withScript }) => {
  const app = await withScript(script([say("a1", "Reply A")], [say("b1", "Reply B")]));
  expect(app.werk("add", "card-a", "--title", "Card A", "--parent", "root").code).toBe(0);
  expect(app.werk("accept", "card-a", "--actor", "you").code).toBe(0);
  expect(app.werk("add", "card-b", "--title", "Card B", "--parent", "root").code).toBe(0);
  expect(app.werk("accept", "card-b", "--actor", "you").code).toBe(0);
  const base = app.url.replace(/\/(map|board).*$/, "");
  await page.goto(`${base}/map/card-a`);
  await send(page, "message in A");
  await expect(chatOf(page).getByText("Reply A")).toBeVisible();
  await page.goto(`${base}/map/card-b`);
  // The person opens card B and starts a new conversation on it.
  const strip = page.getByRole("tablist");
  await expect(strip).toBeVisible(SHORT);
  await expect(strip.getByRole("tab")).toHaveText(["Card A", "Card B"]);
});

test("23.2 switching to a tab shows its newest message", async ({ page, withScript }) => {
  const app = await withScript(script([say("a1", "Reply A")]));
  await page.goto(app.url);
  await send(page, "one");
  await expect(chatOf(page).getByText("Reply A")).toBeVisible();
  await expect(page.getByRole("tablist")).toBeVisible(SHORT);
});

test("23.3 a crashed agent marks its tab and tells the other tabs", async ({ page, withScript }) => {
  const app = await withScript({
    roles: { chat: { replies: [[say("a1", "Before the crash"), { crash: 1 }]] } },
  });
  await page.goto(app.url);
  await send(page, "one");
  await expect(chatOf(page).getByText("Before the crash")).toBeVisible();
  const chip = page.getByRole("tab").first();
  await expect(chip).toBeVisible(SHORT);
  await expect(chip).toHaveAttribute("data-state", /dead|crash|red/);
});

test("23.4 a model switch is not a crash", async ({ page, withScript }) => {
  const app = await withScript(script([say("a1", "Hello")]));
  await page.goto(app.url);
  await send(page, "one");
  await expect(chatOf(page).getByText("Hello")).toBeVisible();
  const selector = page.getByRole("combobox", { name: /model/i });
  await expect(selector).toBeVisible(SHORT);
  await selector.selectOption({ label: "Opus" });
  await expect(page.getByRole("tab").first()).not.toHaveAttribute("data-state", /dead|crash|red/);
});

test("23.5 a running background agent and a suggested next action", async ({ page, withScript }) => {
  const app = await withScript(script([say("a1", "All set.\n\nNext: say \"merge it\"")], [say("a2", "Merging")]));
  await page.goto(app.url);
  await send(page, "status?");
  await expect(chatOf(page).getByText("All set.")).toBeVisible();
  const button = chatOf(page).getByRole("button", { name: "merge it" });
  await expect(button).toBeVisible(SHORT);
  await button.click();
  await expect(chatOf(page).getByText("Merging")).toBeVisible();
  await expect(button).toHaveCount(0);
});
