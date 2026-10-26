// Held-out: conversation persistence and agent exits, steps 21.1-21.5.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";
import { test } from "../e2e/harness.ts";
import { SCRIPT_FILE } from "../src/test/fake-script.ts";
import { done, init, launches, open, pane, reply, say, start, turns } from "./g-util.ts";

const NOT_DELIVERED = "Your message was not delivered. Send it again.";

let fake = "";
test.beforeEach(() => {
  fake = mkdtempSync(join(tmpdir(), "werk-ho-fake-"));
});
test.afterEach(() => rmSync(fake, { recursive: true, force: true }));

const script = (roles: object) => writeFileSync(join(fake, SCRIPT_FILE), JSON.stringify({ roles }));
const env = () => ({ ...process.env, FAKE_AGENT_DIR: fake });
const model = (p: Page) => pane(p).getByRole("combobox", { name: "Model" });
const shownModel = (p: Page) => model(p).evaluate((s) => (s as HTMLSelectElement).selectedOptions[0]?.text ?? "");
const pie = (p: Page) => pane(p).locator('button[aria-label^="Context"]');

test("21.1 a conversation keeps its model and context fill across a server restart", async ({ page: p, harness }) => {
  script({
    chat: {
      sessions: ["s1"],
      replies: [[init("s1"), start("m1"), open("Hello back."), done("m1", "Hello back.", { input_tokens: 50000 })]],
    },
  });
  const w = await harness.start({ env: env() });
  await p.goto(`${w.url}/map`);
  await model(p).selectOption({ label: "Opus" });
  await expect.poll(() => shownModel(p)).toBe("Opus");
  await say(p, "Hello there");
  await expect(turns(p).nth(0).locator('[data-role="turn-end"]')).toBeVisible();
  await expect(pie(p)).not.toHaveAttribute("aria-label", "Context 0%");
  const fill = await pie(p).getAttribute("aria-label");
  await w.restart();
  await p.goto(`${w.url}/map`);
  await expect.poll(() => shownModel(p)).toBe("Opus");
  await expect(pie(p)).toHaveAttribute("aria-label", fill ?? "");
  script({ chat: { sessions: ["s1"], replies: [[init("s1"), ...reply("m2", "You asked: Hello there")]] } });
  await say(p, "What did I ask you before?");
  await expect(turns(p).last().locator(".msg.agent")).toHaveText("You asked: Hello there");
  const last = launches(fake).at(-1);
  expect(launches(fake)).toHaveLength(2);
  const at = last?.args.indexOf("--resume") ?? -1;
  expect(at).toBeGreaterThanOrEqual(0);
  expect(last?.args[at + 1]).toBe("s1");
  expect(last?.args[last.args.indexOf("--model") + 1]).toBe("claude-opus-5-5");
});

test("21.2 a dead stored session starts again and the waiting message is delivered", async ({ page: p, harness }) => {
  script({ chat: { sessions: [], replies: [[init("s1"), ...reply("m1", "first answer")]] } });
  const w = await harness.start({ env: env() });
  await p.goto(`${w.url}/map`);
  await say(p, "First message");
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("first answer");
  await w.restart();
  script({ chat: { sessions: [], replies: [[init("s2"), ...reply("m2", "second answer")]] } });
  await p.goto(`${w.url}/map`);
  await say(p, "Second message");
  await expect(turns(p).last().locator(".msg.agent")).toHaveText("second answer");
  await expect(pane(p)).not.toContainText(NOT_DELIVERED);
  await expect(turns(p).locator(".msg.user")).toHaveText(["Second message"]);
  const all = launches(fake);
  expect(all).toHaveLength(3);
  expect(all[1]?.args).toContain("--resume");
  expect(all[2]?.args).not.toContain("--resume");
  expect(all[2]?.messages.some((m) => m.endsWith("Second message"))).toBe(true);
});

test("21.3 a crash with another error retries once, then asks to send again with the whole error", async ({
  page: p,
  harness,
}) => {
  script({ chat: { sessions: ["s1"], replies: [[init("s1"), ...reply("m1", "first answer")]] } });
  const w = await harness.start({ env: env() });
  await p.goto(`${w.url}/map`);
  await say(p, "First message");
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("first answer");
  await w.restart();
  const lines = ["panic: runner broke", "  at step one", "  at step two"];
  script({ chat: { sessions: ["s1"], replies: [[{ stderr: `${lines.join("\n")}\n` }, { crash: 3 }]] } });
  await p.goto(`${w.url}/map`);
  await say(p, "Second message");
  await expect(pane(p)).toContainText(NOT_DELIVERED, { timeout: 15000 });
  for (const line of lines) await expect(pane(p).locator('[data-role="agent-error"]')).toContainText(line.trim());
  expect(launches(fake)).toHaveLength(3);
  script({ chat: { sessions: ["s1"], replies: [[init("s1"), ...reply("m3", "third answer")]] } });
  await say(p, "Second message");
  await expect(turns(p).last().locator(".msg.agent")).toHaveText("third answer");
  const last = launches(fake).at(-1);
  expect(last?.args[(last?.args.indexOf("--resume") ?? -2) + 1]).toBe("s1");
});

test("21.4 a login problem shows its error at once with no retry", async ({ page: p, harness }) => {
  const lines = ["Error: Not logged in.", "Please run claude auth login", "Then try again."];
  script({ chat: { replies: [[{ stderr: `${lines.join("\n")}\n` }, { crash: 1 }]] } });
  const w = await harness.start({ env: env() });
  await p.goto(`${w.url}/map`);
  await say(p, "Hello");
  await expect(pane(p).locator('[data-role="agent-error"]')).toBeVisible({ timeout: 15000 });
  for (const line of lines) await expect(pane(p).locator('[data-role="agent-error"]')).toContainText(line);
  await p.waitForTimeout(1500);
  expect(launches(fake)).toHaveLength(1);
  await expect(pane(p)).toContainText(NOT_DELIVERED);
});

test("21.5 model switch and clear refuse during a turn and restart quietly when idle", async ({ page: p, harness }) => {
  script({
    chat: { replies: [[start("m1"), open("Working"), { pause: 4000 }, done("m1", "Long turn done.")]] },
  });
  const w = await harness.start({ env: env() });
  await p.goto(`${w.url}/map`);
  await model(p).selectOption({ label: "Sonnet" });
  await expect.poll(() => shownModel(p)).toBe("Sonnet");
  const bg = await pie(p).evaluate((b) => (b as HTMLElement).style.background);
  expect(bg).toMatch(/rgb\(14, 165, 233\)|#0ea5e9/i);
  await say(p, "Do a long job");
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("Working");
  const picked = await model(p)
    .selectOption({ label: "Opus" }, { timeout: 1500 })
    .then(() => true)
    .catch(() => false);
  expect(picked).toBe(false);
  // The server refuses as well while the turn runs.
  const token = await p.locator('meta[name="werk-token"]').getAttribute("content");
  const r = await fetch(`${w.url}/api/model`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-werk-token": token ?? "" },
    body: JSON.stringify({ model: "claude-opus-5-5", advisor: null }),
  });
  expect(r.ok).toBe(false);
  expect(await shownModel(p)).toBe("Sonnet");
  await expect(turns(p).nth(0).locator('[data-role="turn-end"]')).toBeVisible({ timeout: 10000 });
  await model(p).selectOption({ label: "Sonnet + Opus advisor" });
  await expect.poll(() => shownModel(p)).toBe("Sonnet + Opus advisor");
  await p.waitForTimeout(1000);
  await expect(pane(p).locator('[data-role="agent-error"]')).toHaveCount(0);
  await expect(pane(p)).not.toContainText("exited");
  await expect(pane(p)).not.toContainText(NOT_DELIVERED);
  await pie(p).click();
  const pop = pane(p).getByRole("dialog", { name: "Context" });
  await expect(pop).toContainText("%");
  await pop.getByRole("button", { name: "Clear context" }).click();
  await p.waitForTimeout(1000);
  await expect(pane(p).locator('[data-role="agent-error"]')).toHaveCount(0);
  await expect(pane(p)).not.toContainText(NOT_DELIVERED);
  await say(p, "Next message");
  await expect(turns(p).last().locator(".msg.agent")).toHaveText("Long turn done.", { timeout: 15000 });
});
