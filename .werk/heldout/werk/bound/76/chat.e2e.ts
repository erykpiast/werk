import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { LAUNCHES_FILE, type LaunchEntry } from "../src/test/fake-script.ts";
import { project, stop, type Werk } from "../e2e/project.ts";

test.afterEach(stop);

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
function entries(w: Werk): LaunchEntry[] {
  const file = join(w.dir, "..", "fake", LAUNCHES_FILE);
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as LaunchEntry);
}
function heard(w: Werk): string[] {
  return entries(w).flatMap((e) =>
    e.kind === "message" ? [((e.message as { message: { content: { text: string }[] } }).message.content[0]?.text ?? "") as string] : [],
  );
}
const answers = (w: Werk) => entries(w).flatMap((e) => (e.kind === "answer" ? [e.answer] : []));
const askLog = (w: Werk) =>
  readFileSync(join(w.dir, ".werk", "asks.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);

test("20.1 a message streams a reply and the map shows the card the agent writes", async ({ page: p }) => {
  const line = (seq: number, type: string, payload: object, actor = "you") => JSON.stringify({ seq, at: "t", actor, type, payload });
  const log = [
    line(1, "node.added", { id: "root", kind: "card", title: "Root" }),
    line(2, "node.added", { id: "retry", kind: "card", title: "Checkout retries", parent: "root", body: "Two tries." }),
    line(3, "node.bodyEdited", { id: "retry", body: "Three tries." }, "agent"),
  ].join("\n");
  const w = await project(
    {
      roles: {
        chat: {
          replies: [
            [
              start("m1"),
              open("Making it three. "),
              { pause: 1500 },
              { edit: { path: ".werk/log.jsonl", content: `${log}\n` } },
              { pause: 2500 },
              more("See #root for **more**."),
              done("m1", "Making it three. See #root for **more**."),
            ],
          ],
        },
      },
    },
    (d) => d.seed("node.added", { id: "retry", kind: "card", title: "Checkout retries", parent: "root", body: "Two tries." }),
  );
  await p.goto(`${w.url}/map/retry`);
  await expect(p.locator('[data-field="body"]')).toHaveText("Two tries.");
  await say(p, "Make it three tries");
  await expect(turns(p).nth(0).locator(".msg.user")).toHaveText("Make it three tries");
  await expect(turns(p).nth(0).locator(".msg.agent")).toContainText("Making it three.");
  const head = pane(p).locator('[data-role="chat-header"] [role="status"]');
  await expect(head).toContainText(/\d+s/);
  await expect(head).toContainText(/tokens?/);
  await expect(p.locator('[data-field="body"]')).toHaveText("Three tries.");
  await expect(turns(p).nth(0).locator('[data-role="turn-end"]')).toHaveCount(0);
  await expect(turns(p).nth(0).locator(".msg.agent strong")).toHaveText("more");
  await expect(turns(p).nth(0).locator('.msg.agent a[href="/map/root"]')).toHaveText("#root");
  await expect(turns(p).nth(0).locator('[data-role="turn-end"]')).toBeVisible();
  await expect(head).not.toContainText(/tokens?/);
  await expect(turns(p).nth(0).locator(".msg.agent")).toContainText("See #root for more.");
  await turns(p).nth(0).locator('.msg.agent a[href="/map/root"]').click();
  await expect(p).toHaveURL(/\/map\/root$/);
});

test("20.2 a second message sent during a reply waits, and the first reply finishes above it", async ({ page: p }) => {
  const w = await project({
    roles: { chat: { replies: [[start("m1"), open("First part"), { pause: 2500 }, more(" and the rest."), done("m1", "First part and the rest.")], reply("m2", "Second answer")] } },
  });
  await p.goto(`${w.url}/map`);
  await say(p, "First question");
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("First part");
  await say(p, "Second question");
  await expect(turns(p).nth(1).locator(".msg.user")).toHaveText("Second question");
  await expect(turns(p).nth(1).locator('[data-mark="waiting"]')).toHaveText(/waits for the reply above/);
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("First part and the rest.");
  await expect(turns(p).nth(1).locator('[data-mark="waiting"]')).toHaveCount(0);
  await expect(turns(p).nth(1).locator(".msg.agent")).toHaveText("Second answer");
});

test("20.3 each turn names the card the person has open", async ({ page: p }) => {
  const w = await project({ roles: { chat: { replies: [reply("m1", "a"), reply("m2", "b"), reply("m3", "c")] } } }, (d) =>
    d.seed("node.added", { id: "retry", kind: "card", title: "Checkout retries", why: "Cards fail", parent: "root" }),
  );
  await p.goto(`${w.url}/map/retry`);
  await say(p, "What does this say?");
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("a");
  await say(p, "And now?");
  await expect(turns(p).nth(1).locator(".msg.agent")).toHaveText("b");
  await p.goto(`${w.url}/`);
  await say(p, "Where am I?");
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("c");
  const [first, second, third] = heard(w);
  expect(first).toContain("Checkout retries");
  expect(first).toContain("Cards fail");
  expect(second).toBe("[still on #retry — Checkout retries]\n\nAnd now?");
  expect(third).toMatch(/#root/);
  expect(third).toContain("Root");
});

test("20.4 a run of tool calls collapses into one line", async ({ page: p }) => {
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
  await runs.locator("summary").click();
  await expect(runs.locator('[data-role="tool-call"]')).toHaveCount(3);
  await expect(runs.locator('[data-role="tool-input"]').first()).toContainText("ls");
  await expect(runs.locator('[data-role="tool-output"]').nth(2)).toHaveText("clean");
});

test("20.5 a chat request without the token starts no agent", async ({ page: p }) => {
  const w = await project({ roles: { chat: { replies: [reply("m1", "never")] } } }, (d) =>
    d.seed("node.added", { id: "retry", kind: "card", title: "Checkout retries", body: "Two tries.", parent: "root" }),
  );
  await p.goto(`${w.url}/map`);
  const body = JSON.stringify({ text: "Make it three tries", turn: "t1", card: "retry" });
  const refused = await fetch(`${w.url}/api/chat`, { method: "POST", headers: { "content-type": "application/json", origin: "http://evil.example" }, body });
  expect(refused.status).toBe(403);
  await p.waitForTimeout(500);
  expect(heard(w)).toEqual([]);
  await expect(turns(p)).toHaveCount(0);
  expect(readFileSync(join(w.dir, ".werk", "log.jsonl"), "utf8")).not.toContain("bodyEdited");
  await p.goto(`${w.url}/map/retry`);
  await expect(p.locator('[data-field="body"]')).toHaveText("Two tries.");
});

// ---- 22 ----
const askBar = (p: Page, tool = "Bash") => pane(p).getByRole("region", { name: `${tool} wants to run` });

test("22.1 Allow once lets a blocked tool call finish its turn", async ({ page: p }) => {
  const input = { command: "curl -s https://example.com" };
  const w = await project({ roles: { chat: { replies: [[{ ask: { id: "r1", tool: "Bash", input, reason: "rule" } }, ...reply("m1", "Fetched it.")]] } } });
  await p.goto(`${w.url}/map`);
  await say(p, "Fetch the page");
  const ask = askBar(p);
  await expect(ask).toContainText("Bash");
  await expect(ask.locator("[data-role=ask-call]")).toContainText("curl -s https://example.com");
  await expect(ask.locator("[data-role=ask-reason]")).toContainText("rule");
  await expect(ask.getByRole("button")).toHaveText(["Allow once", "Deny"]);
  await ask.getByRole("button", { name: "Allow once" }).click();
  for (const b of await ask.getByRole("button").all()) await expect(b).toBeDisabled();
  await expect(turns(p).nth(0).locator('[data-role="turn-end"]')).toBeVisible();
  await expect(turns(p).nth(0).locator(".msg.agent")).toContainText("Fetched it.");
  expect(answers(w)).toEqual([{ behavior: "allow", updatedInput: input }]);
  expect(askLog(w)).toMatchObject([{ tool: "Bash", input, reason: "rule", decision: "allow" }]);
});

test("22.3 keyboard answers and a second click send only one answer", async ({ page: p }) => {
  const input = { command: "rm -rf /tmp/x" };
  const w = await project({
    roles: { chat: { replies: [[{ ask: { id: "r1", tool: "Bash", input } }], [{ ask: { id: "r2", tool: "Bash", input: { command: "ls" } } }]] } },
  });
  await p.goto(`${w.url}/map`);
  await say(p, "Clean up");
  const box = pane(p).getByRole("textbox", { name: "Message" });
  await expect(askBar(p)).toBeVisible();
  await box.fill("my draft");
  await box.press("Escape");
  await expect(turns(p).nth(0).locator('[data-role="turn-end"]')).toBeVisible();
  expect(answers(w)).toMatchObject([{ behavior: "deny" }]);
  await expect(box).toHaveValue("my draft");
  expect(heard(w).length).toBe(1);
  await askBar(p).getByRole("button", { name: "Allow once" }).click({ timeout: 1000 }).catch(() => undefined);
  expect(answers(w).length).toBe(1);
  expect(askLog(w).length).toBe(1);
  expect(askLog(w)[0]).toMatchObject({ decision: "deny" });
  // the draft is not sent by the keys; a second ask answered with Cmd+Enter
  await p.getByRole("textbox", { name: "Message" }).fill("");
  await say(p, "Again");
  await expect(askBar(p)).toBeVisible();
  await box.fill("still my draft");
  await box.press("Meta+Enter");
  await expect(turns(p).nth(1).locator('[data-role="turn-end"]')).toBeVisible();
  expect(answers(w)[1]).toMatchObject({ behavior: "allow" });
  await expect(box).toHaveValue("still my draft");
  expect(heard(w).length).toBe(2);
  await box.press("Enter");
  await expect(turns(p)).toHaveCount(3);
});

const questionInput = {
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
  const w = await project({ roles: { chat: { replies: [[{ ask: { id: "q1", tool: "AskUserQuestion", input: questionInput } }, ...reply("m1", "SQLite it is.")]] } } });
  await p.goto(`${w.url}/map`);
  await say(p, "Ask me");
  const form = pane(p).getByRole("form", { name: "The agent asks" });
  await expect(form).toContainText("Which store?");
  await expect(form).toContainText("One file beside the map");
  await expect(form).toContainText("One server for every reader");
  await expect(form.getByRole("textbox")).toHaveCount(1);
  await expect(form.getByRole("button", { name: "Submit answer" })).toBeVisible();
  await expect(form.getByRole("button", { name: "Decline" })).toBeVisible();
  await expect(pane(p)).not.toContainText('"questions"');
  await form.getByRole("radio", { name: /SQLite/ }).check();
  const other = await context.newPage();
  await other.goto(`${w.url}/map`);
  w.werk("add", "x", "--title", "Causes a redraw", "--parent", "root");
  await expect(p.locator('[data-tile="x"]')).toBeVisible();
  await expect(form.getByRole("radio", { name: /SQLite/ })).toBeChecked();
  await form.getByRole("button", { name: "Submit answer" }).click();
  await expect(turns(p).nth(0).locator('[data-role="turn-end"]')).toBeVisible();
  expect(answers(w)).toEqual([{ behavior: "deny", message: 'For "Which store?": SQLite' }]);
  await expect(turns(p).nth(0).locator(".msg.agent")).toContainText("SQLite it is.");
  expect(askLog(w)).toMatchObject([{ tool: "AskUserQuestion", decision: "answer" }]);
});

test("22.5 the user declines an agent's question", async ({ page: p }) => {
  const w = await project({ roles: { chat: { replies: [[{ ask: { id: "q1", tool: "AskUserQuestion", input: questionInput } }, ...reply("m1", "Fine, no answer.")]] } } });
  await p.goto(`${w.url}/map`);
  await say(p, "Ask me");
  const form = pane(p).getByRole("form", { name: "The agent asks" });
  await form.getByRole("button", { name: "Decline" }).click();
  for (const b of await form.getByRole("button").all()) await expect(b).toBeDisabled();
  await expect(turns(p).nth(0).locator('[data-role="turn-end"]')).toBeVisible();
  expect(answers(w)).toMatchObject([{ behavior: "deny" }]);
  expect(askLog(w)).toMatchObject([{ tool: "AskUserQuestion", decision: "deny" }]);
});

// ---- 73 ----
test("73.3 each turn starts with the card the person looks at now", async ({ page: p }) => {
  const w = await project({ roles: { chat: { replies: [reply("m1", "one"), reply("m2", "two")] } } }, (d) => {
    d.seed("node.added", { id: "pr-log", kind: "card", title: "The log", parent: "root" });
    d.seed("node.added", { id: "vi-prop-trace", kind: "card", title: "The trace", parent: "root" });
  });
  await p.goto(`${w.url}/map/pr-log`);
  await say(p, "Explain the fold");
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("one");
  // open the second card from the map, inside the same page, so the chat thread stays
  await p.getByRole("searchbox", { name: "Search the map" }).fill("#vi-prop-trace");
  await p.getByRole("searchbox", { name: "Search the map" }).press("Enter");
  await expect(p).toHaveURL(/vi-prop-trace/);
  await say(p, "And this one?");
  await expect(turns(p).nth(1).locator(".msg.agent")).toHaveText("two");
  const [a, b] = heard(w);
  expect(a?.split("\n")[0]).toContain("#pr-log");
  expect(b?.split("\n")[0]).toContain("#vi-prop-trace");
  expect(b?.split("\n")[0]).not.toContain("#pr-log");
});

test("73.5 a note sent to the note route by a client outside the browser lands on the thread", async ({ page: p }) => {
  const w = await project(undefined, (d) => d.seed("node.added", { id: "werk-chat", kind: "card", title: "The composer sends a live agent turn", parent: "root" }));
  const before = readFileSync(join(w.dir, ".werk", "log.jsonl"), "utf8").split("\n").filter(Boolean).length;
  const r = await fetch(`${w.url}/api/notes`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "werk-chat", text: "check the stdin path" }) });
  expect(r.status).toBe(200);
  const after = readFileSync(join(w.dir, ".werk", "log.jsonl"), "utf8").split("\n").filter(Boolean);
  expect(after.length).toBe(before + 1);
  await p.goto(`${w.url}/map/werk-chat`);
  await expect(p.locator('[data-section="thread"] [data-entry="note"]').filter({ hasText: "check the stdin path" })).toHaveCount(1);
});
