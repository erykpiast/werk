import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { type Rig, rig } from "./rig.ts";

let current: Rig | undefined;
test.afterEach(async () => {
  const r = current;
  current = undefined;
  if (r) {
    await r.stop();
    const { rmSync } = await import("node:fs");
    rmSync(r.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
const boot = async (script: object = { roles: {} }, before?: Parameters<typeof rig>[1]) => (current = await rig(script, before));

const stream = (event: object) => ({ event: { type: "stream_event", event } });
const start = (id: string) => stream({ type: "message_start", message: { id } });
const open = (text: string) => stream({ type: "content_block_start", index: 0, content_block: { type: "text", text } });
const more = (text: string) => stream({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text } });
const done = (id: string, text: string, usage?: object) => ({
  event: { type: "assistant", message: { id, content: [{ type: "text", text }], ...(usage ? { usage } : {}) } },
});
const init = (session: string) => ({ event: { type: "system", subtype: "init", session_id: session } });
const reply = (id: string, text: string, session?: string) => [...(session ? [init(session)] : []), start(id), open(text), done(id, text)];

const pane = (p: Page) => p.getByRole("complementary", { name: "Chat" });
const turns = (p: Page) => pane(p).locator("[data-turn]");
async function say(p: Page, words: string) {
  await pane(p).getByRole("textbox", { name: "Message" }).fill(words);
  await pane(p).getByRole("button", { name: "Send" }).click();
}
const askLog = (r: Rig) =>
  existsSync(join(r.dir, ".werk", "asks.jsonl"))
    ? readFileSync(join(r.dir, ".werk", "asks.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>)
    : [];

// ---------- 20
test("[20.1] a message on the open card streams a reply and the map shows the card the agent writes", async ({ page: p }) => {
  const line = (seq: number, type: string, payload: object) => JSON.stringify({ seq, at: "t", actor: seq === 1 ? "you" : "agent", type, payload });
  const log = [
    line(1, "node.added", { id: "root", kind: "card", title: "Root" }),
    line(2, "node.added", { id: "retry", kind: "card", title: "Checkout retries", why: "Cards fail", body: "It says three tries", parent: "root" }),
  ].join("\n");
  const w = await boot(
    { roles: { chat: { replies: [[start("m1"), open("Updating #retry now"), { pause: 1500 }, { edit: { path: ".werk/log.jsonl", content: `${log}\n` } }, { pause: 2500 }, more(" **done**"), done("m1", "Updating #retry now **done**")]] } } },
    (s) => s.seed("node.added", { id: "retry", kind: "card", title: "Checkout retries", why: "Cards fail", body: "It says two tries", parent: "root" }),
  );
  await p.goto(`${w.url}/map/retry`);
  await expect(p.locator('[data-field="body"]')).toHaveText("It says two tries");
  await say(p, "Make it three tries");
  await expect(turns(p).nth(0).locator(".msg.user")).toHaveText("Make it three tries");
  await expect(turns(p).nth(0).locator(".msg.agent")).toContainText("Updating");
  const head = pane(p).getByRole("status", { name: "Turn state" });
  await expect(head).toContainText(/\d+\s*s/);
  await expect(head).toContainText(/tokens?/);
  await expect(turns(p).nth(0).locator(".msg.agent a")).toHaveAttribute("href", "/map/retry");
  await expect(p.locator('[data-field="body"]')).toHaveText("It says three tries");
  await expect(turns(p).nth(0).locator('[data-role="turn-end"]')).toHaveCount(0);
  await expect(turns(p).nth(0).locator('[data-role="turn-end"]')).toBeVisible();
  await expect(head).not.toContainText(/tokens/);
  await expect(turns(p).nth(0).locator(".msg.agent")).toContainText("Updating");
  await expect(turns(p).nth(0).locator(".msg.agent strong")).toHaveText("done");
});

test("[20.2] a second message sent during a reply waits, and the first reply finishes above it", async ({ page: p }) => {
  const w = await boot({ roles: { chat: { replies: [[start("m1"), open("Two tries"), { pause: 2500 }, more(" is the rule."), done("m1", "Two tries is the rule.")], reply("m2", "Second answer.")] } } });
  await p.goto(`${w.url}/map`);
  await say(p, "First question");
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("Two tries");
  await say(p, "Second question");
  await expect(turns(p).nth(1).locator(".msg.user")).toHaveText("Second question");
  await expect(turns(p).nth(1).locator('[data-mark="waiting"]')).toHaveText(/waits for the reply above/);
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("Two tries is the rule.");
  await expect(turns(p).nth(1).locator('[data-mark="waiting"]')).toHaveCount(0);
  await expect(turns(p).nth(1).locator(".msg.agent")).toHaveText("Second answer.");
});

test("[20.3] each turn names the card the person has open", async ({ page: p }) => {
  const w = await boot({ roles: { chat: { replies: [reply("m1", "one"), reply("m2", "two"), reply("m3", "three")] } } }, (s) =>
    s.seed("node.added", { id: "retry", kind: "card", title: "Checkout retries", why: "Cards fail", parent: "root" }),
  );
  await p.goto(`${w.url}/map/retry`);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Checkout retries");
  await say(p, "What does this say?");
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("one");
  await say(p, "And now?");
  await expect(turns(p).nth(1).locator(".msg.agent")).toHaveText("two");
  await p.goto(`${w.url}/`);
  await say(p, "Where am I?");
  await expect(turns(p).last().locator(".msg.agent")).toHaveText("three");
  const msgs = w.launches()[0]?.messages ?? [];
  expect(msgs[0]).toContain("Checkout retries");
  expect(msgs[0]).toContain("Cards fail");
  expect(msgs[1]).toBe("[still on #retry — Checkout retries]\n\nAnd now?");
  expect(msgs[2]).toMatch(/Root|home|root/i);
  expect(msgs[2]).not.toContain("still on #retry");
});

test("[20.4] a run of tool calls collapses into one line", async ({ page: p }) => {
  const call = (id: string, command: string) => ({ event: { type: "assistant", message: { id: `m-${id}`, content: [{ type: "tool_use", id, name: "Bash", input: { command } }] } } });
  const result = (id: string, content: string) => ({ event: { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content }] } } });
  const w = await boot({ roles: { chat: { replies: [[call("t1", "ls"), result("t1", "a.txt"), call("t2", "pwd"), result("t2", "/project"), call("t3", "git status"), result("t3", "clean"), ...reply("m4", "All clean.")]] } } });
  await p.goto(`${w.url}/map`);
  await say(p, "Look at the code");
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("All clean.");
  const runs = turns(p).nth(0).locator('[data-role="tool-run"]');
  await expect(runs).toHaveCount(1);
  await expect(runs.locator("summary")).toContainText("git status");
  await expect(runs.locator("summary")).toContainText("3");
  await runs.locator("summary").click();
  await expect(runs.locator('[data-role="tool-call"]')).toHaveCount(3);
  await expect(runs.locator('[data-role="tool-input"]').nth(1)).toContainText("pwd");
  await expect(runs.locator('[data-role="tool-output"]').nth(1)).toHaveText("/project");
});

test("[20.5] a chat request without the token starts no agent", async ({ page: p }) => {
  const w = await boot({ roles: { chat: { replies: [reply("m1", "never")] } } }, (s) =>
    s.seed("node.added", { id: "retry", kind: "card", title: "Checkout retries", body: "two tries", parent: "root" }),
  );
  await p.goto(`${w.url}/map`);
  const body = JSON.stringify({ text: "Make it three tries", turn: "t1", card: "retry" });
  const r = await fetch(`${w.url}/api/chat`, { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example" }, body });
  expect(r.status).toBeGreaterThanOrEqual(400);
  await p.waitForTimeout(500);
  expect(w.launches()).toEqual([]);
  await expect(turns(p)).toHaveCount(0);
  await p.goto(`${w.url}/map/retry`);
  await expect(p.locator('[data-field="body"]')).toHaveText("two tries");
});

// ---------- 21
const sel = (p: Page) => pane(p).getByRole("combobox", { name: "Model" });
const pie = (p: Page) => pane(p).getByRole("button", { name: /^Context \d+%/ });
const usage = { input_tokens: 5000, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

test("[21.1] a conversation keeps its model and context fill across a server restart", async ({ page: p }) => {
  const w = await boot({ roles: { chat: { replies: [[init("sess-1"), start("m1"), open("Hello"), done("m1", "Hello", usage), { event: { type: "result", subtype: "success", is_error: false, duration_ms: 5, total_cost_usd: 0.01, modelUsage: { "claude-opus-5-5": { contextWindow: 200000 } } } }]] } } });
  await p.goto(`${w.url}/map`);
  await sel(p).selectOption({ label: "Opus" });
  await expect(sel(p)).toHaveValue(/claude-opus-5-5\|$/);
  await say(p, "Remember this");
  await expect(turns(p).nth(0).locator('[data-role="turn-end"]')).toBeVisible();
  const label = await pie(p).getAttribute("aria-label");
  expect(label).toMatch(/Context \d+%/);
  await w.restart();
  await p.goto(`${w.url}/map`);
  await expect(sel(p)).toHaveValue(/claude-opus-5-5\|$/);
  await expect(pie(p)).toHaveAttribute("aria-label", label as string);
  await say(p, "What did I ask you before?");
  await expect(turns(p).last().locator('[data-role="turn-end"]')).toBeVisible();
  const ls = w.launches();
  expect(ls.length).toBe(2);
  expect(ls[1]?.args).toContain("--resume");
  expect(ls[1]?.args[(ls[1]?.args.indexOf("--resume") ?? 0) + 1]).toBe("sess-1");
  expect(ls[1]?.args).toContain("claude-opus-5-5");
});

test("[21.2] a dead stored session starts again and the waiting message is delivered", async ({ page: p }) => {
  const w = await boot({ roles: { chat: { replies: [reply("m1", "First answer", "sess-old")] } } });
  await p.goto(`${w.url}/map`);
  await say(p, "Earlier question");
  await expect(turns(p).nth(0).locator('[data-role="turn-end"]')).toBeVisible();
  w.script({ roles: { chat: { replies: [reply("m2", "Fresh answer", "sess-new")], sessions: ["sess-new"] } } });
  await w.restart();
  await p.goto(`${w.url}/map`);
  await say(p, "New question");
  await expect(turns(p).last().locator(".msg.agent")).toHaveText("Fresh answer");
  await expect(pane(p)).not.toContainText("Your message was not delivered");
  expect(w.launches().length).toBeGreaterThanOrEqual(3);
});

test("[21.3] a crash with another error retries once, asks to send again and shows the whole error", async ({ page: p }) => {
  const w = await boot({ roles: { chat: { replies: [reply("m1", "First answer", "sess-1")] } } });
  await p.goto(`${w.url}/map`);
  await say(p, "Earlier question");
  await expect(turns(p).nth(0).locator('[data-role="turn-end"]')).toBeVisible();
  const error = "Boom one\nBoom two\nBoom three\nBoom four\n";
  w.script({ roles: { chat: { replies: [[{ stderr: error }, { crash: 1 }]] } } });
  await w.restart();
  const before = w.launches().length;
  await p.goto(`${w.url}/map`);
  await say(p, "Hello again");
  await expect(pane(p)).toContainText("Your message was not delivered. Send it again.");
  for (const l of ["Boom one", "Boom two", "Boom three", "Boom four"]) await expect(pane(p)).toContainText(l);
  expect(w.launches().length - before).toBe(2);
  w.script({ roles: { chat: { replies: [reply("m3", "Back again", "sess-1")] } } });
  await say(p, "Try again");
  await expect(turns(p).last().locator(".msg.agent")).toHaveText("Back again");
  const last = w.launches().at(-1);
  expect(last?.args).toContain("--resume");
  expect(last?.args[(last?.args.indexOf("--resume") ?? 0) + 1]).toBe("sess-1");
});

test("[21.4] a login problem shows its error at once with no retry", async ({ page: p }) => {
  const error = "Not logged in.\nRun: claude auth login\nThen retry\n";
  const w = await boot({ roles: { chat: { replies: [[{ stderr: error }, { crash: 1 }]] } } });
  await p.goto(`${w.url}/map`);
  await say(p, "hello");
  await expect(pane(p)).toContainText("Your message was not delivered. Send it again.");
  for (const l of ["Not logged in.", "claude auth login", "Then retry"]) await expect(pane(p)).toContainText(l);
  await p.waitForTimeout(800);
  expect(w.launches().length).toBe(1);
});

test("[21.5] the model switch and clear context refuse during a turn and restart quietly when idle", async ({ page: p }) => {
  const w = await boot({ roles: { chat: { replies: [[init("s1"), start("m1"), open("Long"), { pause: 3000 }, done("m1", "Long", usage)], reply("m2", "Answer after clear", "s2")] } } });
  await p.goto(`${w.url}/map`);
  await sel(p).selectOption({ label: "Sonnet" });
  const ph = await pie(p).evaluate((e) => getComputedStyle(e).backgroundImage);
  expect(ph).toContain("rgb(14, 165, 233)");
  await say(p, "A long task");
  await expect(sel(p)).toBeDisabled();
  const token = (await p.locator('meta[name="werk-token"]').getAttribute("content")) ?? "";
  const refused = await p.evaluate(async (t) => (await fetch("/api/model", { method: "POST", headers: { "content-type": "application/json", "x-werk-token": t }, body: JSON.stringify({ model: "claude-opus-5-5", advisor: null }) })).status, token);
  expect(refused).toBeGreaterThanOrEqual(400);
  await expect(sel(p).locator("option:checked")).toHaveText("Sonnet");
  await expect(turns(p).nth(0).locator('[data-role="turn-end"]')).toBeVisible();
  w.script({ roles: { chat: { replies: [reply("m2", "Answer after clear", "s2")] } } });
  await sel(p).selectOption({ label: "Sonnet + Opus advisor" });
  await expect(sel(p).locator("option:checked")).toHaveText("Sonnet + Opus advisor");
  await expect(pane(p)).not.toContainText(/exited|crash|not delivered/i);
  await pie(p).click();
  const dlg = pane(p).getByRole("dialog", { name: "Context" });
  await expect(dlg).toContainText(/\d+%/);
  await dlg.getByRole("button", { name: "Clear context" }).click();
  await expect(pane(p)).not.toContainText(/exited|crash|not delivered/i);
  await say(p, "After clear");
  await expect(turns(p).last().locator(".msg.agent")).toHaveText("Answer after clear");
});

// ---------- 22
const askRun = (id: string, input: unknown, extra: object = {}) => [{ ask: { id, tool: "Bash", input, reason: "rule", ...extra } }];

test("[22.1] allow once lets a blocked tool call finish its turn", async ({ page: p }) => {
  const input = { command: "curl -s https://example.com" };
  const w = await boot({ roles: { chat: { replies: [askRun("r1", input)] } } });
  await p.goto(`${w.url}/map`);
  await p.route("**/api/ask", async (route) => {
    await new Promise((r) => setTimeout(r, 1200));
    await route.continue();
  });
  await say(p, "Fetch");
  const ask = pane(p).getByRole("region", { name: "Bash wants to run" });
  await expect(ask).toBeVisible();
  await expect(ask.locator("[data-role=ask-call]")).toContainText("curl -s https://example.com");
  await expect(ask.locator("[data-role=ask-reason]")).toContainText("rule");
  await expect(ask.getByRole("button")).toHaveText(["Allow once", "Deny"]);
  await ask.getByRole("button", { name: "Allow once" }).click();
  for (const b of await ask.getByRole("button").all()) await expect(b).toBeDisabled();
  await expect(turns(p).nth(0).locator('[data-role="turn-end"]')).toBeVisible();
  expect(askLog(w)).toMatchObject([{ tool: "Bash", reason: "rule", decision: "allow", input }]);
  expect(w.launches()[0]?.answers).toEqual([{ behavior: "allow", updatedInput: input }]);
});

test("[22.2] always allow applies its rule now and after a restart", async ({ page: p }) => {
  const mkdir = { type: "addRules", rules: [{ toolName: "Bash", ruleContent: "mkdir:*" }], behavior: "allow" };
  const input = { command: "mkdir -p /tmp/x" };
  const w = await boot({ roles: { chat: { replies: [askRun("r1", input, { suggestions: [mkdir] }), askRun("r2", input, { suggestions: [mkdir] })] } } });
  await p.goto(`${w.url}/map`);
  await say(p, "Make the folder");
  await pane(p).getByRole("button", { name: "Always allow Bash(mkdir:*)" }).click();
  await expect(turns(p).nth(0).locator('[data-role="turn-end"]')).toBeVisible();
  expect(askLog(w)).toMatchObject([{ decision: "always", widened: ["Bash(mkdir:*)"] }]);
  // The answer carries the CLI's own suggestion, so the running agent applies the rule at once.
  expect(w.launches()[0]?.answers).toEqual([{ behavior: "allow", updatedInput: input, updatedPermissions: [mkdir] }]);
  // The fake agent asks on every call, so the rule is judged by what a later launch carries.
  await w.restart();
  await p.goto(`${w.url}/map`);
  await say(p, "After restart");
  await expect(pane(p).getByRole("region", { name: "Bash wants to run" }).or(turns(p).last().locator('[data-role="turn-end"]'))).toBeVisible();
  const args = w.launches().at(-1)?.args.join(" ") ?? "";
  expect(args).toContain("Bash(mkdir:*)");
});

test("[22.3] keyboard answers and a second click send only one answer", async ({ page: p }) => {
  const input = { command: "rm -rf /tmp/y" };
  const w = await boot({ roles: { chat: { replies: [askRun("r1", input), askRun("r2", { command: "ls" })] } } });
  await p.goto(`${w.url}/map`);
  await say(p, "Clean up");
  const ask = pane(p).getByRole("region", { name: "Bash wants to run" });
  await expect(ask).toBeVisible();
  const box = pane(p).getByRole("textbox", { name: "Message" });
  await box.fill("my draft");
  await box.press("Escape");
  await expect(turns(p).nth(0).locator('[data-role="turn-end"]')).toBeVisible();
  await expect(turns(p)).toHaveCount(1);
  await expect(box).toHaveValue("my draft");
  await ask.getByRole("button", { name: "Allow once" }).click({ timeout: 1000 }).catch(() => undefined);
  expect(askLog(w).length).toBe(1);
  expect(askLog(w)[0]?.decision).toBe("deny");
  expect(w.launches()[0]?.answers.length).toBe(1);
  await say(p, "second");
  await expect(pane(p).getByRole("region", { name: "Bash wants to run" })).toBeVisible();
  await box.fill("my draft");
  await box.press("Meta+Enter");
  await expect(turns(p).nth(1).locator('[data-role="turn-end"]')).toBeVisible();
  await expect(box).toHaveValue("my draft");
  await expect(turns(p)).toHaveCount(2);
  await box.press("Enter");
  await expect(turns(p)).toHaveCount(3);
});

const question = {
  questions: [{ question: "Which store?", header: "Store", options: [{ label: "Postgres", description: "One server" }, { label: "SQLite", description: "One file" }], multiSelect: false }],
};
test("[22.4] the user answers an agent's question with the form", async ({ page: p, browser }) => {
  const w = await boot({ roles: { chat: { replies: [[{ ask: { id: "q1", tool: "AskUserQuestion", input: question } }]] } } });
  await p.goto(`${w.url}/map`);
  await say(p, "Ask me");
  const form = pane(p).getByRole("form", { name: "The agent asks" });
  await expect(form).toContainText("Which store?");
  await expect(form).toContainText("One file");
  await expect(form).toContainText("One server");
  await expect(form.getByRole("textbox")).toHaveCount(1);
  await expect(form.getByRole("button", { name: "Submit answer" })).toBeVisible();
  await expect(form.getByRole("button", { name: "Decline" })).toBeVisible();
  await expect(form).not.toContainText('"questions"');
  await form.getByRole("radio", { name: /SQLite/ }).check();
  const other = await (await browser.newContext()).newPage();
  await other.goto(`${w.url}/map`);
  w.werk("add", "x1", "--title", "Rerender", "--parent", "root");
  await expect(p.locator('[data-tile="x1"]')).toBeVisible();
  await expect(form.getByRole("radio", { name: /SQLite/ })).toBeChecked();
  await form.getByRole("button", { name: "Submit answer" }).click();
  await expect(turns(p).nth(0).locator('[data-role="turn-end"]')).toBeVisible();
  const a = w.launches()[0]?.answers[0] as { behavior: string; message: string };
  expect(JSON.stringify(a)).toContain('For \\"Which store?\\": SQLite');
  expect(askLog(w)).toMatchObject([{ tool: "AskUserQuestion", decision: "answer" }]);
  await expect(turns(p).nth(0)).not.toContainText(/failed/i);
});

test("[22.5] the user declines an agent's question", async ({ page: p }) => {
  const w = await boot({ roles: { chat: { replies: [[{ ask: { id: "q1", tool: "AskUserQuestion", input: question } }]] } } });
  await p.goto(`${w.url}/map`);
  await p.route("**/api/ask", async (route) => {
    await new Promise((r) => setTimeout(r, 1200));
    await route.continue();
  });
  await say(p, "Ask me");
  const form = pane(p).getByRole("form", { name: "The agent asks" });
  await form.getByRole("button", { name: "Decline" }).click();
  for (const b of await form.getByRole("button").all()) await expect(b).toBeDisabled();
  await expect(turns(p).nth(0).locator('[data-role="turn-end"]')).toBeVisible();
  expect((w.launches()[0]?.answers[0] as { behavior: string }).behavior).toBe("deny");
  expect(askLog(w)).toMatchObject([{ tool: "AskUserQuestion", decision: "deny" }]);
});

// ---------- 73, 76
test("[73.3] each turn starts with the card the person looks at now", async ({ page: p }) => {
  const w = await boot({ roles: { chat: { replies: [reply("m1", "one"), reply("m2", "two")] } } }, (s) => {
    s.seed("node.added", { id: "pr-log", kind: "card", title: "The log", parent: "root" });
    s.seed("node.added", { id: "vi-prop-trace", kind: "card", title: "The trace", parent: "root" });
  });
  await p.goto(`${w.url}/map/pr-log`);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("The log");
  await say(p, "Explain the fold");
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("one");
  await p.goto(`${w.url}/map/vi-prop-trace`);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("The trace");
  await say(p, "And this one?");
  await expect(turns(p).last().locator(".msg.agent")).toHaveText("two");
  const m = w.launches()[0]?.messages ?? [];
  expect(m[0]).toMatch(/^\[the map is now at #pr-log/);
  expect(m[1]).toMatch(/^\[the map is now at #vi-prop-trace/);
  expect(m[1]).not.toMatch(/^\[?#?pr-log/);
});

test("[76.2] the chat agent keeps the model I pick in the chat header", async ({ page: p }) => {
  const w = await boot({ roles: { chat: { replies: [reply("m1", "one", "sess-m"), reply("m2", "two", "sess-m")] } } });
  await p.goto(`${w.url}/map`);
  await sel(p).selectOption({ label: "Opus" });
  await say(p, "hello");
  await expect(turns(p).nth(0).locator('[data-role="turn-end"]')).toBeVisible();
  let a = w.launches()[0]?.args ?? [];
  expect(a[a.indexOf("--model") + 1]).toBe("claude-opus-5-5");
  expect(a).not.toContain("--advisor");
  await sel(p).selectOption({ label: "Sonnet + Opus advisor" });
  await say(p, "again");
  await expect(turns(p).nth(1).locator('[data-role="turn-end"]')).toBeVisible();
  a = w.launches().at(-1)?.args ?? [];
  expect(a[a.indexOf("--model") + 1]).toMatch(/^claude-sonnet/);
  expect(a[a.indexOf("--advisor") + 1]).toBe("claude-opus-5-5");
  expect(a[a.indexOf("--resume") + 1]).toBe("sess-m");
});

test("[73.5] a note sent to the note route appears in the card's thread", async ({ page: p, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const w = await boot({ roles: {} }, (s) => s.seed("node.added", { id: "werk-chat", kind: "card", title: "The composer sends a live agent turn", parent: "root", status: "decided", who: "me" }));
  await p.goto(`${w.url}/map/root`);
  const token = (await p.locator('meta[name="werk-token"]').getAttribute("content")) ?? "";
  const logPath = join(w.dir, ".werk", "log.jsonl");
  const before = readFileSync(logPath, "utf8").split("\n").filter(Boolean).length;
  const reqs: string[] = [];
  p.on("request", (r) => { if (r.url().includes("/api/notes")) reqs.push(r.url()); });
  const r = await fetch(`${w.url}/api/notes`, { method: "POST", headers: { "content-type": "application/json", "x-werk-token": token }, body: JSON.stringify({ id: "werk-chat", text: "check the stdin path" }) });
  expect(r.status).toBe(200);
  const after = readFileSync(logPath, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  expect(after.length).toBe(before + 1);
  expect(after.at(-1)).toMatchObject({ type: "note.added", payload: { id: "werk-chat" } });
  await p.goto(`${w.url}/map/werk-chat`);
  await expect(p.locator('[data-section="thread"] [data-entry="note"]', { hasText: "check the stdin path" })).toHaveCount(1);
  expect(reqs).toEqual([]);
  expect(await p.evaluate(() => navigator.clipboard.readText())).toBe('re #werk-chat "The composer sends a live agent turn": check the stdin path');
});
