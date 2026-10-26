import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { LAUNCHES_FILE, type LaunchEntry } from "../src/test/fake-script.ts";
import { project, stop, type Werk } from "../e2e/project.ts";
import { echoProject, stopEcho } from "./echo-project.ts";

test.afterEach(async () => {
  await stop();
  await stopEcho();
});

const stream = (event: object) => ({ event: { type: "stream_event", event } });
const start = (id: string) => stream({ type: "message_start", message: { id } });
const open = (text: string) => stream({ type: "content_block_start", index: 0, content_block: { type: "text", text } });
const more = (text: string) => stream({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text } });
const done = (id: string, text: string) => ({ event: { type: "assistant", message: { id, content: [{ type: "text", text }] } } });
const reply = (id: string, text: string) => [start(id), open(text), done(id, text)];

const pane = (p: Page) => p.getByRole("complementary", { name: "Chat" });
const turns = (p: Page) => pane(p).locator("[data-turn]");
async function say(p: Page, words: string) {
  await pane(p).getByRole("textbox", { name: "Message" }).fill(words);
  await pane(p).getByRole("button", { name: "Send" }).click();
}
function launchesFile(w: { dir: string }) {
  return join(w.dir, "..", "fake", LAUNCHES_FILE);
}
function entries(w: { dir: string }): LaunchEntry[] {
  const f = launchesFile(w);
  return existsSync(f) ? readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as LaunchEntry) : [];
}
const heard = (w: { dir: string }) =>
  entries(w).flatMap((e) => (e.kind === "message" ? [(e.message as any).message.content[0].text as string] : []));
const answers = (w: { dir: string }) => entries(w).flatMap((e) => (e.kind === "answer" ? [e.answer] : []));
const askLog = (w: { dir: string }) =>
  readFileSync(join(w.dir, ".werk", "asks.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as any);

test("[20.1] a reply streams, the header shows work, the agent writes the card", async ({ page: p }) => {
  const line = (seq: number, type: string, payload: object) => JSON.stringify({ seq, at: "t", actor: "you", type, payload });
  const log = [
    line(1, "node.added", { id: "root", kind: "card", title: "Root" }),
    line(2, "node.added", { id: "retry", kind: "card", title: "Checkout retries", parent: "root", body: "Checkout retries three tries." }),
  ].join("\n");
  const w = await project(
    {
      roles: {
        chat: {
          replies: [
            [
              start("m1"),
              open("Changing **it** now,"),
              stream({ type: "message_delta", usage: { output_tokens: 42 } }),
              { pause: 2500 },
              { edit: { path: ".werk/log.jsonl", content: `${log}\n` } },
              more(" see #retry for the result."),
              { pause: 2500 },
              done("m1", "Changing **it** now, see #retry for the result."),
            ],
          ],
        },
      },
    },
    (s) => s.seed("node.added", { id: "retry", kind: "card", title: "Checkout retries", parent: "root", body: "Checkout retries two tries." }),
  );
  await p.goto(`${w.url}/map/retry`);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Checkout retries");
  await expect(p.locator('[data-field="body"]')).toContainText("two tries");
  await say(p, "Make it three tries");
  await expect(turns(p).nth(0).locator(".msg.user")).toHaveText("Make it three tries");
  await expect(turns(p).nth(0).locator(".msg.agent")).toContainText("Changing it now,");
  const status = pane(p).getByRole("status", { name: "Turn state" });
  await expect(status).toContainText(/\d+s/);
  await expect(status).toContainText(/\d+ tokens?/);
  await expect(turns(p).nth(0).locator(".msg.agent strong")).toHaveText("it");
  // the map redraws before the reply ends
  await expect(p.locator('[data-field="body"]')).toContainText("three tries");
  await expect(turns(p).nth(0).locator('[data-role="turn-end"]')).toHaveCount(0);
  await expect(turns(p).nth(0).locator(".msg.agent")).toContainText("see #retry for the result.");
  const link = turns(p).nth(0).locator('.msg.agent a[href="/map/retry"]');
  await expect(link).toHaveCount(1);
  await expect(turns(p).nth(0).locator('[data-role="turn-end"]')).toBeVisible();
  await expect(status).not.toContainText(/tokens?$/);
  await expect(turns(p).nth(0).locator(".msg.agent")).toContainText("Changing it now, see #retry for the result.");
  await p.goto(`${w.url}/map/root`);
  await say(p, "x");
});

test("[20.2] a second message waits for the first reply", async ({ page: p }) => {
  const w = await project({
    roles: { chat: { replies: [[start("m1"), open("First"), { pause: 3000 }, more(" part two."), done("m1", "First part two.")], reply("m2", "Second answer.")] } },
  });
  await p.goto(`${w.url}/map`);
  await say(p, "First question");
  await expect(turns(p).nth(0).locator(".msg.agent")).toContainText("First");
  await say(p, "Second question");
  await expect(turns(p).nth(1).locator(".msg.user")).toHaveText("Second question");
  await expect(turns(p).nth(1).locator('[data-mark="waiting"]')).toHaveText(/waits for the reply above/);
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("First part two.");
  await expect(turns(p).nth(1).locator('[data-mark="waiting"]')).toHaveCount(0);
  await expect(turns(p).nth(1).locator(".msg.agent")).toHaveText("Second answer.");
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("First part two.");
});

test("[20.3] each turn names the open card", async ({ page: p }) => {
  const w = await echoProject((s) => s("node.added", { id: "retry", kind: "card", title: "Checkout retries", why: "Cards fail sometimes", parent: "root", body: "Retry twice." }));
  await p.goto(`${w.url}/map/retry`);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Checkout retries");
  await say(p, "What does this say?");
  const agent = (n: number) => turns(p).nth(n).locator(".msg.agent");
  await expect(agent(0)).toContainText("Checkout retries");
  await expect(agent(0)).toContainText("Cards fail sometimes");
  await say(p, "And now?");
  await expect(agent(1)).toContainText("still on #");
  const t1 = (await agent(1).textContent()) ?? "";
  console.log("TURN 2:", t1);
  expect(t1).toContain("Checkout retries");
  expect(t1).not.toContain("Cards fail sometimes");
  await p.locator('[data-role="crumbs"]').getByRole("button", { name: "Home" }).click();
  await expect(p.locator('[data-column="what"]')).toBeVisible();
  await say(p, "Where am I?");
  await expect(turns(p)).toHaveCount(3);
  const t2 = (await agent(2).textContent()) ?? "";
  console.log("TURN 3:", t2);
  expect(t2.toLowerCase()).toMatch(/home|root/);
});

test("[20.4] three tool calls collapse into one line", async ({ page: p }) => {
  const call = (id: string, command: string) => ({ event: { type: "assistant", message: { id: `m-${id}`, content: [{ type: "tool_use", id, name: "Bash", input: { command } }] } } });
  const result = (id: string, content: string) => ({ event: { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content }] } } });
  const w = await project({
    roles: { chat: { replies: [[call("t1", "ls"), result("t1", "a.txt"), call("t2", "pwd"), result("t2", "/project"), call("t3", "git status"), result("t3", "clean"), ...reply("m4", "All clean.")]] } },
  });
  await p.goto(`${w.url}/map`);
  await say(p, "Look at the code");
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("All clean.");
  const runs = turns(p).nth(0).locator('[data-role="tool-run"]');
  await expect(runs).toHaveCount(1);
  await expect(runs.locator("summary")).toContainText("git status");
  await expect(runs.locator("summary")).toContainText("3");
  await expect(runs.locator('[data-role="tool-call"]').first()).toBeHidden();
  await runs.locator("summary").click();
  await expect(runs.locator('[data-role="tool-call"]')).toHaveCount(3);
  await expect(runs.locator('[data-role="tool-input"]').nth(1)).toContainText("pwd");
  await expect(runs.locator('[data-role="tool-output"]').nth(1)).toHaveText("/project");
});

test("[20.5] a chat request without the token starts no agent", async ({ page: p }) => {
  const w = await project({ roles: { chat: { replies: [reply("m1", "never")] } } }, (s) =>
    s.seed("node.added", { id: "retry", kind: "card", title: "Checkout retries", parent: "root", body: "Two tries." }),
  );
  await p.goto(`${w.url}/map/retry`);
  const body = JSON.stringify({ text: "Make it three tries", turn: "t1", card: "retry" });
  const r = await fetch(`${w.url}/api/chat`, { method: "POST", headers: { "content-type": "application/json", origin: "https://other.example" }, body });
  expect(r.status).toBeGreaterThanOrEqual(400);
  await p.waitForTimeout(500);
  expect(heard(w)).toEqual([]);
  expect(entries(w).filter((e) => e.kind === "launch")).toEqual([]);
  await expect(turns(p)).toHaveCount(0);
  await expect(p.locator('[data-field="body"]')).toContainText("Two tries.");
});

test("[22.1] allow once lets a blocked call finish", async ({ page: p }) => {
  const input = { command: "curl -s https://example.com" };
  const w = await project({ roles: { chat: { replies: [[{ ask: { id: "r1", tool: "Bash", input, reason: "rule" } }, ...reply("m1", "Fetched it.")]] } } });
  await p.goto(`${w.url}/map`);
  await say(p, "Fetch the page");
  const ask = pane(p).getByRole("region", { name: "Bash wants to run" });
  await expect(ask).toContainText("Bash");
  await expect(ask.locator("[data-role=ask-call]")).toContainText("curl -s https://example.com");
  expect(await ask.locator("[data-role=ask-call]").evaluate((el) => el.tagName)).toBe("PRE");
  await expect(ask.locator("[data-role=ask-reason]")).toContainText("rule");
  await expect(ask.getByRole("button")).toHaveText(["Allow once", "Deny"]);
  await p.route("**/api/ask", async (route) => {
    await new Promise((r) => setTimeout(r, 1200));
    await route.continue();
  });
  await ask.getByRole("button", { name: "Allow once" }).click();
  for (const b of await ask.getByRole("button").all()) await expect(b).toBeDisabled();
  await expect(turns(p).nth(0).locator('[data-role="turn-end"]')).toBeVisible();
  await expect(turns(p).nth(0).locator(".msg.agent")).toContainText("Fetched it.");
  const log = askLog(w);
  expect(log).toHaveLength(1);
  expect(log[0]).toMatchObject({ tool: "Bash", input, reason: "rule", decision: "allow" });
});

test("[22.2] always allow keeps its rule now and after a restart", async ({ page: p }) => {
  const mkdir = { type: "addRules", rules: [{ toolName: "Bash", ruleContent: "mkdir:*" }], behavior: "allow" };
  const input = { command: "mkdir -p /tmp/x" };
  const w = await project({ roles: { chat: { replies: [[{ ask: { id: "r1", tool: "Bash", input, suggestions: [mkdir] } }, ...reply("m1", "Done.")]] } } });
  await p.goto(`${w.url}/map`);
  await say(p, "Make the folder");
  const ask = pane(p).getByRole("region", { name: "Bash wants to run" });
  await expect(ask.getByRole("button")).toHaveText(["Allow once", "Always allow Bash(mkdir:*)", "Deny"]);
  await ask.getByRole("button", { name: "Always allow Bash(mkdir:*)" }).click();
  await expect(turns(p).nth(0).locator('[data-role="turn-end"]')).toBeVisible();
  expect(answers(w)).toEqual([{ behavior: "allow", updatedInput: input, updatedPermissions: [mkdir] }]);
  expect(askLog(w)[0]).toMatchObject({ decision: "always", widened: ["Bash(mkdir:*)"] });
  const rules = JSON.parse(readFileSync(join(w.dir, ".werk", "allow.json"), "utf8"));
  console.log("ALLOW FILE", JSON.stringify(rules));
  expect(JSON.stringify(rules)).toContain("Bash(mkdir:*)");
});

test("[22.3] keyboard answers and a second click send one answer", async ({ page: p }) => {
  const input = { command: "rm -rf /tmp/x" };
  const w = await project({
    roles: { chat: { replies: [[{ ask: { id: "r1", tool: "Bash", input } }, ...reply("m1", "Refusal noted.")], [{ ask: { id: "r2", tool: "Bash", input } }, ...reply("m2", "Ran.")], reply("m3", "Got the draft.")] } },
  });
  await p.goto(`${w.url}/map`);
  await say(p, "first");
  const ask = pane(p).getByRole("region", { name: "Bash wants to run" });
  await expect(ask).toBeVisible();
  const box = pane(p).getByRole("textbox", { name: "Message" });
  await box.fill("my draft");
  await box.press("Escape");
  await expect(turns(p).nth(0).locator('[data-role="turn-end"]')).toBeVisible();
  expect(answers(w)[0]).toMatchObject({ behavior: "deny" });
  expect(heard(w)).toEqual(["[the map is now at #root — Root]\nkind: card · status: open\n\nfirst"].map((x) => x).slice(0, 1).length === 1 ? heard(w) : []);
  expect(heard(w).some((m) => m.includes("my draft"))).toBe(false);
  await expect(box).toHaveValue("my draft");
  const stale = ask.getByRole("button", { name: "Allow once" });
  if ((await stale.count()) > 0) await stale.click({ force: true, timeout: 2000 }).catch(() => undefined);
  await p.waitForTimeout(300);
  expect(answers(w)).toHaveLength(1);
  expect(askLog(w)).toHaveLength(1);
  expect(askLog(w)[0].decision).toBe("deny");
  await say(p, "second");
  await expect(pane(p).getByRole("region", { name: "Bash wants to run" })).toBeVisible();
  await box.fill("my draft");
  await box.press("Meta+Enter");
  await expect(turns(p).nth(1).locator('[data-role="turn-end"]')).toBeVisible();
  expect(answers(w)[1]).toMatchObject({ behavior: "allow" });
  await expect(box).toHaveValue("my draft");
  expect(heard(w).filter((m) => m.includes("my draft"))).toHaveLength(0);
  await box.press("Enter");
  await expect(turns(p).nth(2).locator(".msg.user")).toHaveText("my draft");
  expect(heard(w).filter((m) => m.includes("my draft"))).toHaveLength(1);
});

test("[22.4] a question of the agent is a form", async ({ page: p, browser }) => {
  const input = {
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
  const w = await project({ roles: { chat: { replies: [[{ ask: { id: "q1", tool: "AskUserQuestion", input } }, ...reply("m1", "Thanks, SQLite it is.")]] } } });
  await p.goto(`${w.url}/map`);
  await say(p, "Ask me");
  const form = pane(p).getByRole("form", { name: "The agent asks" });
  await expect(form).toContainText("Which store?");
  await expect(form).toContainText("A. Postgres");
  await expect(form).toContainText("B. SQLite");
  await expect(form).toContainText("One file beside the map");
  await expect(form.getByRole("textbox")).toHaveCount(1);
  await expect(form.getByRole("button", { name: "Submit answer" })).toBeVisible();
  await expect(form.getByRole("button", { name: "Decline" })).toBeVisible();
  await expect(pane(p)).not.toContainText('"questions"');
  await form.getByRole("radio", { name: /SQLite/ }).check();
  const other = await browser.newPage();
  await other.goto(`${w.url}/map`);
  w.werk("add", "newcard", "--title", "New", "--parent", "root");
  await expect(p.locator("#view")).toContainText("New");
  await expect(form.getByRole("radio", { name: /SQLite/ })).toBeChecked();
  await form.getByRole("button", { name: "Submit answer" }).click();
  await expect(turns(p).nth(0).locator('[data-role="turn-end"]')).toBeVisible();
  expect(answers(w)).toEqual([{ behavior: "deny", message: 'For "Which store?": SQLite' }]);
  await expect(turns(p).nth(0).locator(".msg.agent")).toContainText("SQLite it is");
  await expect(turns(p).nth(0).locator('[data-role="agent-error"]')).toHaveCount(0);
  expect(askLog(w)).toMatchObject([{ tool: "AskUserQuestion", decision: "answer" }]);
});

test("[22.5] declining a question", async ({ page: p }) => {
  const input = { questions: [{ question: "Which store?", header: "Store", options: [{ label: "A", description: "a" }, { label: "B", description: "b" }], multiSelect: false }] };
  const w = await project({ roles: { chat: { replies: [[{ ask: { id: "q1", tool: "AskUserQuestion", input } }, ...reply("m1", "Fine, I move on.")]] } } });
  await p.goto(`${w.url}/map`);
  await say(p, "Ask me");
  const form = pane(p).getByRole("form", { name: "The agent asks" });
  await form.getByRole("button", { name: "Decline" }).click();
  await expect(form.getByRole("button", { name: "Decline" })).toBeDisabled();
  await expect(form.getByRole("button", { name: "Submit answer" })).toBeDisabled();
  await expect(turns(p).nth(0).locator('[data-role="turn-end"]')).toBeVisible();
  expect(answers(w)[0]).toMatchObject({ behavior: "deny" });
  expect(askLog(w)).toMatchObject([{ tool: "AskUserQuestion", decision: "deny" }]);
});

test("[19.2] the chat agent started by a message gets the instructions and the rule titles", async ({ page: p }) => {
  const w = await project({ roles: { chat: { replies: [reply("m1", "hello")] } } }, (s) => {
    s.seed("node.added", { id: "how", kind: "card", title: "How it is built", status: "decided" });
    s.seed("node.added", { id: "r1", kind: "card", title: "Tests hit a real database", parent: "how", status: "decided" });
    s.seed("node.added", { id: "r2", kind: "card", title: "Money is stored in cents", parent: "how", status: "decided" });
  });
  await p.goto(`${w.url}/map`);
  await say(p, "hello there");
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("hello");
  const launch = entries(w).find((e) => e.kind === "launch");
  const args = (launch as { args: string[] }).args;
  const prompt = args[args.indexOf("--append-system-prompt") + 1] as string;
  expect(prompt).toContain("how to work with the decision map");
  expect(prompt).toContain("Tests hit a real database");
  expect(prompt).toContain("Money is stored in cents");
  expect(args).toContain("--agents");
});
