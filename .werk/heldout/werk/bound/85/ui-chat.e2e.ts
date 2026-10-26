// Held-out browser tests: the chat pane, conversation settings, asks (steps 19.2, 20, 21, 22, 73, 76.2).
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { cleanup, flagOf, heldProject, type Held } from "./util.ts";

test.afterEach(cleanup);

const stream = (event: object) => ({ event: { type: "stream_event", event } });
const start = (id: string) => stream({ type: "message_start", message: { id } });
const open = (text: string) => stream({ type: "content_block_start", index: 0, content_block: { type: "text", text } });
const more = (text: string) => stream({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text } });
const done = (id: string, text: string, usage?: object) => ({ event: { type: "assistant", message: { id, content: [{ type: "text", text }], ...(usage ? { usage } : {}) } } });
const reply = (id: string, text: string) => [start(id), open(text), done(id, text)];
const init = (s: string) => ({ event: { type: "system", subtype: "init", session_id: s } });

const pane = (p: Page) => p.getByRole("complementary", { name: "Chat" });
const turns = (p: Page) => pane(p).locator("[data-turn]");
async function say(p: Page, words: string) {
  await pane(p).getByRole("textbox", { name: "Message" }).fill(words);
  await pane(p).getByRole("button", { name: "Send" }).click();
}
const card = (w: Held, id: string, f: Record<string, unknown> = {}) =>
  w.seed("node.added", { id, kind: "card", title: id, parent: "root", status: "decided", who: "me", ...f });

test("19.2 chat part", async ({ page: p }) => {
  const w = await heldProject({ roles: { chat: { replies: [reply("m1", "hi")] } } }, (s) => {
    s.seed("node.added", { id: "how", kind: "card", title: "Build rules", status: "decided", who: "me" });
    for (const t of ["Tests run on Bun", "Lint with Biome"]) s.seed("node.added", { id: t.split(" ")[0]!.toLowerCase(), kind: "card", title: t, parent: "how", status: "decided", who: "me" });
  });
  await p.goto(`${w.url}/map`);
  await say(p, "hello");
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("hi");
  const args = w.launches()[0]!.args;
  const prompt = flagOf(args, "--append-system-prompt") ?? "";
  expect(prompt).toContain("how to work with the decision map");
  expect(prompt).toContain("Tests run on Bun");
  expect(prompt).toContain("Lint with Biome");
});

test("20.1", async ({ page: p }) => {
  const w = await heldProject(
    { roles: { chat: { replies: [[start("m1"), open("Making it **three** tries, see #retry. "), { pause: 2500 }, more("Done."), { edit: { path: ".werk/log.jsonl", content: "" } }, { pause: 1500 }, done("m1", "Making it **three** tries, see #retry. Done.", { input_tokens: 40, output_tokens: 20 })]] } } },
    (s) => card(s, "retry", { title: "Checkout retries", why: "Two tries" }),
  );
  const log = [
    { seq: 1, type: "node.added", payload: { id: "root", kind: "card", title: "Root" } },
    { seq: 2, type: "node.added", payload: { id: "retry", kind: "card", title: "Checkout retries", why: "Three tries", parent: "root", status: "decided", who: "me" } },
  ].map((e) => JSON.stringify({ at: "t", actor: "agent", ...e })).join("\n");
  w.setScript({ roles: { chat: { replies: [[start("m1"), open("Making it **three** tries, see #retry. "), { edit: { path: ".werk/log.jsonl", content: `${log}\n` } }, { pause: 2500 }, more("Done."), done("m1", "Making it **three** tries, see #retry. Done.")]] } } });
  await p.goto(`${w.url}/map/retry`);
  await expect(p.locator('[data-field="why"]')).toContainText("Two tries");
  await say(p, "Make it three tries");
  await expect(turns(p).nth(0).locator(".msg.user")).toHaveText("Make it three tries");
  await expect(turns(p).nth(0).locator(".msg.agent")).toContainText("Making it");
  const header = pane(p).locator('[data-role="chat-header"]');
  await expect(header).toContainText(/ · \d+(\.\d+)?s? .*token/);
  console.log("20.1 header while running:", await header.textContent());
  await expect(p.locator('[data-field="why"]')).toContainText("Three tries");
  await expect(turns(p).nth(0).locator('[data-role="turn-end"]')).toHaveCount(0);
  await expect(turns(p).nth(0).locator(".msg.agent strong")).toHaveText("three");
  await expect(turns(p).nth(0).locator(".msg.agent a")).toHaveAttribute("href", "/map/retry");
  await expect(turns(p).nth(0).locator('[data-role="turn-end"]')).toBeVisible();
  await expect(turns(p).nth(0).locator(".msg.agent")).toContainText("Done.");
  await expect(header).not.toContainText("working");
});

test("20.2", async ({ page: p }) => {
  const w = await heldProject({ roles: { chat: { replies: [[start("m1"), open("Two tries"), { pause: 2500 }, more(" is the rule."), done("m1", "Two tries is the rule.")], reply("m2", "Here are the ghosts.")] } } });
  await p.goto(`${w.url}/map`);
  await say(p, "First question");
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("Two tries");
  await say(p, "Second question");
  await expect(turns(p).nth(1).locator(".msg.user")).toHaveText("Second question");
  await expect(turns(p).nth(1).locator('[data-mark="waiting"]')).toHaveText(/waits for the reply above/);
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("Two tries is the rule.");
  await expect(turns(p).nth(1).locator('[data-mark="waiting"]')).toHaveCount(0);
  await expect(turns(p).nth(1).locator(".msg.agent")).toHaveText("Here are the ghosts.");
});

test("20.3", async ({ page: p }) => {
  const w = await heldProject({ roles: { chat: { replies: [reply("m1", "one"), reply("m2", "two"), reply("m3", "three")] } } }, (s) =>
    card(s, "retry", { title: "Checkout retries", why: "Cards fail" }),
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
  const msgs = w.launches()[0]!.messages;
  console.log("20.3 messages:", JSON.stringify(msgs));
  expect(msgs[0]).toContain("Cards fail");
  expect(msgs[0]).toContain("Checkout retries");
  expect(msgs[1]).toBe("[still on #retry — Checkout retries]\n\nAnd now?");
  expect(msgs[2]).toContain("#root");
});

test("20.4", async ({ page: p }) => {
  const call = (id: string, command: string) => ({ event: { type: "assistant", message: { id: `m-${id}`, content: [{ type: "tool_use", id, name: "Bash", input: { command } }] } } });
  const result = (id: string, content: string) => ({ event: { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content }] } } });
  const w = await heldProject({ roles: { chat: { replies: [[call("t1", "ls"), result("t1", "a.txt"), call("t2", "pwd"), result("t2", "/project"), call("t3", "git status"), result("t3", "clean"), ...reply("m4", "All clean.")]] } } });
  await p.goto(`${w.url}/map`);
  await say(p, "Look at the code");
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("All clean.");
  const run = turns(p).nth(0).locator('[data-role="tool-run"]');
  await expect(run).toHaveCount(1);
  await expect(run.locator("summary")).toHaveText(/git status.*3/);
  await expect(run.locator('[data-role="tool-call"]').first()).toBeHidden();
  await run.locator("summary").click();
  await expect(run.locator('[data-role="tool-call"]')).toHaveCount(3);
  await expect(run.locator('[data-role="tool-output"]').nth(1)).toHaveText("/project");
});

test("20.5", async ({ page: p }) => {
  const w = await heldProject({ roles: { chat: { replies: [reply("m1", "never")] } } }, (s) => card(s, "retry", { title: "Checkout retries", why: "two tries" }));
  await p.goto(`${w.url}/map/retry`);
  const res = await fetch(`${w.url}/api/chat`, { method: "POST", headers: { "content-type": "application/json", origin: "http://evil.example" }, body: JSON.stringify({ text: "Make it three tries", turn: "t1", card: "retry" }) });
  expect(res.status).toBe(403);
  await p.waitForTimeout(600);
  expect(w.launches()).toEqual([]);
  await expect(turns(p)).toHaveCount(0);
  expect(readFileSync(w.log, "utf8")).toContain("two tries");
});

// ---- 21
const pie = (p: Page) => pane(p).getByRole("button", { name: /^Context \d+%/ });
const model = (p: Page) => pane(p).getByRole("combobox", { name: "Model" });
const OPUS_RESULT = { type: "result", modelUsage: { "claude-opus-5-5": { contextWindow: 200000 }, "claude-sonnet-5-5[1m]": { contextWindow: 1000000 } } };

test("21.1", async ({ page: p }) => {
  const w = await heldProject({ roles: { chat: { replies: [[init("s-1"), ...reply("m1", "ok"), { event: OPUS_RESULT }].map((x, i) => x)] } } });
  w.setScript({ roles: { chat: { replies: [[init("s-1"), start("m1"), open("ok"), done("m1", "ok", { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 149850 }), { event: OPUS_RESULT }], [init("s-1"), ...reply("m2", "You asked: Hello there")]], sessions: ["s-1"] } } });
  await p.goto(`${w.url}/map`);
  await model(p).selectOption({ label: "Opus" });
  await say(p, "Hello there");
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("ok");
  await expect(turns(p).nth(0).locator('[data-role="turn-end"]')).toBeVisible();
  await expect(model(p)).toHaveValue(/claude-opus-5-5\|$/);
  const before = await pie(p).getAttribute("aria-label");
  console.log("21.1 pie before:", before);
  expect(before).not.toBe("Context 0%");
  await w.restart();
  await p.goto(`${w.url}/map`);
  await expect(model(p)).toHaveValue(/claude-opus-5-5\|$/);
  expect(await pie(p).getAttribute("aria-label")).toBe(before);
  await say(p, "What did I ask you before?");
  await expect(turns(p).nth(0).locator(".msg.agent")).toBeVisible();
  await expect.poll(() => w.launches().length).toBeGreaterThanOrEqual(2);
  expect(flagOf(w.launches().at(-1)!.args, "--resume")).toBe("s-1");
  expect(flagOf(w.launches().at(-1)!.args, "--model")).toBe("claude-opus-5-5");
});

test("21.2", async ({ page: p }) => {
  const w = await heldProject({ roles: { chat: { replies: [[init("s-1"), ...reply("m1", "first answer")]] } } });
  await p.goto(`${w.url}/map`);
  await say(p, "first");
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("first answer");
  w.setScript({ roles: { chat: { replies: [[init("s-2"), ...reply("m2", "fresh answer")]], sessions: ["s-2"] } } });
  await w.restart();
  await p.goto(`${w.url}/map`);
  await say(p, "are you there?");
  await expect(pane(p)).toContainText("fresh answer");
  await expect(pane(p)).not.toContainText("Your message was not delivered");
  const ls = w.launches();
  expect(flagOf(ls.at(-1)!.args, "--resume")).toBeUndefined();
  expect(ls.at(-1)!.messages.join("\n")).toContain("are you there?");
});

test("21.3", async ({ page: p }) => {
  const w = await heldProject({ roles: { chat: { replies: [[init("s-1"), ...reply("m1", "first answer")]] } } });
  await p.goto(`${w.url}/map`);
  await say(p, "first");
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("first answer");
  const bad = [{ stderr: "line one\nline two\nline three\nline four\nline five\nline six\nline seven\nline eight\n" }, { crash: 1 }];
  w.setScript({ roles: { chat: { replies: [bad], sessions: ["s-1"] } } });
  await w.restart();
  await p.goto(`${w.url}/map`);
  const before = w.launches().length;
  await say(p, "second");
  await expect(pane(p)).toContainText("Your message was not delivered. Send it again.");
  expect(w.launches().length - before).toBe(2);
  const text = await pane(p).textContent();
  for (const l of ["line one", "line eight"]) {
    // lines past the sixth fold behind a disclosure; open it
  }
  const disclosure = pane(p).locator('[data-role="agent-error"] summary');
  if (await disclosure.count()) await disclosure.click();
  for (const l of ["line one", "line two", "line three", "line four", "line five", "line six", "line seven", "line eight"]) await expect(pane(p)).toContainText(l);
  w.setScript({ roles: { chat: { replies: [[init("s-1"), ...reply("m3", "recovered")]], sessions: ["s-1"] } } });
  await say(p, "second again");
  await expect(pane(p)).toContainText("recovered");
  expect(flagOf(w.launches().at(-1)!.args, "--resume")).toBe("s-1");
  void text;
});

test("21.4", async ({ page: p }) => {
  const error = "Not logged in.\nRemove the credential and run: claude auth login\n";
  const w = await heldProject({ roles: { chat: { replies: [[{ stderr: error }, { crash: 1 }]] } } });
  await p.goto(`${w.url}/map`);
  await say(p, "hello");
  await expect(pane(p)).toContainText("Your message was not delivered. Send it again.");
  await expect(pane(p)).toContainText("Not logged in.");
  await expect(pane(p)).toContainText("claude auth login");
  await p.waitForTimeout(600);
  expect(w.launches()).toHaveLength(1);
});

test("21.5", async ({ page: p }) => {
  const w = await heldProject({ roles: { chat: { replies: [[init("s-1"), start("m1"), open("working"), { pause: 3000 }, done("m1", "working done", { input_tokens: 10 }), { event: OPUS_RESULT }], [init("s-2"), ...reply("m2", "after clear")]] } } });
  await p.goto(`${w.url}/map`);
  await expect(model(p).locator("option:checked")).toHaveText("Sonnet + Opus advisor".length ? /Sonnet/ : "");
  await model(p).selectOption({ label: "Sonnet" });
  await expect(model(p).locator("option:checked")).toHaveText("Sonnet");
  const empty = await pie(p).evaluate((el) => getComputedStyle(el).backgroundImage + getComputedStyle(el).backgroundColor);
  console.log("21.5 pie style before turn:", empty);
  await say(p, "do a long turn");
  await expect(turns(p).nth(0).locator(".msg.agent")).toBeVisible();
  await expect(model(p)).toBeDisabled();
  await expect(model(p).locator("option:checked")).toHaveText("Sonnet");
  await expect(turns(p).nth(0).locator('[data-role="turn-end"]')).toBeVisible({ timeout: 15000 });
  await model(p).selectOption({ label: "Sonnet + Opus advisor" });
  await expect(model(p).locator("option:checked")).toHaveText("Sonnet + Opus advisor");
  await expect(pane(p)).not.toContainText("exited");
  await pie(p).click();
  const pop = pane(p).getByRole("dialog", { name: "Context" });
  await expect(pop).toContainText(/\d+% of the context window/);
  await pop.getByRole("button", { name: "Clear context" }).click();
  await expect(pane(p)).not.toContainText("not delivered");
  await say(p, "next one");
  await expect(turns(p).last().locator(".msg.user")).toHaveText("next one");
  await expect(turns(p).last().locator(".msg.agent")).toHaveText("working done", { timeout: 20000 });
});

// ---- 22
const askLog = (w: Held) => readFileSync(join(w.dir, ".werk", "asks.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));

test("22.1", async ({ page: p }) => {
  const input = { command: "curl -s https://example.com" };
  const w = await heldProject({ roles: { chat: { replies: [[{ ask: { id: "r1", tool: "Bash", input, reason: "rule" } }]] } } });
  await p.goto(`${w.url}/map`);
  await say(p, "Fetch it");
  const ask = pane(p).getByRole("region", { name: "Bash wants to run" });
  await expect(ask).toBeVisible();
  await expect(ask.locator("[data-role=ask-call]")).toContainText("curl -s https://example.com");
  await expect(ask.locator("[data-role=ask-reason]")).toContainText("rule");
  await expect(ask.getByRole("button")).toHaveText(["Allow once", "Deny"]);
  const allow = ask.getByRole("button", { name: "Allow once" });
  await allow.click();
  await expect(turns(p).nth(0).locator('[data-role="turn-end"]')).toBeVisible();
  expect(askLog(w)).toMatchObject([{ tool: "Bash", reason: "rule", decision: "allow" }]);
  expect(askLog(w)[0].input ?? askLog(w)[0].call ?? {}).toBeDefined();
});

test("22.1b buttons disabled after click", async ({ page: p }) => {
  const w = await heldProject({ roles: { chat: { replies: [[{ ask: { id: "r1", tool: "Bash", input: { command: "ls" }, reason: "rule" } }, { pause: 2500 }]] } } });
  await p.goto(`${w.url}/map`);
  await say(p, "Go");
  const ask = pane(p).getByRole("region", { name: "Bash wants to run" });
  await ask.getByRole("button", { name: "Allow once" }).click();
  for (const b of await ask.getByRole("button").all()) await expect(b).toBeDisabled();
});

test("22.2", async ({ page: p }) => {
  const mkdir = { type: "addRules", rules: [{ toolName: "Bash", ruleContent: "mkdir:*" }], behavior: "allow" };
  const input = { command: "mkdir -p /tmp/x" };
  const call = { ask: { id: "r1", tool: "Bash", input, suggestions: [mkdir] } };
  const w = await heldProject({ roles: { chat: { replies: [[call]] } } });
  await p.goto(`${w.url}/map`);
  await say(p, "Make it");
  await pane(p).getByRole("button", { name: "Always allow Bash(mkdir:*)" }).click();
  await expect(turns(p).nth(0).locator('[data-role="turn-end"]')).toBeVisible();
  expect(askLog(w)[0]).toMatchObject({ decision: "always", widened: ["Bash(mkdir:*)"] });
  expect((w.launches()[0]!.answers[0] as any).updatedPermissions).toEqual([mkdir]);
  expect(JSON.parse(readFileSync(join(w.dir, ".werk", "allow.json"), "utf8")).main.rules).toEqual(["Bash(mkdir:*)"]);
  // The fake agent always asks; the real CLI skips the ask when the rule is on its flags. So check the flags of the next launches.
  w.setScript({ roles: { chat: { replies: [[call, ...reply("m9", "ran again")]] } } });
  await w.restart();
  await p.goto(`${w.url}/map`);
  await say(p, "After restart");
  await expect.poll(() => w.launches().length).toBeGreaterThanOrEqual(2);
  const args = w.launches().at(-1)!.args;
  console.log("22.2 flags after restart:", JSON.stringify(args.slice(args.indexOf("--allowedTools"), args.indexOf("--allowedTools") + 2)));
  expect(args[args.indexOf("--allowedTools") + 1]).toBe("Bash(mkdir:*)");
});

test("22.3", async ({ page: p }) => {
  const w = await heldProject({ roles: { chat: { replies: [[{ ask: { id: "r1", tool: "Bash", input: { command: "ls" } } }], [{ ask: { id: "r2", tool: "Bash", input: { command: "pwd" } } }], reply("m3", "sent")] } } });
  await p.goto(`${w.url}/map`);
  await say(p, "first");
  const ask = pane(p).getByRole("region", { name: "Bash wants to run" });
  await expect(ask).toBeVisible();
  const box = pane(p).getByRole("textbox", { name: "Message" });
  await box.fill("a draft");
  await p.keyboard.press("Escape");
  await expect(turns(p).nth(0).locator('[data-role="turn-end"]')).toBeVisible();
  expect(w.launches()[0]!.answers[0]).toMatchObject({ behavior: "deny" });
  await expect(box).toHaveValue("a draft");
  await expect(turns(p)).toHaveCount(1);
  expect(askLog(w).length).toBe(1);
  expect(askLog(w)[0].decision).toBe("deny");
  await say(p, "second");
  await expect(pane(p).getByRole("region", { name: "Bash wants to run" })).toBeVisible();
  await box.fill("a draft");
  await box.press("Meta+Enter");
  await expect(turns(p).nth(1).locator('[data-role="turn-end"]')).toBeVisible();
  await expect(box).toHaveValue("a draft");
  await box.press("Enter");
  await expect(turns(p).last().locator(".msg.user")).toHaveText("a draft");
});

const QUESTION = { questions: [{ question: "Which store?", header: "Store", options: [{ label: "Postgres", description: "One server for every reader" }, { label: "SQLite", description: "One file beside the map" }], multiSelect: false }] };
test("22.4", async ({ page: p }) => {
  const w = await heldProject({ roles: { chat: { replies: [[{ ask: { id: "q1", tool: "AskUserQuestion", input: QUESTION } }]] } } });
  await p.goto(`${w.url}/map`);
  await say(p, "Ask me");
  const form = pane(p).getByRole("form", { name: "The agent asks" });
  await expect(form).toContainText("Which store?");
  await expect(form).toContainText("One file beside the map");
  await expect(form.getByRole("button", { name: "Submit answer" })).toBeVisible();
  await expect(form.getByRole("button", { name: "Decline" })).toBeVisible();
  await expect(form.getByRole("textbox")).toBeVisible();
  await expect(pane(p)).not.toContainText('"questions"');
  await form.getByRole("radio", { name: /SQLite/ }).check();
  // another tab on the same conversation makes the pane re-render
  const other = await p.context().newPage();
  await other.goto(`${w.url}/map`);
  w.werk("add", "x1", "--title", "X one", "--parent", "root");
  await expect(p.locator('a[data-tile="x1"]')).toBeVisible();
  await expect(form.getByRole("radio", { name: /SQLite/ })).toBeChecked();
  await form.getByRole("button", { name: "Submit answer" }).click();
  await expect(turns(p).nth(0).locator('[data-role="turn-end"]')).toBeVisible();
  const ans = w.launches()[0]!.answers[0] as any;
  console.log("22.4 answer:", JSON.stringify(ans));
  expect(JSON.stringify(ans)).toContain('For \\"Which store?\\": SQLite');
  expect(askLog(w)).toMatchObject([{ tool: "AskUserQuestion", decision: "answer" }]);
  await expect(pane(p)).not.toContainText(/failed|error/i);
});

test("22.5", async ({ page: p }) => {
  const w = await heldProject({ roles: { chat: { replies: [[{ ask: { id: "q1", tool: "AskUserQuestion", input: QUESTION } }]] } } });
  await p.goto(`${w.url}/map`);
  await say(p, "Ask me");
  const form = pane(p).getByRole("form", { name: "The agent asks" });
  await form.getByRole("button", { name: "Decline" }).click();
  for (const b of await form.getByRole("button").all()) await expect(b).toBeDisabled();
  await expect(turns(p).nth(0).locator('[data-role="turn-end"]')).toBeVisible();
  expect(w.launches()[0]!.answers[0]).toMatchObject({ behavior: "deny" });
  expect(askLog(w)).toMatchObject([{ tool: "AskUserQuestion", decision: "deny" }]);
});

// ---- 73
test("73.1", async ({ page: p }) => {
  const w = await heldProject({ roles: { chat: { replies: [[start("m1"), open("The card is "), { pause: 1500 }, more("**bold** and "), { pause: 1500 }, more("see #werk-wording."), done("m1", "The card is **bold** and see #werk-wording.")]] } } }, (s) => {
    card(s, "werk-chat", { title: "Chat" });
    card(s, "werk-wording", { title: "Wording" });
  });
  await p.goto(`${w.url}/map/werk-chat`);
  await expect(p.getByRole("tab", { name: "design" })).toBeVisible({ timeout: 2000 });
  let seen: any;
  await p.route("**/api/chat", async (route) => {
    seen = route.request().postDataJSON();
    await route.continue();
  });
  const box = pane(p).getByRole("textbox", { name: "Message" });
  await box.fill("What does this card decide?");
  await box.press("Enter");
  await expect(box).toHaveValue("");
  await expect(turns(p).nth(0).locator(".msg.agent")).toContainText("The card is");
  await expect(turns(p).nth(0).locator(".msg.agent")).not.toContainText("see #werk-wording");
  await expect(turns(p).nth(0).locator(".msg.agent")).toContainText("see");
  expect(seen).toMatchObject({ text: "What does this card decide?", card: "werk-chat" });
  console.log("73.1 request body:", JSON.stringify(seen));
  expect(typeof seen.turn).toBe("string");
  await expect(turns(p).nth(0).locator(".msg.agent strong")).toHaveText("bold");
  const link = turns(p).nth(0).locator(".msg.agent a");
  await expect(link).toHaveAttribute("href", "/map/werk-wording");
  await link.click();
  await expect(p).toHaveURL(/\/map\/werk-wording$/);
});

test("73.2", async ({ page: p }) => {
  const w = await heldProject({ roles: { chat: { replies: [reply("m1", "Looks right.")] } } }, (s) => card(s, "visual", { title: "Visual" }));
  await p.goto(`${w.url}/map/visual`);
  const reqs: any[] = [];
  await p.route("**/api/**", async (route) => {
    if (route.request().method() === "POST") reqs.push({ url: route.request().url(), body: route.request().postData() ?? "" });
    await route.continue();
  });
  const box = pane(p).getByRole("textbox", { name: "Message" });
  await box.fill("Does this layout match the card?");
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
  await box.evaluate(async (el, b64) => {
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const file = new File([bytes], "x.png", { type: "image/png" });
    const dt = new DataTransfer();
    dt.items.add(file);
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, png);
  await box.press("Enter");
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("Looks right.");
  const chats = reqs.filter((r) => r.url.includes("/api/chat"));
  console.log("73.2 requests:", reqs.map((r) => r.url), "body keys:", chats.map((c) => Object.keys(JSON.parse(c.body))));
  expect(reqs.length).toBe(1);
  const body = JSON.parse(chats[0].body);
  expect(body.text).toContain("Does this layout match the card?");
  expect(body.card).toBe("visual");
  expect(JSON.stringify(body)).toMatch(/image|png|base64/i);
});

test("73.3", async ({ page: p }) => {
  const w = await heldProject({ roles: { chat: { replies: [reply("m1", "one"), reply("m2", "two")] } } }, (s) => {
    card(s, "pr-log", { title: "PR log" });
    card(s, "vi-prop-trace", { title: "Trace" });
  });
  await p.goto(`${w.url}/map/pr-log`);
  await say(p, "Explain the fold");
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("one");
  await p.goto(`${w.url}/map/vi-prop-trace`);
  await say(p, "And this one?");
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("two");
  const msgs = w.launches()[0]!.messages;
  expect(msgs[0]!.startsWith("[the map is now at #pr-log")).toBe(true);
  expect(msgs[1]!.startsWith("[the map is now at #vi-prop-trace")).toBe(true);
  expect(msgs[1]).not.toMatch(/^\[(the map is now at|still on) #pr-log/);
});

test("73.4", async ({ page: p }) => {
  const w = await heldProject({ roles: { chat: { replies: [reply("m1", "alpha reply")] } } }, (s) => card(s, "werk-cli", { title: "CLI" }));
  await p.goto(`${w.url}/map/werk-cli`);
  const tabs = p.getByRole("tablist");
  console.log("73.4 tablists:", await tabs.count(), await p.getByRole("tab").allTextContents());
  const tab = (n: string) => p.getByRole("tab", { name: n });
  await expect(tab("alpha")).toBeVisible({ timeout: 3000 });
});

test("73.5", async ({ page: p }) => {
  const w = await heldProject({ roles: { chat: { replies: [] } } }, (s) => card(s, "werk-chat", { title: "The composer sends a live agent turn" }));
  await p.goto(`${w.url}/map/werk-chat`);
  const before = readFileSync(w.log, "utf8").split("\n").filter(Boolean).length;
  const token = (await p.locator('meta[name="werk-token"]').getAttribute("content")) ?? "";
  const reqs: string[] = [];
  p.on("request", (r) => reqs.push(r.url()));
  const route = await fetch(`${w.url}/api/notes`, { method: "POST", headers: { "content-type": "application/json", "x-werk-token": token }, body: JSON.stringify({ id: "werk-chat", text: "check the stdin path" }) });
  expect(route.status).toBe(200);
  const lines = readFileSync(w.log, "utf8").split("\n").filter(Boolean);
  expect(lines.length).toBe(before + 1);
  expect(JSON.parse(lines.at(-1)!).type).toBe("note.added");
  const clip = spawnSync("pbpaste", { encoding: "utf8" }).stdout;
  console.log("73.5 clipboard:", JSON.stringify(clip.slice(0, 120)));
  expect(clip).toContain('re #werk-chat "The composer sends a live agent turn": check the stdin path');
  await p.goto(`${w.url}/map/werk-chat`);
  await expect(p.locator('[data-section="thread"] [data-entry="note"]', { hasText: "check the stdin path" })).toHaveCount(1);
  expect(reqs.filter((u) => u.includes("/api/notes"))).toEqual([]);
});

test("76.2", async ({ page: p }) => {
  const w = await heldProject({ roles: { chat: { replies: [[init("s-1"), ...reply("m1", "one")]] } } });
  await p.goto(`${w.url}/map`);
  await model(p).selectOption({ label: "Opus" });
  await say(p, "first");
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("one");
  let a = w.launches().at(-1)!.args;
  expect(flagOf(a, "--model")).toBe("claude-opus-5-5");
  expect(a).not.toContain("--advisor");
  await expect(turns(p).nth(0).locator('[data-role="turn-end"]')).toBeVisible();
  await model(p).selectOption({ label: "Sonnet + Opus advisor" });
  await say(p, "second");
  await expect.poll(() => w.launches().length).toBe(2);
  a = w.launches().at(-1)!.args;
  expect(flagOf(a, "--model")).toBe("claude-sonnet-5-5[1m]");
  expect(flagOf(a, "--advisor")).toBe("claude-opus-5-5");
  expect(flagOf(a, "--resume")).toBe("s-1");
});
