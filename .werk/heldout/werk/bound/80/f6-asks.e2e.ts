import { expect, test } from "@playwright/test";
import { answers, boot, pane, reply, say, stopAll, turns } from "./f6-lib.ts";

test.afterEach(stopAll);

const mkdir = { type: "addRules", rules: [{ toolName: "Bash", ruleContent: "mkdir:*" }], behavior: "allow" };

test("22.1 Allow once", async ({ page: p }) => {
  const input = { command: "curl -s https://example.com" };
  const b = await boot({
    roles: { chat: { replies: [[...reply("m1", "Fetched."), { ask: { id: "r1", tool: "Bash", input, reason: "rule" } }]] } },
  });
  await p.goto(`${b.url}/map`);
  await say(p, "Fetch the page");
  const ask = pane(p).getByRole("region", { name: "Bash wants to run" });
  await expect(ask).toBeVisible();
  await expect(ask.locator("[data-role=ask-call]")).toContainText("curl -s https://example.com");
  await expect(ask.locator("[data-role=ask-reason]")).toContainText("rule");
  await expect(ask.getByRole("button")).toHaveText(["Allow once", "Deny"]);
  await p.route("**/api/ask", async (r) => {
    await new Promise((s) => setTimeout(s, 1500));
    await r.continue();
  });
  await ask.getByRole("button", { name: "Allow once" }).click();
  for (const btn of await ask.getByRole("button").all()) await expect(btn).toBeDisabled();
  await expect(turns(p).nth(0).locator('[data-role="turn-end"]')).toBeVisible();
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("Fetched.");
  expect(b.askLog()).toMatchObject([{ tool: "Bash", reason: "rule", decision: "allow" }]);
  expect(JSON.stringify(b.askLog()[0])).toContain("curl -s https://example.com");
});

test("22.2 Always allow now and after restart", async ({ page: p }) => {
  const input = { command: "mkdir -p /tmp/x" };
  const b = await boot({
    roles: {
      chat: {
        replies: [
          [{ ask: { id: "r1", tool: "Bash", input, suggestions: [mkdir] } }],
          reply("m2", "Second turn ran the call."),
          reply("m3", "After restart ran the call."),
        ],
      },
    },
  });
  await p.goto(`${b.url}/map`);
  await say(p, "Make the folder");
  const ask = pane(p).getByRole("region", { name: "Bash wants to run" });
  await expect(ask.getByRole("button", { name: "Always allow Bash(mkdir:*)" })).toBeVisible();
  await ask.getByRole("button", { name: "Always allow Bash(mkdir:*)" }).click();
  await expect(turns(p).nth(0).locator('[data-role="turn-end"]')).toBeVisible();
  expect(b.askLog()).toMatchObject([{ decision: "always", widened: ["Bash(mkdir:*)"] }]);
  expect(answers(b)).toEqual([{ behavior: "allow", updatedInput: input, updatedPermissions: [mkdir] }]);
  await say(p, "Again");
  await expect(turns(p).nth(1).locator(".msg.agent")).toHaveText("Second turn ran the call.");
  await expect(pane(p).getByRole("region", { name: "Asks" })).toHaveCount(0);
  // restart: a new child starts with the kept rule
  b.setScript({ roles: { chat: { replies: [reply("m3", "After restart ran the call.")] } } });
  await b.restart();
  await p.goto(`${b.url}/map`);
  await say(p, "After restart");
  await expect(turns(p).last().locator(".msg.agent")).toHaveText("After restart ran the call.");
  const launches = b.launches().filter((e) => e.kind === "launch");
  const last = launches[launches.length - 1] as { args: string[] };
  expect(launches.length).toBeGreaterThanOrEqual(2);
  expect(last.args).toContain("--allowedTools");
  expect(last.args).toContain("Bash(mkdir:*)");
  await expect(pane(p).getByRole("region", { name: "Asks" })).toHaveCount(0);
});

test("22.3 keyboard answers and a second answer send one", async ({ page: p }) => {
  const input = { command: "rm -rf x" };
  const b = await boot({
    roles: {
      chat: {
        replies: [[{ ask: { id: "r1", tool: "Bash", input } }], [{ ask: { id: "r2", tool: "Bash", input } }], reply("m3", "draft got sent")],
      },
    },
  });
  await p.goto(`${b.url}/map`);
  await say(p, "Run it");
  const ask = pane(p).getByRole("region", { name: "Bash wants to run" });
  await expect(ask).toBeVisible();
  const box = pane(p).getByRole("textbox", { name: "Message" });
  await box.fill("my draft");
  await p.keyboard.press("Escape");
  await expect(turns(p).nth(0).locator('[data-role="turn-end"]')).toBeVisible();
  expect(answers(b)).toMatchObject([{ behavior: "deny" }]);
  await expect(box).toHaveValue("my draft");
  await expect(turns(p)).toHaveCount(1);
  // the ask bar left after the answer: a click on Allow once has nothing to hit
  await expect(pane(p).getByRole("button", { name: "Allow once" })).toHaveCount(0);
  expect(answers(b)).toHaveLength(1);
  expect(b.askLog()).toHaveLength(1);
  expect(b.askLog()[0]).toMatchObject({ decision: "deny" });

  // a second ask: needs a second turn
  await say(p, "Again");
  await expect(pane(p).getByRole("region", { name: "Bash wants to run" })).toBeVisible();
  await box.fill("my draft");
  await box.press("Meta+Enter");
  await expect(turns(p).nth(1).locator('[data-role="turn-end"]')).toBeVisible();
  expect(answers(b)[1]).toMatchObject({ behavior: "allow" });
  await expect(box).toHaveValue("my draft");
  await expect(turns(p)).toHaveCount(2);
  await box.press("Enter");
  await expect(turns(p).nth(2).locator(".msg.user")).toHaveText("my draft");
});

const qInput = {
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

test("22.4 answer an agent's question with the form", async ({ page: p, context }) => {
  const b = await boot({
    roles: {
      chat: {
        replies: [
          [
            { event: { type: "assistant", message: { id: "mq", content: [{ type: "tool_use", id: "tool-q1", name: "AskUserQuestion", input: qInput }] } } },
            { ask: { id: "q1", tool: "AskUserQuestion", input: qInput } },
          ],
        ],
      },
    },
  });
  await p.goto(`${b.url}/map`);
  await say(p, "Ask me");
  const form = pane(p).getByRole("form", { name: "The agent asks" });
  await expect(form).toContainText("Which store?");
  await expect(form).toContainText("A.");
  await expect(form).toContainText("B.");
  await expect(form).toContainText("One server for every reader");
  await expect(form).toContainText("One file beside the map");
  await expect(form.getByRole("textbox")).toHaveCount(1);
  await expect(form.getByRole("button", { name: "Submit answer" })).toBeVisible();
  await expect(form.getByRole("button", { name: "Decline" })).toBeVisible();
  expect(await pane(p).innerText()).not.toContain('"questions"');
  await form.getByRole("radio", { name: /SQLite/ }).check();
  const other = await context.newPage();
  await other.goto(`${b.url}/map`);
  b.werk("add", "nudge", "--title", "Nudge", "--parent", "root");
  await expect(p.locator('a[data-tile="nudge"]')).toBeVisible();
  await expect(form.getByRole("radio", { name: /SQLite/ })).toBeChecked();
  await form.getByRole("button", { name: "Submit answer" }).click();
  await expect(turns(p).nth(0).locator('[data-role="turn-end"]')).toBeVisible();
  expect(answers(b)).toEqual([{ behavior: "deny", message: 'For "Which store?": SQLite' }]);
  await expect(pane(p).locator('[data-error="true"]')).toHaveCount(0);
  expect(b.askLog()).toMatchObject([{ tool: "AskUserQuestion", decision: "answer" }]);
});

test("22.5 decline a question", async ({ page: p }) => {
  const b = await boot({ roles: { chat: { replies: [[{ ask: { id: "q1", tool: "AskUserQuestion", input: qInput } }]] } } });
  await p.goto(`${b.url}/map`);
  await say(p, "Ask me");
  const form = pane(p).getByRole("form", { name: "The agent asks" });
  await expect(form).toBeVisible();
  await p.route("**/api/ask", async (r) => {
    await new Promise((s) => setTimeout(s, 1500));
    await r.continue();
  });
  await form.getByRole("button", { name: "Decline" }).click();
  for (const btn of await form.getByRole("button").all()) await expect(btn).toBeDisabled();
  await expect(turns(p).nth(0).locator('[data-role="turn-end"]')).toBeVisible();
  expect(answers(b)).toMatchObject([{ behavior: "deny" }]);
  expect(b.askLog()).toMatchObject([{ tool: "AskUserQuestion", decision: "deny" }]);
});
