// Held-out steps 19.2 (chat part), 20.1-20.5 and 73.1-73.5: the chat pane with the fake agent.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { project, stop, type Werk } from "../../e2e/project.ts";
import { LAUNCHES_FILE, type LaunchEntry } from "../../src/test/fake-script.ts";

test.afterEach(stop);

const stream = (event: object) => ({ event: { type: "stream_event", event } });
const start = (id: string) => stream({ type: "message_start", message: { id } });
const open = (text: string) => stream({ type: "content_block_start", index: 0, content_block: { type: "text", text } });
const more = (text: string) => stream({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text } });
const done = (id: string, text: string) => ({
  event: { type: "assistant", message: { id, content: [{ type: "text", text }] } },
});
const reply = (id: string, text: string) => [start(id), open(text), done(id, text)];

const pane = (p: Page) => p.getByRole("complementary", { name: "Chat" });
const turns = (p: Page) => pane(p).locator("[data-turn]");
const box = (p: Page) => pane(p).getByRole("textbox", { name: "Message" });

type Rec = { pid: number; args: string[]; messages: unknown[] };
function launches(w: Werk): Rec[] {
  const file = join(w.dir, "..", "fake", LAUNCHES_FILE);
  if (!existsSync(file)) return [];
  const out: Rec[] = [];
  for (const line of readFileSync(file, "utf8").split("\n").filter(Boolean)) {
    const entry = JSON.parse(line) as LaunchEntry;
    if (entry.kind === "launch") out.push({ pid: entry.pid, args: entry.args, messages: [] });
    else out.find((each) => each.pid === entry.pid)?.messages.push(entry.message);
  }
  return out;
}
const textOf = (m: unknown) =>
  ((m as { message: { content: { type: string; text?: string }[] } }).message.content ?? [])
    .map((c) => c.text ?? "")
    .join("");

const card = (w: Pick<Werk, "seed">, id: string, fields: Record<string, unknown>) =>
  w.seed("node.added", { id, kind: "card", parent: "root", ...fields });

async function enter(p: Page, words: string): Promise<void> {
  await box(p).fill(words);
  await box(p).press("Enter");
}
async function sendButton(p: Page, words: string): Promise<void> {
  await box(p).fill(words);
  await pane(p).getByRole("button", { name: "Send" }).click();
}

test("19.2 chat: the chat agent's prompt holds the werk instructions and the build-rule titles", async ({
  page: p,
}) => {
  const w = await project({ roles: { chat: { replies: [reply("m1", "hello")] } } }, (s) => {
    card(s, "how", { title: "How we build", status: "decided" });
    card(s, "rule-a", { title: "Every test runs offline", parent: "how", status: "decided" });
  });
  await p.goto(`${w.url}/map`);
  await sendButton(p, "Hi");
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("hello");
  const chat = launches(w)[0];
  const prompt = chat?.args[chat.args.indexOf("--append-system-prompt") + 1] ?? "";
  expect(prompt).toContain("# werk — how to work with the decision map");
  expect(prompt).toContain("Every test runs offline");
});

const RETRY_LOG = (body: string) =>
  [
    { seq: 1, at: "t", actor: "you", type: "node.added", payload: { id: "root", kind: "card", title: "Root" } },
    {
      seq: 2,
      at: "t",
      actor: "you",
      type: "node.added",
      payload: { id: "retry", kind: "card", title: "Checkout retries", parent: "root", body },
    },
  ]
    .map((e) => JSON.stringify(e))
    .join("\n");

test("20.1 a message on the open card streams a reply and the map shows the card the agent writes", async ({
  page: p,
}) => {
  const w = await project(
    {
      roles: {
        chat: {
          replies: [
            [
              start("m1"),
              open("Setting **three** tries"),
              { pause: 1500 },
              more(" on #retry."),
              { edit: { path: ".werk/log.jsonl", content: `${RETRY_LOG("Checkout retries three tries.")}\n` } },
              { pause: 2500 },
              done("m1", "Setting **three** tries on #retry."),
            ],
          ],
        },
      },
    },
    (s) => card(s, "retry", { title: "Checkout retries", body: "Checkout retries two tries." }),
  );
  await p.goto(`${w.url}/map/retry`);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Checkout retries");
  await enter(p, "Make it three tries");
  await expect(turns(p).nth(0).locator(".msg.user")).toHaveText("Make it three tries", { timeout: 2000 });
  const agent = turns(p).nth(0).locator(".msg.agent");
  await expect(agent).toHaveText("Setting three tries");
  const status = pane(p).getByRole("status", { name: "Turn state" });
  await expect(status).toHaveText(/\d+s · \d+ tokens?/);
  await expect(p.getByText("Checkout retries three tries.")).toBeVisible();
  await expect(turns(p).nth(0).locator('[data-role="turn-end"]')).toHaveCount(0);
  await expect(agent).toHaveText("Setting three tries on #retry.");
  await expect(agent.locator("strong")).toHaveText("three");
  await expect(status).not.toHaveText(/tokens?/);
  await agent.locator('a[href="/map/retry"]').click();
  await expect(p).toHaveURL(/\/map\/retry$/);
});

test("20.2 a second message sent during a reply waits, and the first reply finishes above it", async ({ page: p }) => {
  const w = await project({
    roles: {
      chat: {
        replies: [
          [
            start("m1"),
            open("First part"),
            { pause: 3000 },
            more(" and the rest."),
            done("m1", "First part and the rest."),
          ],
          reply("m2", "Second answer."),
        ],
      },
    },
  });
  await p.goto(`${w.url}/map`);
  await enter(p, "First question");
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("First part");
  await enter(p, "Second question");
  await expect(turns(p).nth(1).locator(".msg.user")).toHaveText("Second question", { timeout: 2000 });
  await expect(turns(p).nth(1).locator('[data-mark="waiting"]')).toHaveText(/waits for the reply above/);
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("First part and the rest.");
  await expect(turns(p).nth(1).locator('[data-mark="waiting"]')).toHaveCount(0);
  await expect(turns(p).nth(1).locator(".msg.agent")).toHaveText("Second answer.");
});

test("20.3 each turn names the card the person has open", async ({ page: p }) => {
  const w = await project(
    { roles: { chat: { replies: [reply("m1", "a"), reply("m2", "b"), reply("m3", "c")] } } },
    (s) => card(s, "retry", { title: "Checkout retries", why: "Cards fail often" }),
  );
  await p.goto(`${w.url}/map/retry`);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Checkout retries");
  await sendButton(p, "What does this say?");
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("a");
  await sendButton(p, "And now?");
  await expect(turns(p).nth(1).locator(".msg.agent")).toHaveText("b");
  await p.goto(`${w.url}/map`);
  await sendButton(p, "Where am I?");
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("c");
  // The fake agent cannot echo; the messages it read stand in for what it repeats.
  const msgs = launches(w).flatMap((l) => l.messages.map(textOf));
  expect(msgs[0]).toContain("[the map is now at #retry — Checkout retries]");
  expect(msgs[0]).toContain("why: Cards fail often");
  expect(msgs[1]?.split("\n\n")[0]).toBe("[still on #retry — Checkout retries]");
  expect(msgs[2]).toContain("#root — Root");
});

test("20.4 a run of tool calls collapses into one line", async ({ page: p }) => {
  const call = (id: string, command: string) => ({
    event: {
      type: "assistant",
      message: { id: `m-${id}`, content: [{ type: "tool_use", id, name: "Read", input: { file_path: command } }] },
    },
  });
  const result = (id: string, content: string) => ({
    event: { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content }] } },
  });
  const w = await project({
    roles: {
      chat: {
        replies: [
          [
            call("t1", "a.ts"),
            result("t1", "out-a"),
            call("t2", "b.ts"),
            result("t2", "out-b"),
            call("t3", "c.ts"),
            result("t3", "out-c"),
            ...reply("m4", "The code is fine."),
          ],
        ],
      },
    },
  });
  await p.goto(`${w.url}/map`);
  await sendButton(p, "Look at the code");
  const t = turns(p).nth(0);
  await expect(t.locator(".msg.agent")).toHaveText("The code is fine.");
  const runs = t.locator('[data-role="tool-run"]');
  await expect(runs).toHaveCount(1);
  await expect(runs.locator("summary")).toContainText("c.ts");
  await expect(runs.locator("summary")).toContainText("3");
  await runs.locator("summary").click();
  await expect(runs.locator('[data-role="tool-call"]')).toHaveCount(3);
  await expect(runs.locator('[data-role="tool-input"]').nth(0)).toContainText("a.ts");
  await expect(runs.locator('[data-role="tool-output"]')).toHaveText(["out-a", "out-b", "out-c"]);
});

test("20.5 a chat request without the token starts no agent", async ({ page: p }) => {
  const w = await project({ roles: { chat: { replies: [reply("m1", "never")] } } }, (s) =>
    card(s, "retry", { title: "Checkout retries", body: "Checkout retries two tries." }),
  );
  await p.goto(`${w.url}/map/retry`);
  const res = await fetch(`${w.url}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://evil.example" },
    body: JSON.stringify({ text: "Make it three tries", turn: "t1", card: "retry" }),
  });
  expect(res.status).toBeGreaterThanOrEqual(400);
  await p.waitForTimeout(500);
  expect(launches(w)).toEqual([]);
  await expect(turns(p)).toHaveCount(0);
  expect(w.werk("show", "retry")).toContain("two tries");
});

test("73.1 a message sent from the open card streams its reply back into the pane", async ({ page: p }) => {
  const w = await project(
    {
      roles: {
        chat: {
          replies: [
            [
              start("m1"),
              open("It decides "),
              { pause: 1500 },
              more("the **live** turn, see "),
              { pause: 1500 },
              more("#werk-wording."),
              done("m1", "It decides the **live** turn, see #werk-wording."),
            ],
          ],
        },
      },
    },
    (s) => {
      card(s, "werk-chat", { title: "The composer sends a live agent turn" });
      card(s, "werk-wording", { title: "Wording" });
    },
  );
  const requests: string[] = [];
  p.on("request", (r) => {
    if (r.url().endsWith("/api/chat")) requests.push(r.postData() ?? "");
  });
  await p.goto(`${w.url}/map/werk-chat`);
  // Step: the conversation tab "design" is the active tab.
  await expect(pane(p).getByRole("tab", { name: "design" })).toHaveAttribute("aria-selected", "true", {
    timeout: 3000,
  });
  await enter(p, "What does this card decide?");
  await expect(box(p)).toHaveValue("");
  expect(requests).toHaveLength(1);
  const body = JSON.parse(requests[0] ?? "{}");
  expect(body).toMatchObject({ text: "What does this card decide?", card: "werk-chat", tab: "design" });
  const agent = turns(p).nth(0).locator(".msg.agent");
  await expect(agent).toHaveText("It decides");
  await expect(agent.locator("strong")).toHaveText("live");
  await expect(agent.locator('a.ref[href="/map/werk-wording"]')).toBeVisible();
  await agent.locator('a[href="/map/werk-wording"]').click();
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Wording");
});

test("73.2 a pasted image travels with the message in the same request", async ({ page: p }) => {
  const w = await project({ roles: { chat: { replies: [reply("m1", "Yes it matches.")] } } }, (s) =>
    card(s, "visual", { title: "Visual" }),
  );
  const requests: string[] = [];
  p.on("request", (r) => {
    if (r.url().endsWith("/api/chat")) requests.push(r.postData() ?? "");
  });
  await p.goto(`${w.url}/map/visual`);
  await box(p).focus();
  await p.evaluate(() => {
    const png = Uint8Array.from(
      atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="),
      (c) => c.charCodeAt(0),
    );
    const data = new DataTransfer();
    data.items.add(new File([png], "shot.png", { type: "image/png" }));
    const target = document.activeElement as HTMLElement;
    target.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await box(p).pressSequentially("Does this layout match the card?");
  await box(p).press("Enter");
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("Yes it matches.", { timeout: 3000 });
  expect(requests).toHaveLength(1);
  const body = JSON.parse(requests[0] ?? "{}");
  expect(body.text).toBe("Does this layout match the card?");
  expect(body.card).toBe("visual");
  expect(JSON.stringify(body)).toMatch(/image/);
  expect(body.tab).toBeDefined();
});

test("73.3 each turn starts with the card the person looks at now", async ({ page: p }) => {
  const w = await project({ roles: { chat: { replies: [reply("m1", "fold"), reply("m2", "trace")] } } }, (s) => {
    card(s, "pr-log", { title: "The log" });
    card(s, "vi-prop-trace", { title: "Trace", parent: "pr-log" });
  });
  await p.goto(`${w.url}/map/pr-log`);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("The log");
  await sendButton(p, "Explain the fold");
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("fold");
  // The person opens the card from the map: its tile on the open card.
  await p.locator('a[data-tile="vi-prop-trace"]').click();
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Trace");
  await sendButton(p, "And this one?");
  await expect(turns(p).locator(".msg.agent")).toHaveText(["fold", "trace"]);
  const msgs = launches(w).flatMap((l) => l.messages.map(textOf));
  // "starts with #id": the first line of the turn input names the open card.
  expect(msgs[0]?.split("\n")[0]).toContain("#pr-log");
  expect(msgs[1]?.split("\n")[0]).toContain("#vi-prop-trace");
  expect(msgs[1]?.split("\n")[0]).not.toContain("#pr-log");
});

test("73.4 each conversation tab speaks to its own agent", async ({ page: p }) => {
  const w = await project({ roles: { chat: { replies: [reply("m1", "A1"), reply("m2", "B1")] } } }, (s) =>
    card(s, "werk-cli", { title: "The CLI" }),
  );
  await p.goto(`${w.url}/map/werk-cli`);
  await expect(pane(p).getByRole("tab", { name: "alpha" })).toBeVisible({ timeout: 3000 });
  await pane(p).getByRole("tab", { name: "alpha" }).click();
  await sendButton(p, "First question");
  await pane(p).getByRole("tab", { name: "beta" }).click();
  await sendButton(p, "Second question");
  expect(launches(w)).toHaveLength(2);
});

test("73.5 a note sent to the note route appears in the card's thread", async ({ page: p, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const w = await project(undefined, (s) => card(s, "werk-chat", { title: "The composer sends a live agent turn" }));
  const logFile = join(w.dir, ".werk", "log.jsonl");
  const before = readFileSync(logFile, "utf8").split("\n").filter(Boolean).length;
  // The page carries the token; a client outside the browser reads it from the page head.
  const html = await (await fetch(`${w.url}/map`)).text();
  const token = /[0-9a-f]{48}/.exec(html)?.[0] ?? "";
  const res = await fetch(`${w.url}/api/notes`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-werk-token": token },
    body: JSON.stringify({ id: "werk-chat", text: "check the stdin path" }),
  });
  expect(res.status).toBe(200);
  const lines = readFileSync(logFile, "utf8").split("\n").filter(Boolean).slice(before);
  expect(lines).toHaveLength(1);
  const event = JSON.parse(lines[0] ?? "{}");
  expect(event.type).toBe("note.added");
  expect(event.payload.id).toBe("werk-chat");

  const noteRequests: string[] = [];
  p.on("request", (r) => {
    if (r.url().includes("/api/notes")) noteRequests.push(r.url());
  });
  await p.goto(`${w.url}/map/werk-chat`);
  await expect(p.getByText("check the stdin path", { exact: true })).toHaveCount(1);
  expect(noteRequests).toEqual([]);
  const clip = await p.evaluate(() => navigator.clipboard.readText());
  expect(clip).toBe('re #werk-chat "The composer sends a live agent turn": check the stdin path');
});

test("diag 20.1 (Send button) a message on the open card streams a reply and the map shows the card the agent writes", async ({
  page: p,
}) => {
  const w = await project(
    {
      roles: {
        chat: {
          replies: [
            [
              start("m1"),
              open("Setting **three** tries"),
              { pause: 1500 },
              more(" on #retry."),
              { edit: { path: ".werk/log.jsonl", content: `${RETRY_LOG("Checkout retries three tries.")}\n` } },
              { pause: 2500 },
              done("m1", "Setting **three** tries on #retry."),
            ],
          ],
        },
      },
    },
    (s) => card(s, "retry", { title: "Checkout retries", body: "Checkout retries two tries." }),
  );
  await p.goto(`${w.url}/map/retry`);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Checkout retries");
  await sendButton(p, "Make it three tries");
  await expect(turns(p).nth(0).locator(".msg.user")).toHaveText("Make it three tries", { timeout: 2000 });
  const agent = turns(p).nth(0).locator(".msg.agent");
  await expect(agent).toHaveText("Setting three tries");
  const status = pane(p).getByRole("status", { name: "Turn state" });
  await expect(status).toHaveText(/\d+s · \d+ tokens?/);
  await expect(p.getByText("Checkout retries three tries.")).toBeVisible();
  await expect(turns(p).nth(0).locator('[data-role="turn-end"]')).toHaveCount(0);
  await expect(agent).toHaveText("Setting three tries on #retry.");
  await expect(agent.locator("strong")).toHaveText("three");
  await expect(status).not.toHaveText(/tokens?/);
  await agent.locator('a[href="/map/retry"]').click();
  await expect(p).toHaveURL(/\/map\/retry$/);
});

test("diag 20.2 (Send button) a second message sent during a reply waits, and the first reply finishes above it", async ({ page: p }) => {
  const w = await project({
    roles: {
      chat: {
        replies: [
          [
            start("m1"),
            open("First part"),
            { pause: 3000 },
            more(" and the rest."),
            done("m1", "First part and the rest."),
          ],
          reply("m2", "Second answer."),
        ],
      },
    },
  });
  await p.goto(`${w.url}/map`);
  await sendButton(p, "First question");
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("First part");
  await sendButton(p, "Second question");
  await expect(turns(p).nth(1).locator(".msg.user")).toHaveText("Second question", { timeout: 2000 });
  await expect(turns(p).nth(1).locator('[data-mark="waiting"]')).toHaveText(/waits for the reply above/);
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("First part and the rest.");
  await expect(turns(p).nth(1).locator('[data-mark="waiting"]')).toHaveCount(0);
  await expect(turns(p).nth(1).locator(".msg.agent")).toHaveText("Second answer.");
});
