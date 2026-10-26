import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect } from "@playwright/test";
import { FAKE_BIN, test, type Werk } from "../e2e/harness.ts";
import { cleanEnv } from "../src/test/clean-env.ts";
import { FAKE_DIR_VAR, SCRIPT_FILE } from "../src/test/fake-script.ts";
import { answers, askLog, launchArgs, pane, reply, say, turns, useFake } from "./chat-helpers.ts";

let fakeOf = "";
type H = { start(o: object): Promise<Werk> };
async function boot(h: H, script: object): Promise<Werk> {
  const dir = join(tmpdir(), `werk-heldout-fake22-${process.pid}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, SCRIPT_FILE), JSON.stringify(script));
  useFake(dir);
  fakeOf = dir;
  return h.start({ env: { ...cleanEnv(process.env, FAKE_BIN), [FAKE_DIR_VAR]: dir } });
}
async function watchDisabled(p: import("@playwright/test").Page): Promise<void> {
  await p.evaluate(() => {
    const w = window as unknown as { __allDisabled?: boolean };
    w.__allDisabled = false;
    new MutationObserver(() => {
      const bars = [...document.querySelectorAll("[data-ask]")];
      for (const bar of bars) {
        const buttons = [...bar.querySelectorAll("button")];
        if (buttons.length > 0 && buttons.every((b) => b.disabled || b.closest("fieldset[disabled]") !== null && false))
          w.__allDisabled = true;
      }
    }).observe(document.body, { subtree: true, childList: true, attributes: true });
  });
}
const sawDisabled = (p: import("@playwright/test").Page) =>
  p.evaluate(() => (window as unknown as { __allDisabled?: boolean }).__allDisabled);
const ended = (p: import("@playwright/test").Page, n = 0) => turns(p).nth(n).locator('[data-role="turn-end"]');
const mkdir = { type: "addRules", rules: [{ toolName: "Bash", ruleContent: "mkdir:*" }], behavior: "allow" };

test("22.1 Allow once: ask bar content, disabled buttons, turn finishes, ask log", async ({ page: p, harness }) => {
  const input = { command: "curl -s https://example.com" };
  const w = await boot(harness, {
    roles: { chat: { replies: [[{ ask: { id: "r1", tool: "Bash", input, reason: "rule" } }, ...reply("m1", "Fetched it.")]] } },
  });
  await p.goto(`${w.url}/map`);
  await say(p, "Fetch the page");
  const ask = pane(p).getByRole("region", { name: "Bash wants to run" });
  await expect(ask).toContainText("Bash");
  await expect(ask.locator("[data-role=ask-call]")).toContainText("curl -s https://example.com");
  await expect(ask.locator("[data-role=ask-call] code")).toHaveCount(1);
  await expect(ask.locator("[data-role=ask-reason]")).toContainText("rule");
  await expect(ask.getByRole("button")).toHaveText(["Allow once", "Deny"]);
  await watchDisabled(p);
  await ask.getByRole("button", { name: "Allow once" }).click();
  await expect(ended(p)).toBeVisible();
  expect(await sawDisabled(p)).toBe(true);
  await expect(ended(p)).toBeVisible();
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("Fetched it.");
  expect(answers(w)).toEqual([{ behavior: "allow", updatedInput: input }]);
  expect(askLog(w)).toMatchObject([{ tool: "Bash", input, reason: "rule", decision: "allow" }]);
});

test("22.2 Always allow: rule on button, kept now and after restart", async ({ page: p, harness }) => {
  const input = { command: "mkdir -p /tmp/x" };
  const w = await boot(harness, {
    roles: { chat: { replies: [[{ ask: { id: "r1", tool: "Bash", input, suggestions: [mkdir] } }], reply("m2", "Ran again.")] } },
  });
  await p.goto(`${w.url}/map`);
  await say(p, "Make the folder");
  const always = pane(p).getByRole("button", { name: "Always allow Bash(mkdir:*)" });
  await expect(always).toBeVisible();
  await always.click();
  await expect(ended(p)).toBeVisible();
  expect(askLog(w)).toMatchObject([{ decision: "always", widened: ["Bash(mkdir:*)"] }]);
  expect(answers(w)).toEqual([{ behavior: "allow", updatedInput: input, updatedPermissions: [mkdir] }]);
  await say(p, "Again");
  await expect(turns(p).nth(1).locator(".msg.agent")).toHaveText("Ran again.");
  await expect(pane(p).getByRole("region", { name: "Bash wants to run" })).toHaveCount(0);
  writeFileSync(join(fakeOf, SCRIPT_FILE), JSON.stringify({ roles: { chat: { replies: [reply("m3", "Ran after restart.")] } } }));
  await w.restart();
  await p.goto(`${w.url}/map`);
  await say(p, "Run it after restart");
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("Ran after restart.");
  await expect(pane(p).getByRole("region", { name: "Bash wants to run" })).toHaveCount(0);
  const last = launchArgs(w).at(-1) ?? [];
  expect(last).toContain("--allowedTools");
  expect(last).toContain("Bash(mkdir:*)");
});

test("22.3 keyboard answers; a second click sends nothing; draft is not sent", async ({ page: p, harness }) => {
  const input = { command: "rm -rf /tmp/x" };
  const w = await boot(harness, {
    roles: { chat: { replies: [[{ ask: { id: "r1", tool: "Bash", input } }], [{ ask: { id: "r2", tool: "Bash", input } }], reply("m3", "Sent.")] } },
  });
  await p.goto(`${w.url}/map`);
  await say(p, "go");
  const ask = pane(p).getByRole("region", { name: "Bash wants to run" });
  await expect(ask).toBeVisible();
  const box = pane(p).getByRole("textbox", { name: "Message" });
  await box.fill("my draft");
  await box.press("Escape");
  await expect(ended(p, 0)).toBeVisible();
  expect(answers(w)).toHaveLength(1);
  expect((answers(w)[0] as { behavior: string }).behavior).toBe("deny");
  await expect(box).toHaveValue("my draft");
  // A second click on the same bar: the bar is gone, so the click finds nothing to press.
  await ask.getByRole("button", { name: "Allow once" }).click({ timeout: 500 }).catch(() => undefined);
  expect(answers(w)).toHaveLength(1);
  expect(askLog(w)).toHaveLength(1);
  expect(askLog(w)[0]).toMatchObject({ decision: "deny" });
  await box.fill("");
  await say(p, "go again");
  await expect(ask).toBeVisible();
  await box.fill("my draft");
  await box.press("Meta+Enter");
  await expect(ended(p, 1)).toBeVisible();
  await expect(box).toHaveValue("my draft");
  expect(turns(p)).toHaveCount(2);
  await box.press("Enter");
  await expect(turns(p)).toHaveCount(3);
  await expect(turns(p).nth(2).locator(".msg.user")).toHaveText("my draft");
});

const question = {
  questions: [
    {
      question: "Which store?",
      header: "Store",
      options: [
        { label: "Postgres", description: "One server" },
        { label: "SQLite", description: "One file" },
      ],
      multiSelect: false,
    },
  ],
};
const qCall = {
  event: { type: "assistant", message: { id: "mq", content: [{ type: "tool_use", id: "tool-q1", name: "AskUserQuestion", input: question }] } },
};
const qErr = {
  event: { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tool-q1", is_error: true, content: "denied" }] } },
};

test("22.4 question form: options, pick survives re-render, answer line, no failed call", async ({ page: p, harness }) => {
  const w = await boot(harness, {
    roles: { chat: { replies: [[qCall, { ask: { id: "q1", tool: "AskUserQuestion", input: question } }, { pause: 2500 }, qErr], reply("m2", "Using SQLite.")] } },
  });
  await p.goto(`${w.url}/map`);
  await say(p, "Ask me");
  const form = pane(p).getByRole("form", { name: "The agent asks" });
  await expect(form).toContainText("Which store?");
  await expect(form).toContainText("A.");
  await expect(form).toContainText("One server");
  await expect(form).toContainText("One file");
  await expect(form.getByRole("textbox")).toBeVisible();
  await expect(form.getByRole("button")).toHaveText(["Submit answer", "Decline"]);
  await expect(form).not.toContainText("tool_use");
  await expect(form).not.toContainText('"questions"');
  await form.getByRole("radio", { name: /SQLite/ }).check();
  const p2 = await p.context().newPage();
  await p2.goto(`${w.url}/map`);
  await say(p2, "from the second tab");
  await expect(form.getByRole("radio", { name: /SQLite/ })).toBeChecked();
  await form.getByRole("button", { name: "Submit answer" }).click();
  await expect(ended(p, 0)).toBeVisible();
  expect(answers(w)).toEqual([{ behavior: "deny", message: 'For "Which store?": SQLite' }]);
  await expect(turns(p).nth(1).locator(".msg.agent")).toHaveText("Using SQLite.");
  await expect(pane(p).locator('[data-error="true"]')).toHaveCount(0);
  expect(askLog(w)).toMatchObject([{ tool: "AskUserQuestion", decision: "answer" }]);
});

test("22.5 decline: buttons disabled, turn continues, ask log deny", async ({ page: p, harness }) => {
  const w = await boot(harness, {
    roles: { chat: { replies: [[{ ask: { id: "q1", tool: "AskUserQuestion", input: question } }, ...reply("m1", "Okay, no answer.")]] } },
  });
  await p.goto(`${w.url}/map`);
  await say(p, "Ask me");
  const form = pane(p).getByRole("form", { name: "The agent asks" });
  await watchDisabled(p);
  await form.getByRole("button", { name: "Decline" }).click();
  await expect(ended(p)).toBeVisible();
  expect(await sawDisabled(p)).toBe(true);
  await expect(ended(p)).toBeVisible();
  const [a] = answers(w) as { behavior: string }[];
  expect(a?.behavior).toBe("deny");
  expect(askLog(w)).toMatchObject([{ tool: "AskUserQuestion", decision: "deny" }]);
  void readFileSync;
});
