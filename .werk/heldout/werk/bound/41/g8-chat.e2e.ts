import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { project, stop, type Werk } from "../e2e/project.ts";
import { LAUNCHES_FILE, type LaunchEntry } from "../src/test/fake-script.ts";

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
async function type(p: Page, words: string) {
  await pane(p).getByRole("textbox", { name: "Message" }).fill(words);
}
async function say(p: Page, words: string) {
  await type(p, words);
  await pane(p).getByRole("button", { name: "Send" }).click();
}
function launchesOf(w: Werk) {
  const file = join(w.dir, "..", "fake", LAUNCHES_FILE);
  if (!existsSync(file)) return [] as { pid: number; args: string[]; messages: string[] }[];
  const out: { pid: number; args: string[]; messages: string[] }[] = [];
  for (const line of readFileSync(file, "utf8").split("\n").filter(Boolean)) {
    const e = JSON.parse(line) as LaunchEntry;
    if (e.kind === "launch") out.push({ pid: e.pid, args: e.args, messages: [] });
    else if (e.kind === "message")
      out
        .find((x) => x.pid === e.pid)
        ?.messages.push((e.message as { message: { content: { text: string }[] } }).message.content[0]?.text ?? "");
  }
  return out;
}
const heard = (w: Werk) => launchesOf(w).map((l) => l.messages);
const card =
  (id: string, title: string, why = "w") =>
  (s: Omit<Werk, "url">) =>
    s.seed("node.added", { id, kind: "card", title, why, parent: "root" });

test("73.1 message from the open card streams its reply back", async ({ page: p }) => {
  const w = await project(
    {
      roles: {
        chat: {
          replies: [
            [
              start("m1"),
              open("Part one."),
              { pause: 1500 },
              more(" Part **two** names #werk-wording."),
              { pause: 1500 },
              more(" Part three."),
              done("m1", "Part one. Part **two** names #werk-wording. Part three."),
            ],
          ],
        },
      },
    },
    (s) => {
      card("werk-chat", "The composer sends a live agent turn")(s);
      card("werk-wording", "Wording card")(s);
    },
  );
  const requests: { url: string; body: string }[] = [];
  p.on("request", (r) => {
    if (r.url().includes("/api/chat") && r.method() === "POST")
      requests.push({ url: r.url(), body: r.postData() ?? "" });
  });
  await p.goto(`${w.url}/map/werk-chat`);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("The composer sends a live agent turn");
  // Given the conversation tab "design" is the active tab
  await expect
    .soft(p.getByRole("tab", { name: "design" }), "conversation tab 'design' exists")
    .toBeVisible({ timeout: 2000 });
  await type(p, "What does this card decide?");
  await pane(p).getByRole("textbox", { name: "Message" }).press("Enter");
  await expect(pane(p).getByRole("textbox", { name: "Message" })).toHaveValue("");
  await expect.poll(() => requests.length).toBe(1);
  const body = JSON.parse(requests[0]?.body ?? "{}");
  expect(body.text).toBe("What does this card decide?");
  expect(body.card).toBe("werk-chat");
  expect.soft(body.tab, `request body was ${JSON.stringify(body)}`).toBe("design");
  const agent = turns(p).nth(0).locator(".msg.agent");
  await expect(agent).toContainText("Part one.");
  await expect(agent).not.toContainText("Part three.");
  await expect(turns(p).nth(0).locator('[data-role="turn-end"]')).toHaveCount(0);
  await expect(agent).toContainText("Part three.", { timeout: 8000 });
  await expect(agent.locator("strong")).toHaveText("two");
  const link = agent.getByRole("link", { name: /werk-wording/ });
  await expect(link).toHaveCount(1);
  await link.click();
  await expect(p).toHaveURL(/\/map\/werk-wording$/);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Wording card");
});

test("73.2 pasted image travels with the message", async ({ page: p }) => {
  const w = await project(
    { roles: { chat: { replies: [reply("m1", "Yes, it matches.")] } } },
    card("visual", "Visual"),
  );
  const requests: string[] = [];
  p.on("request", (r) => {
    if (r.url().includes("/api/chat") && r.method() === "POST") requests.push(r.postData() ?? "");
  });
  await p.goto(`${w.url}/map/visual`);
  const box = pane(p).getByRole("textbox", { name: "Message" });
  await box.focus();
  await box.evaluate((el) => {
    const bytes = Uint8Array.from(
      atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=="),
      (c) => c.charCodeAt(0),
    );
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], "shot.png", { type: "image/png" }));
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await box.pressSequentially("Does this layout match the card?");
  await box.press("Enter");
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("Yes, it matches.");
  expect(requests).toHaveLength(1);
  const body = JSON.parse(requests[0] ?? "{}");
  expect(body.text).toBe("Does this layout match the card?");
  expect(body.card).toBe("visual");
  expect
    .soft(Object.keys(body), `request keys: ${Object.keys(body)}; body length ${requests[0]?.length}`)
    .toContain("image");
  expect.soft(Object.keys(body)).toContain("tab");
  expect.soft(JSON.stringify(heard(w)), "agent message holds an image block").toContain("image");
});

test("73.3 each turn starts with the card the person looks at now", async ({ page: p }) => {
  const w = await project({ roles: { chat: { replies: [reply("m1", "one"), reply("m2", "two")] } } }, (s) => {
    card("pr-log", "PR log")(s);
    card("vi-prop-trace", "Prop trace")(s);
  });
  await p.goto(`${w.url}/map`);
  await p.locator('a[data-tile="pr-log"]').click();
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("PR log");
  await say(p, "Explain the fold");
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("one");
  await p.goBack();
  await p.locator('a[data-tile="vi-prop-trace"]').click();
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Prop trace");
  await say(p, "And this one?");
  await expect(turns(p).nth(1).locator(".msg.agent")).toHaveText("two");
  const [m] = heard(w);
  const first = m?.[0] ?? "";
  const second = m?.[1] ?? "";
  console.log("FIRST", JSON.stringify(first));
  console.log("SECOND", JSON.stringify(second));
  expect(first.split("\n")[0]).toContain("#pr-log");
  expect(second.split("\n")[0]).toContain("#vi-prop-trace");
  expect(second.split("\n")[0]).not.toContain("#pr-log");
  await expect(turns(p).locator(".msg.user")).toHaveText(["Explain the fold", "And this one?"]);
});

test("73.4 each conversation tab speaks to its own agent", async ({ page: p }) => {
  const w = await project(
    { roles: { chat: { replies: [reply("m1", "r1"), reply("m2", "r2")] } } },
    card("werk-cli", "CLI"),
  );
  await p.goto(`${w.url}/map/werk-cli`);
  await expect.soft(p.getByRole("tab", { name: "alpha" }), "tab alpha").toBeVisible({ timeout: 2000 });
  await expect.soft(p.getByRole("tab", { name: "beta" }), "tab beta").toBeVisible({ timeout: 2000 });
  await say(p, "First question");
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("r1");
  await say(p, "Second question");
  await expect(turns(p).nth(1).locator(".msg.agent")).toHaveText("r2");
  const ls = launchesOf(w);
  expect.soft(ls.length, `launches: ${ls.length} (one agent per tab expected: 2)`).toBe(2);
  const prompt = ls.map((l) => l.args.join(" ")).join("\n");
  expect.soft(prompt.includes("Write a card about its subject"), "prompt: card about its subject").toBe(true);
  expect.soft(prompt.includes("No session story"), "prompt: no session story").toBe(true);
  expect.soft(prompt.includes("Do not name source files, functions"), "prompt: no file, function, line").toBe(true);
});

test("73.5 note route", async ({ page: p }) => {
  const w = await project(undefined, card("werk-chat", "The composer sends a live agent turn"));
  const log = join(w.dir, ".werk", "log.jsonl");
  const count = () => readFileSync(log, "utf8").split("\n").filter(Boolean).length;
  const reqs: string[] = [];
  p.on("request", (r) => {
    if (r.url().includes("/api/notes")) reqs.push(r.url());
  });
  await p.goto(`${w.url}/map`);
  const token = (await p.locator('meta[name="werk-token"]').getAttribute("content")) ?? "";
  const before = count();
  expect(await pane(p).getByRole("textbox", { name: "Message" }).inputValue()).toBe("");
  const res = await fetch(`${w.url}/api/notes`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-werk-token": token },
    body: JSON.stringify({ id: "werk-chat", text: "check the stdin path" }),
  });
  expect(res.status).toBe(200);
  const lines = readFileSync(log, "utf8")
    .split("\n")
    .filter(Boolean)
    .slice(before)
    .map((l) => JSON.parse(l));
  expect(lines).toHaveLength(1);
  expect(lines[0].type).toBe("note.added");
  expect(lines[0].payload.id).toBe("werk-chat");
  const clip = `re #werk-chat "The composer sends a live agent turn": check the stdin path`;
  await p.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  const text = await p.evaluate(() => navigator.clipboard.readText().catch((e) => `ERR ${e}`));
  expect.soft(text, "clipboard line").toBe(clip);
  await p.goto(`${w.url}/map/werk-chat`);
  await expect(
    p.locator('[data-section="thread"] [data-entry="note"]').filter({ hasText: "check the stdin path" }),
  ).toHaveCount(1);
  expect(reqs).toEqual([]);
});

// ---- 20.x
const logLine = (seq: number, type: string, payload: object) =>
  JSON.stringify({ seq, at: "t", actor: seq === 1 ? "you" : "agent", type, payload });

test("20.1 message streams and the map shows the card the agent writes", async ({ page: p }) => {
  const rewritten = [
    logLine(1, "node.added", { id: "root", kind: "card", title: "Root" }),
    logLine(2, "node.added", {
      id: "retry",
      kind: "card",
      title: "Checkout retries",
      why: "It says three tries",
      parent: "root",
    }),
  ];
  const w = await project(
    {
      roles: {
        chat: {
          replies: [
            [
              start("m1"),
              open("Making it three, see #retry."),
              { pause: 800 },
              { edit: { path: ".werk/log.jsonl", content: `${rewritten.join("\n")}\n` } },
              { pause: 3000 },
              done("m1", "Making it three, see #retry. Done."),
            ],
          ],
        },
      },
    },
    card("retry", "Checkout retries", "Two tries"),
  );
  await p.goto(`${w.url}/map/retry`);
  await expect(p.locator("article")).not.toContainText("three tries");
  await say(p, "Make it three tries");
  await expect(turns(p).nth(0).locator(".msg.user")).toHaveText("Make it three tries");
  await expect(turns(p).nth(0).locator(".msg.agent")).toContainText("Making it three");
  const header = pane(p).locator('[data-role="chat-header"]');
  await expect(header).toContainText(/\d+s/);
  await expect(header).toContainText(/\d+ tokens?/);
  await expect(turns(p).nth(0).locator('a[href="/map/retry"]')).toHaveCount(1);
  await expect(p.locator("article")).toContainText("three tries");
  await expect(turns(p).nth(0).locator('[data-role="turn-end"]')).toHaveCount(0);
  await expect(turns(p).nth(0).locator(".msg.agent")).toContainText("Done.");
  await expect(turns(p).nth(0).locator('[data-role="turn-end"]')).toBeVisible();
  await expect(header).not.toContainText(/tokens/);
});

test("20.2 second message waits", async ({ page: p }) => {
  const w = await project({
    roles: {
      chat: {
        replies: [
          [start("m1"), open("First"), { pause: 2500 }, more(" reply."), done("m1", "First reply.")],
          reply("m2", "Second reply."),
        ],
      },
    },
  });
  await p.goto(`${w.url}/map`);
  await say(p, "First question");
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("First");
  await say(p, "Second question");
  await expect(turns(p).nth(1).locator(".msg.user")).toHaveText("Second question");
  await expect(turns(p).nth(1).locator('[data-mark="waiting"]')).toHaveText(/waits for the reply above/);
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("First reply.");
  await expect(turns(p).nth(1).locator('[data-mark="waiting"]')).toHaveCount(0);
  await expect(turns(p).nth(1).locator(".msg.agent")).toHaveText("Second reply.");
});

test("20.3 each turn names the open card", async ({ page: p }) => {
  const w = await project(
    { roles: { chat: { replies: [reply("m1", "a"), reply("m2", "b"), reply("m3", "c")] } } },
    card("retry", "Checkout retries", "Cards fail"),
  );
  await p.goto(`${w.url}/map/retry`);
  await say(p, "What does this say?");
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("a");
  await say(p, "And now?");
  await expect(turns(p).nth(1).locator(".msg.agent")).toHaveText("b");
  await p.goto(`${w.url}/map`);
  await say(p, "Where am I?");
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("c");
  const [m] = heard(w);
  console.log("MSGS", JSON.stringify(m));
  // The fake agent cannot echo what it receives; the check is on what it received.
  expect(m?.[0]).toContain("[the map is now at #retry — Checkout retries]");
  expect(m?.[0]).toContain("why: Cards fail");
  expect(m?.[1]).toBe("[still on #retry — Checkout retries]\n\nAnd now?");
  expect(m?.[2]).toMatch(/^\[the map is now at #root — Root\]/);
});

test("20.4 three tool calls collapse", async ({ page: p }) => {
  const call = (id: string, command: string) => ({
    event: {
      type: "assistant",
      message: { id: `m-${id}`, content: [{ type: "tool_use", id, name: "Bash", input: { command } }] },
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
            call("t1", "ls"),
            result("t1", "a"),
            call("t2", "pwd"),
            result("t2", "/p"),
            call("t3", "git status"),
            result("t3", "clean"),
            ...reply("m4", "Answer."),
          ],
        ],
      },
    },
  });
  await p.goto(`${w.url}/map`);
  await say(p, "Look at the code");
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("Answer.");
  const run = turns(p).nth(0).locator('[data-role="tool-run"]');
  await expect(run).toHaveCount(1);
  await expect(run.locator("summary")).toContainText("git status");
  await expect(run.locator("summary")).toContainText("3");
  await expect(run.locator('[data-role="tool-call"]').first()).toBeHidden();
  await run.locator("summary").click();
  await expect(run.locator('[data-role="tool-call"]')).toHaveCount(3);
  await expect(run.locator('[data-role="tool-input"]')).toHaveCount(3);
  await expect(run.locator('[data-role="tool-output"]')).toHaveText(["a", "/p", "clean"]);
});

test("20.5 chat request without token starts no agent", async ({ page: p }) => {
  const w = await project(
    { roles: { chat: { replies: [reply("m1", "never")] } } },
    card("retry", "Checkout retries", "Two tries"),
  );
  await p.goto(`${w.url}/map/retry`);
  const res = await fetch(`${w.url}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://evil.example" },
    body: JSON.stringify({ text: "Make it three tries", turn: "t1", card: "retry" }),
  });
  expect(res.status).toBe(403);
  await p.waitForTimeout(500);
  expect(launchesOf(w)).toEqual([]);
  await expect(turns(p)).toHaveCount(0);
  await p.goto(`${w.url}/map/retry`);
  await expect(p.locator("article")).toContainText("Two tries");
  expect(readFileSync(join(w.dir, ".werk", "log.jsonl"), "utf8")).not.toContain("three");
});
