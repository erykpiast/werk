import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { cleanup, pane, reply, say, start, turns, type W } from "./g-lib.ts";

test.afterEach(cleanup);

const chat = (...replies: unknown[]) => ({ roles: { chat: { replies } } });
const askLog = (w: W) => {
  const f = join(w.dir, ".werk", "asks.jsonl");
  return existsSync(f)
    ? readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>)
    : [];
};
const answers = (w: W) => w.launches().flatMap((l) => l.answers);
const delayAnswers = (p: Page) =>
  p.route("**/api/ask", async (r) => {
    await new Promise((x) => setTimeout(x, 1500));
    await r.continue();
  });

test("22.1 Allow once lets a blocked tool call finish its turn", async ({ page: p }) => {
  const input = { command: "curl -s https://example.com" };
  const w = await start(chat([{ ask: { id: "r1", tool: "Bash", input, reason: "rule" } }]));
  await p.goto(`${w.url}/map`);
  await delayAnswers(p);
  await say(p, "Fetch it");
  const ask = pane(p).getByRole("region", { name: "Bash wants to run" });
  await expect(ask).toContainText("Bash");
  await expect(ask.locator("[data-role=ask-call]")).toContainText('"command": "curl -s https://example.com"');
  await expect(ask.locator("[data-role=ask-reason]")).toContainText("rule");
  await expect(ask.getByRole("button")).toHaveText(["Allow once", "Deny"]);
  await ask.getByRole("button", { name: "Allow once" }).click();
  for (const b of await ask.getByRole("button").all()) await expect(b).toBeDisabled();
  await expect(turns(p).nth(0).locator('[data-role="turn-end"]')).toBeVisible();
  expect(answers(w)).toEqual([{ behavior: "allow", updatedInput: input }]);
  expect(askLog(w)).toMatchObject([{ tool: "Bash", input: expect.anything(), reason: "rule", decision: "allow" }]);
});

test("22.2 Always allow applies its rule now and after a restart", async ({ page: p }) => {
  const mkdir = { type: "addRules", rules: [{ toolName: "Bash", ruleContent: "mkdir:*" }], behavior: "allow" };
  const input = { command: "mkdir -p /tmp/x" };
  const w = await start(chat([{ ask: { id: "r1", tool: "Bash", input, suggestions: [mkdir] } }]));
  await p.goto(`${w.url}/map`);
  await say(p, "Make it");
  const btn = pane(p).getByRole("button", { name: "Always allow Bash(mkdir:*)" });
  await expect(btn).toBeVisible();
  await btn.click();
  await expect(turns(p).nth(0).locator('[data-role="turn-end"]')).toBeVisible();
  expect(answers(w)).toEqual([{ behavior: "allow", updatedInput: input, updatedPermissions: [mkdir] }]);
  expect(askLog(w)).toMatchObject([{ decision: "always", widened: ["Bash(mkdir:*)"] }]);
  // after a restart the next child starts with the rule
  w.setScript(chat(reply("m3", "ran it again")));
  await w.restart();
  await p.goto(`${w.url}/map`);
  await say(p, "once more");
  await expect(turns(p).last().locator(".msg.agent")).toHaveText("ran it again");
  await expect(pane(p).getByRole("region", { name: "Bash wants to run" })).toHaveCount(0);
  const last = w.launches().at(-1);
  const flags = last?.args ?? [];
  expect(flags).toContain("--allowedTools");
  expect(flags[flags.indexOf("--allowedTools") + 1]).toBe("Bash(mkdir:*)");
});

test("22.3 keyboard answers and a second click send one answer", async ({ page: p }) => {
  const w = await start(
    chat(
      [{ ask: { id: "r1", tool: "Bash", input: { command: "ls" } } }, { ask: { id: "r2", tool: "Read", input: { file_path: "/x" } } }],
      reply("m2", "draft went out"),
    ),
  );
  await p.goto(`${w.url}/map`);
  await delayAnswers(p);
  await say(p, "go");
  const bash = pane(p).getByRole("region", { name: "Bash wants to run" });
  const read = pane(p).getByRole("region", { name: "Read wants to run" });
  await expect(bash).toBeVisible();
  await expect(read).toBeVisible();
  const box = pane(p).getByRole("textbox", { name: "Message" });
  await box.fill("my draft");
  await box.press("Escape");
  await expect(bash.getByRole("button", { name: "Allow once" })).toBeDisabled();
  await expect(box).toHaveValue("my draft");
  await bash.getByRole("button", { name: "Allow once" }).click({ force: true, timeout: 2000 }).catch(() => undefined);
  await expect.poll(() => answers(w).length, { timeout: 5000 }).toBe(1);
  expect(answers(w)[0]).toMatchObject({ behavior: "deny" });
  expect(askLog(w).filter((e) => e.decision === "deny" || e.decision === "allow")).toHaveLength(1);
  expect(askLog(w)[0]).toMatchObject({ tool: "Bash", decision: "deny" });
  await expect(box).toHaveValue("my draft");
  // the other ask: Cmd+Enter allows it, and the draft stays
  await box.press("Meta+Enter");
  await expect(turns(p).nth(0).locator('[data-role="turn-end"]')).toBeVisible({ timeout: 10000 });
  expect(answers(w)).toHaveLength(2);
  expect(answers(w)[1]).toMatchObject({ behavior: "allow" });
  expect(askLog(w)[1]).toMatchObject({ tool: "Read", decision: "allow" });
  await expect(box).toHaveValue("my draft");
  expect(w.launches()[0]?.messages).toHaveLength(1);
  await box.press("Enter");
  await expect(turns(p)).toHaveCount(2);
  await expect(turns(p).nth(1).locator(".msg.user")).toHaveText("my draft");
  await expect(turns(p).nth(1).locator(".msg.agent")).toHaveText("draft went out");
});

const QUESTION = {
  questions: [
    {
      question: "Which store?",
      header: "Store",
      options: [
        { label: "Postgres", description: "One server for every reader" },
        { label: "SQLite", description: "One file beside the map" },
      ],
      multiSelect: false,
    },
  ],
};

test("22.4 the user answers an agent's question with the form", async ({ page: p, context }) => {
  const w = await start(chat([{ ask: { id: "q1", tool: "AskUserQuestion", input: QUESTION } }], reply("m2", "pong")));
  await p.goto(`${w.url}/map`);
  await say(p, "Ask me");
  const form = pane(p).getByRole("form", { name: "The agent asks" });
  await expect(form).toContainText("Which store?");
  await expect(form).toContainText("A. Postgres");
  await expect(form).toContainText("B. SQLite");
  await expect(form).toContainText("One server for every reader");
  await expect(form).toContainText("One file beside the map");
  await expect(form.getByRole("textbox", { name: "Other answer to: Which store?" })).toBeVisible();
  await expect(form.getByRole("button", { name: "Submit answer" })).toBeVisible();
  await expect(form.getByRole("button", { name: "Decline" })).toBeVisible();
  await expect(pane(p)).not.toContainText('"questions"');
  await form.getByRole("radio", { name: /SQLite/ }).check();
  // another tab on the same conversation makes this pane re-render
  const q = await context.newPage();
  await q.goto(`${w.url}/map`);
  await say(q, "ping");
  await p.waitForTimeout(1500);
  await expect(form.getByRole("radio", { name: /SQLite/ })).toBeChecked();
  await form.getByRole("button", { name: "Submit answer" }).click();
  await expect(turns(p).nth(0).locator('[data-role="turn-end"]')).toBeVisible();
  expect(answers(w)[0]).toEqual({ behavior: "deny", message: 'For "Which store?": SQLite' });
  await expect(pane(p).locator('[data-error="true"]')).toHaveCount(0);
  expect(askLog(w)).toMatchObject([{ tool: "AskUserQuestion", decision: "answer" }]);
});

test("22.5 the user declines an agent's question", async ({ page: p }) => {
  const w = await start(chat([{ ask: { id: "q1", tool: "AskUserQuestion", input: QUESTION } }]));
  await p.goto(`${w.url}/map`);
  await delayAnswers(p);
  await say(p, "Ask me");
  const form = pane(p).getByRole("form", { name: "The agent asks" });
  await form.getByRole("button", { name: "Decline" }).click();
  for (const b of await form.getByRole("button").all()) await expect(b).toBeDisabled();
  for (const r of await form.getByRole("radio").all()) await expect(r).toBeDisabled();
  await expect(turns(p).nth(0).locator('[data-role="turn-end"]')).toBeVisible();
  expect(answers(w)[0]).toMatchObject({ behavior: "deny" });
  expect(askLog(w)).toMatchObject([{ tool: "AskUserQuestion", decision: "deny" }]);
});
