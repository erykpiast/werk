import { expect, type Page, test } from "@playwright/test";
import { project, stop, type W } from "./g9-project.ts";

test.afterEach(stop);

const stream = (event: object) => ({ event: { type: "stream_event", event } });
const startMsg = (id: string) => stream({ type: "message_start", message: { id } });
const open = (text: string) => stream({ type: "content_block_start", index: 0, content_block: { type: "text", text } });
const done = (id: string, text: string) => ({
  event: { type: "assistant", message: { id, content: [{ type: "text", text }] } },
});
const reply = (id: string, text: string) => [startMsg(id), open(text), done(id, text)];
const toolUse = (id: string, name: string, input: object) => ({
  event: { type: "assistant", message: { id: `m-${id}`, content: [{ type: "tool_use", id, name, input }] } },
});
const toolResult = (id: string, content: string, isError = false) => ({
  event: {
    type: "user",
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content, is_error: isError }] },
  },
});

const pane = (p: Page) => p.getByRole("complementary", { name: "Chat" });
const turns = (p: Page) => pane(p).locator("[data-turn]");
const composer = (p: Page) => pane(p).getByRole("textbox", { name: "Message" });
async function say(p: Page, words: string): Promise<void> {
  await composer(p).fill(words);
  await pane(p).getByRole("button", { name: "Send" }).click();
}
const ended = (p: Page, n: number) => expect(turns(p).nth(n).locator('[data-role="turn-end"]')).toBeVisible();
const answers = (w: W) => w.launches().flatMap((l) => l.answers);
/** Records the disabled state of the ask buttons right after each click. */
const watchClicks = (p: Page) =>
  p.evaluate(() => {
    const w = window as unknown as { __dis: boolean[][] };
    w.__dis = [];
    document.addEventListener(
      "click",
      () =>
        setTimeout(() => {
          w.__dis.push(
            [
              ...document.querySelectorAll(
                'section[aria-label="Asks"] button, form[aria-label="The agent asks"] button',
              ),
            ].map((b) => (b as HTMLButtonElement).disabled),
          );
        }, 0),
      true,
    );
  });
const dis = (p: Page) => p.evaluate(() => (window as unknown as { __dis: boolean[][] }).__dis);

test("22.1 Allow once lets the turn finish", async ({ page: p }) => {
  const input = { command: "curl -s https://example.com" };
  const w = await project({
    roles: {
      chat: {
        replies: [[{ ask: { id: "r1", tool: "Bash", input, reason: "rule" } }, ...reply("m1", "The page is fetched.")]],
      },
    },
  });
  await p.goto(`${w.url}/map`);
  await say(p, "Fetch the page");
  const ask = pane(p).getByRole("region", { name: "Bash wants to run" });
  await expect(ask).toContainText("Bash");
  await expect(ask.locator('pre[data-role="ask-call"] code')).toContainText("curl -s https://example.com");
  await expect(ask.locator('[data-role="ask-reason"]')).toContainText("rule");
  await expect(ask.getByRole("button")).toHaveText(["Allow once", "Deny"]);
  await watchClicks(p);
  await ask.getByRole("button", { name: "Allow once" }).click();
  await expect.poll(async () => (await dis(p)).length).toBeGreaterThan(0);
  const states = (await dis(p))[0] ?? [];
  expect(states.length).toBe(2);
  expect(states.every(Boolean)).toBe(true);
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("The page is fetched.");
  await ended(p, 0);
  expect(answers(w)).toEqual([{ behavior: "allow", updatedInput: input }]);
  expect(w.askLog()).toMatchObject([{ tool: "Bash", input, reason: "rule", decision: "allow" }]);
});

test("22.2 Always allow applies now and after a restart", async ({ page: p }) => {
  const mkdir = { type: "addRules", rules: [{ toolName: "Bash", ruleContent: "mkdir:*" }], behavior: "allow" };
  const input = { command: "mkdir -p /tmp/x" };
  const runs = (id: string, text: string) => [
    toolUse(id, "Bash", input),
    toolResult(id, "ok"),
    ...reply(`m-${id}`, text),
  ];
  const w = await project({
    roles: {
      chat: {
        replies: [
          [{ ask: { id: "r1", tool: "Bash", input, suggestions: [mkdir] } }, ...reply("m1", "Made.")],
          runs("t2", "Ran again."),
        ],
      },
    },
  });
  await p.goto(`${w.url}/map`);
  await say(p, "Make the folder");
  const button = pane(p).getByRole("button", { name: "Always allow Bash(mkdir:*)" });
  await expect(button).toBeVisible();
  await button.click();
  await ended(p, 0);
  expect(w.askLog()).toMatchObject([{ decision: "always", widened: ["Bash(mkdir:*)"] }]);
  expect(answers(w)).toEqual([{ behavior: "allow", updatedInput: input, updatedPermissions: [mkdir] }]);
  // same conversation, same call
  await say(p, "Again");
  await expect(turns(p).nth(1).locator(".msg.agent")).toHaveText("Ran again.");
  await ended(p, 1);
  await expect(pane(p).getByRole("region", { name: "Asks" })).toHaveCount(0);
  expect(w.askLog()).toHaveLength(1);
  // after a restart
  w.setScript({ roles: { chat: { replies: [runs("t3", "Ran after restart.")] } } });
  await w.restart();
  await p.goto(`${w.url}/map`);
  await say(p, "Once more after the restart");
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("Ran after restart.");
  await ended(p, 0);
  await expect(pane(p).getByRole("region", { name: "Asks" })).toHaveCount(0);
  const last = w.launches().at(-1)?.args ?? [];
  expect(last).toContain("--allowedTools");
  expect(last).toContain("Bash(mkdir:*)");
  expect(w.askLog()).toHaveLength(1);
});

test("22.3 keyboard answers and a second answer send only one", async ({ page: p }) => {
  const one = { command: "rm -rf /tmp/a" };
  const two = { command: "ls /tmp" };
  const w = await project({
    roles: {
      chat: {
        replies: [
          [
            { ask: { id: "r1", tool: "Bash", input: one, reason: "rule" } },
            { pause: 3000 },
            { ask: { id: "r2", tool: "Bash", input: two } },
            ...reply("m1", "Turn over."),
          ],
          reply("m2", "Draft received."),
        ],
      },
    },
  });
  await p.goto(`${w.url}/map`);
  await say(p, "Do it");
  const ask = pane(p).getByRole("region", { name: "Bash wants to run" });
  await expect(ask.locator("code").first()).toContainText("rm -rf /tmp/a");
  await composer(p).fill("my draft");
  await composer(p).press("Escape");
  await expect.poll(() => answers(w).length).toBe(1);
  expect(answers(w)[0]).toMatchObject({ behavior: "deny" });
  console.log("22.3 deny message:", JSON.stringify(answers(w)[0]));
  await expect(composer(p)).toHaveValue("my draft");
  await expect(turns(p)).toHaveCount(1);
  // a second click after the answer
  await ask
    .getByRole("button", { name: "Allow once" })
    .click({ timeout: 800 })
    .catch(() => undefined);
  const token = await w.token();
  const second = await fetch(`${w.url}/api/ask`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-werk-token": token },
    body: JSON.stringify({ id: "r1", decision: "allow" }),
  });
  expect(second.status).toBe(409);
  expect(answers(w)).toHaveLength(1);
  expect(w.askLog().filter((e) => (e.input as { command: string }).command === one.command)).toMatchObject([
    { decision: "deny" },
  ]);
  // the new ask bar
  await expect(pane(p).getByRole("region", { name: "Bash wants to run" }).locator("code").first()).toContainText(
    "ls /tmp",
    { timeout: 6000 },
  );
  await composer(p).press("Meta+Enter");
  await ended(p, 0);
  expect(answers(w)).toHaveLength(2);
  expect(answers(w)[1]).toEqual({ behavior: "allow", updatedInput: two });
  await expect(composer(p)).toHaveValue("my draft");
  await expect(turns(p)).toHaveCount(1);
  await composer(p).press("Enter");
  await expect(turns(p).nth(1).locator(".msg.user")).toHaveText("my draft");
  await expect(turns(p).nth(1).locator(".msg.agent")).toHaveText("Draft received.");
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

test("22.4 the question form answers the agent", async ({ page: p, context }) => {
  const w = await project({
    roles: {
      chat: {
        replies: [
          [
            toolUse("tool-q1", "AskUserQuestion", QUESTION),
            { ask: { id: "q1", tool: "AskUserQuestion", input: QUESTION } },
            { pause: 2500 },
            ...reply("m0", "Waiting for you."),
            { pause: 3000 },
            toolResult("tool-q1", 'For "Which store?": SQLite', true),
            ...reply("m1", "SQLite it is."),
          ],
        ],
      },
    },
  });
  await p.goto(`${w.url}/map`);
  await say(p, "Ask me");
  const form = pane(p).getByRole("form", { name: "The agent asks" });
  await expect(form).toContainText("Which store?");
  await expect(form).toContainText("A. Postgres");
  await expect(form).toContainText("B. SQLite");
  await expect(form).toContainText("One server for every reader");
  await expect(form).toContainText("One file beside the map");
  await expect(form.getByRole("textbox")).toHaveCount(1);
  await expect(form.getByRole("button", { name: "Submit answer" })).toBeVisible();
  await expect(form.getByRole("button", { name: "Decline" })).toBeVisible();
  await expect(pane(p)).not.toContainText('"questions"', { useInnerText: true });
  await expect(form).not.toContainText('"questions"');
  await form.getByRole("radio", { name: /SQLite/ }).check();
  // another tab on the same conversation; then a live event re-renders the pane
  const other = await context.newPage();
  await other.goto(`${w.url}/map`);
  await expect(pane(other).getByRole("form", { name: "The agent asks" })).toBeVisible();
  await expect(pane(p).locator(".msg.agent")).toHaveText("Waiting for you.", { timeout: 6000 });
  await expect(form.getByRole("radio", { name: /SQLite/ })).toBeChecked();
  await form.getByRole("button", { name: "Submit answer" }).click();
  await expect(turns(p).nth(0).locator(".msg.agent").last()).toHaveText("SQLite it is.", { timeout: 8000 });
  await ended(p, 0);
  expect(answers(w)).toEqual([{ behavior: "deny", message: 'For "Which store?": SQLite' }]);
  await expect(pane(p).locator('[data-role="tool-call"]')).toHaveCount(1);
  await expect(pane(p).locator('[data-role="tool-output"][data-error="true"]')).toHaveCount(0);
  expect(w.askLog()).toMatchObject([{ tool: "AskUserQuestion", decision: "answer" }]);
});

test("22.5 Decline refuses the question", async ({ page: p }) => {
  const w = await project({
    roles: {
      chat: {
        replies: [
          [{ ask: { id: "q1", tool: "AskUserQuestion", input: QUESTION } }, ...reply("m1", "Fine, no answer.")],
        ],
      },
    },
  });
  await p.goto(`${w.url}/map`);
  await say(p, "Ask me");
  const form = pane(p).getByRole("form", { name: "The agent asks" });
  await expect(form).toBeVisible();
  await watchClicks(p);
  await form.getByRole("button", { name: "Decline" }).click();
  await expect.poll(async () => (await dis(p)).length).toBeGreaterThan(0);
  const states = (await dis(p))[0] ?? [];
  expect(states.length).toBe(2);
  expect(states.every(Boolean)).toBe(true);
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("Fine, no answer.");
  await ended(p, 0);
  expect(answers(w)).toEqual([{ behavior: "deny", message: "The person declined to answer." }]);
  expect(w.askLog()).toMatchObject([{ tool: "AskUserQuestion", decision: "deny" }]);
});
