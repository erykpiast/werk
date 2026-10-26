// Held-out steps 20.x, 73.x and 19.2: the chat pane with the scripted fake agent.
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { project, stop, type Werk } from "../../e2e/project.ts";
import { LAUNCHES_FILE, type LaunchEntry } from "../../src/test/fake-script.ts";

test.afterEach(stop);

const stream = (event: object) => ({ event: { type: "stream_event", event } });
const start = (id: string) => stream({ type: "message_start", message: { id } });
const usage = (tokens: number) => stream({ type: "message_delta", delta: {}, usage: { output_tokens: tokens } });
const open = (text: string) => stream({ type: "content_block_start", index: 0, content_block: { type: "text", text } });
const more = (text: string) => stream({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text } });
const done = (id: string, text: string) => ({
  event: { type: "assistant", message: { id, content: [{ type: "text", text }] } },
});
const reply = (id: string, text: string) => [start(id), open(text), done(id, text)];

const pane = (p: Page) => p.getByRole("complementary", { name: "Chat" });
const turns = (p: Page) => pane(p).locator("[data-turn]");
const box = (p: Page) => pane(p).getByRole("textbox", { name: "Message" });

/** Types the words and presses Enter. When Enter sends nothing, records it and clicks Send so the rest runs. */
async function typeEnter(p: Page, words: string, index: number): Promise<boolean> {
  await box(p).fill(words);
  await box(p).press("Enter");
  let sent = true;
  try {
    await expect(turns(p).nth(index).locator(".msg.user")).toHaveCount(1, { timeout: 1500 });
  } catch {
    sent = false;
    await pane(p).getByRole("button", { name: "Send" }).click();
  }
  expect.soft(sent, `Enter sends "${words}"`).toBe(true);
  return sent;
}

async function say(p: Page, words: string): Promise<void> {
  await box(p).fill(words);
  await pane(p).getByRole("button", { name: "Send" }).click();
}

type Launch = { pid: number; args: string[]; role: string; messages: string[] };
function launches(w: Werk): Launch[] {
  const file = join(w.dir, "..", "fake", LAUNCHES_FILE);
  if (!existsSync(file)) return [];
  const out: Launch[] = [];
  for (const line of readFileSync(file, "utf8").split("\n").filter(Boolean)) {
    const entry = JSON.parse(line) as LaunchEntry;
    if (entry.kind === "launch") out.push({ pid: entry.pid, args: entry.args, role: entry.role, messages: [] });
    else {
      const m = entry.message as { message?: { content?: { text: string }[] } } | string;
      const text = typeof m === "string" ? m : (m.message?.content?.[0]?.text ?? "");
      out.find((each) => each.pid === entry.pid)?.messages.push(text);
    }
  }
  return out;
}
const heard = (w: Werk) => launches(w).map((each) => each.messages);
const promptOf = (l: Launch) => l.args[l.args.indexOf("--append-system-prompt") + 1] ?? "";

const logLines = (w: Werk) =>
  readFileSync(join(w.dir, ".werk", "log.jsonl"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { type: string; payload: Record<string, unknown> });

const line = (seq: number, type: string, payload: object) =>
  JSON.stringify({ seq, at: "t", actor: "you", type, payload });

test("20.1 a message on the open card streams a reply and the map shows the card the agent writes", async ({
  page: p,
}) => {
  const three = [
    line(1, "node.added", { id: "root", kind: "card", title: "Root" }),
    line(2, "node.added", {
      id: "checkout-retries",
      kind: "card",
      title: "Checkout retries",
      why: "Payments fail at times",
      body: "Checkout retries three tries.",
      parent: "root",
    }),
    line(3, "node.added", { id: "checkout-limits", kind: "card", title: "Checkout limits", parent: "root" }),
  ].join("\n");
  const full = "Setting **three** tries for #checkout-limits too.";
  const w = await project(
    {
      roles: {
        chat: {
          replies: [
            [
              start("m1"),
              usage(7),
              open("Setting **three** tries"),
              { pause: 3000 },
              more(" for #checkout-limits too."),
              { pause: 500 },
              { edit: { path: ".werk/log.jsonl", content: `${three}\n` } },
              { pause: 3000 },
              done("m1", full),
            ],
          ],
        },
      },
    },
    (s) => {
      s.seed("node.added", {
        id: "checkout-retries",
        kind: "card",
        title: "Checkout retries",
        why: "Payments fail at times",
        body: "Checkout retries two tries.",
        parent: "root",
      });
      s.seed("node.added", { id: "checkout-limits", kind: "card", title: "Checkout limits", parent: "root" });
    },
  );
  await p.goto(`${w.url}/map/checkout-retries`);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Checkout retries");
  await expect(p.locator("#view")).toContainText("Checkout retries two tries.");

  await typeEnter(p, "Make it three tries", 0);
  await expect(turns(p).nth(0).locator(".msg.user")).toHaveText("Make it three tries", { timeout: 1500 });
  // First part only, then the rest.
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("Setting three tries");
  await expect(pane(p).getByRole("status", { name: "Turn state" })).toHaveText(/writing · \d+s · 7 tokens/);
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("Setting three tries for #checkout-limits too.");
  await expect(turns(p).nth(0).locator(".msg.agent strong")).toHaveText("three");
  const link = turns(p).nth(0).locator('.msg.agent a.ref[href="/map/checkout-limits"]');
  await expect(link).toHaveText("#checkout-limits");

  // The agent writes the card: the map redraws before the turn ends.
  await expect(p.locator("#view")).toContainText("Checkout retries three tries.");
  await expect(turns(p).nth(0).locator('[data-role="turn-end"]')).toHaveCount(0);

  await expect(turns(p).nth(0).locator('[data-role="turn-end"]')).toBeVisible({ timeout: 10000 });
  const header = pane(p).getByRole("status", { name: "Turn state" });
  await expect(header).not.toHaveText(/writing|thinking|running|working/);
  await expect(header.locator(".animate-pulse")).toHaveCount(0);
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("Setting three tries for #checkout-limits too.");

  await link.click();
  await expect(p).toHaveURL(/\/map\/checkout-limits$/);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Checkout limits");
});

test("20.2 a second message waits, and the first reply finishes above it", async ({ page: p }) => {
  const w = await project({
    roles: {
      chat: {
        replies: [
          [
            start("m1"),
            open("First part"),
            { pause: 4000 },
            more(" and the rest."),
            done("m1", "First part and the rest."),
          ],
          reply("m2", "Second answer."),
        ],
      },
    },
  });
  await p.goto(`${w.url}/map`);
  await typeEnter(p, "First question", 0);
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("First part");

  await typeEnter(p, "Second question", 1);
  await expect(turns(p).nth(1).locator(".msg.user")).toHaveText("Second question", { timeout: 1500 });
  await expect(turns(p).nth(1).locator('[data-mark="waiting"]')).toHaveText(/waits for the reply above/);
  await expect(turns(p).nth(0).locator(".msg.user")).toHaveText("First question");
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("First part and the rest.");

  await expect(turns(p).nth(0).locator('[data-role="turn-end"]')).toBeVisible();
  await expect(turns(p).nth(1).locator('[data-mark="waiting"]')).toHaveCount(0);
  await expect(turns(p).nth(1).locator(".msg.agent")).toHaveText("Second answer.");
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("First part and the rest.");
});

test("20.3 each turn names the card the person has open", async ({ page: p }) => {
  const w = await project(
    { roles: { chat: { replies: [reply("m1", "one"), reply("m2", "two"), reply("m3", "three")] } } },
    (s) =>
      s.seed("node.added", {
        id: "checkout-retries",
        kind: "card",
        title: "Checkout retries",
        why: "Payments fail at times",
        body: "Retry a failed payment two times.",
        parent: "root",
      }),
  );
  await p.goto(`${w.url}/map/checkout-retries`);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Checkout retries");
  await say(p, "What does this say?");
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("one");
  await say(p, "And now?");
  await expect(turns(p).nth(1).locator(".msg.agent")).toHaveText("two");
  await p.getByRole("navigation", { name: "Breadcrumbs" }).getByRole("button", { name: "Home" }).first().click();
  await expect(p).not.toHaveURL(/checkout-retries/);
  await say(p, "Where am I?");
  await expect(turns(p).nth(2).locator(".msg.agent")).toHaveText("three");

  const [messages] = heard(w);
  const first = messages?.[0] ?? "";
  expect
    .soft(first, "first turn carries title and why")
    .toContain("[the map is now at #checkout-retries — Checkout retries]");
  expect.soft(first).toContain("why: Payments fail at times");
  expect
    .soft(first, "first turn carries the full text (body) of the card")
    .toContain("Retry a failed payment two times.");
  expect.soft(messages?.[1]).toBe("[still on #checkout-retries — Checkout retries]\n\nAnd now?");
  expect.soft(messages?.[2] ?? "").toMatch(/^\[the map is now at #root — Root\]/);
});

test("20.4 a run of tool calls collapses into one line", async ({ page: p }) => {
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
            call("t1", "ls src"),
            result("t1", "cli.ts"),
            call("t2", "cat package.json"),
            result("t2", "{}"),
            call("t3", "git log -1"),
            result("t3", "commit abc"),
            ...reply("m4", "The code is small."),
          ],
        ],
      },
    },
  });
  await p.goto(`${w.url}/map`);
  await say(p, "Look at the code");
  const t = turns(p).nth(0);
  await expect(t.locator(".msg.agent")).toHaveText("The code is small.");
  const runs = t.locator('[data-role="tool-run"]');
  await expect(runs).toHaveCount(1);
  await expect(runs.locator("summary")).toHaveText("Bash git log -1 · 3 calls");
  // The answer shows under the collapsed line.
  const order = await t.evaluate((el) => {
    const run = el.querySelector('[data-role="tool-run"]');
    const text = el.querySelector(".msg.agent");
    return (
      run !== null && text !== null && (run.compareDocumentPosition(text) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
    );
  });
  expect(order).toBe(true);
  await expect(runs.locator('[data-role="tool-call"]').first()).toBeHidden();
  await runs.locator("summary").click();
  await expect(runs.locator('[data-role="tool-call"]')).toHaveCount(3);
  await expect(runs.locator('[data-role="tool-input"]')).toHaveText([/ls src/, /cat package.json/, /git log -1/]);
  await expect(runs.locator('[data-role="tool-output"]')).toHaveText(["cli.ts", "{}", "commit abc"]);
});

test("20.5 a chat request without the token starts no agent", async ({ page: p }) => {
  const w = await project({ roles: { chat: { replies: [reply("m1", "Done, three tries.")] } } }, (s) =>
    s.seed("node.added", {
      id: "checkout-retries",
      kind: "card",
      title: "Checkout retries",
      body: "Checkout retries two tries.",
      parent: "root",
    }),
  );
  await p.goto(`${w.url}/map/checkout-retries`);
  await expect(p.locator("#view")).toContainText("Checkout retries two tries.");
  const refused = await fetch(`${w.url}/api/chat`, {
    method: "POST",
    headers: { "content-type": "text/plain", origin: "https://other.example" },
    body: JSON.stringify({ text: "Make it three tries", turn: "t1", card: "checkout-retries" }),
  });
  expect(refused.status).toBe(403);
  await expect(turns(p)).toHaveCount(0);
  expect(launches(w)).toEqual([]);
  await expect(p.locator("#view")).toContainText("Checkout retries two tries.");
  expect(logLines(w).some((each) => JSON.stringify(each.payload).includes("three"))).toBe(false);
});

test("73.1 a message from the open card streams its reply back into the pane", async ({ page: p }) => {
  const full = "This card decides **live** turns; see #werk-wording for the words.";
  const w = await project(
    {
      roles: {
        chat: {
          replies: [
            [
              start("m1"),
              open("This card decides **live** turns"),
              { pause: 2500 },
              more("; see #werk-wording"),
              { pause: 1500 },
              more(" for the words."),
              done("m1", full),
            ],
          ],
        },
      },
    },
    (s) => {
      s.seed("node.added", {
        id: "werk-chat",
        kind: "card",
        title: "The composer sends a live agent turn",
        parent: "root",
      });
      s.seed("node.added", {
        id: "werk-wording",
        kind: "card",
        title: "Wording",
        body: "Read #werk-chat first.",
        parent: "root",
      });
    },
  );
  const requests: string[] = [];
  p.on("request", (r) => {
    if (r.url().endsWith("/api/chat")) requests.push(r.postData() ?? "");
  });
  await p.goto(`${w.url}/map`);
  await p
    .getByRole("link", { name: /The composer sends a live agent turn/ })
    .first()
    .click();
  await expect(p).toHaveURL(/\/map\/werk-chat$/);
  const tab = pane(p).getByRole("tab", { name: "design" });
  const hasTab = (await tab.count()) > 0;
  expect.soft(hasTab, 'the chat pane has a conversation tab "design"').toBe(true);
  if (hasTab) await tab.click();

  await typeEnter(p, "What does this card decide?", 0);
  await expect.poll(() => requests.length).toBe(1);
  const body = JSON.parse(requests[0] ?? "{}") as Record<string, unknown>;
  expect.soft(String(body.text).trim()).toBe("What does this card decide?");
  expect.soft(body.card).toBe("werk-chat");
  expect.soft(JSON.stringify(body), 'the request names the tab "design"').toContain("design");
  await expect(box(p)).toHaveValue("");
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("This card decides live turns");
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText(
    "This card decides live turns; see #werk-wording for the words.",
  );
  await expect(turns(p).nth(0).locator(".msg.agent strong")).toHaveText("live");
  const link = turns(p).nth(0).locator(".msg.agent a.ref");
  await expect(link).toHaveAttribute("href", "/map/werk-wording");
  // Same form as a card link in a card body.
  await p.goto(`${w.url}/map/werk-wording`);
  const bodyLink = p.locator('#view a.ref[href="/map/werk-chat"]').first();
  const bodyShape = await bodyLink.evaluate((a) => `${a.tagName}.${a.className}>${a.firstElementChild?.tagName}`);
  await p.goto(`${w.url}/map/werk-chat`);
  // The reply is gone after the navigation unless the pane keeps it; read the shape before.
  expect(bodyShape).toBe("A.ref>CODE");
  expect.soft(requests.length).toBe(1);
});

test("73.1b the card link in the reply opens the card", async ({ page: p }) => {
  const w = await project({ roles: { chat: { replies: [reply("m1", "See #werk-wording.")] } } }, (s) => {
    s.seed("node.added", {
      id: "werk-chat",
      kind: "card",
      title: "The composer sends a live agent turn",
      parent: "root",
    });
    s.seed("node.added", { id: "werk-wording", kind: "card", title: "Wording", parent: "root" });
  });
  await p.goto(`${w.url}/map/werk-chat`);
  await say(p, "What does this card decide?");
  const link = turns(p).nth(0).locator(".msg.agent a.ref");
  const shape = await link.evaluate((a) => `${a.tagName}.${a.className}>${a.firstElementChild?.tagName}`);
  expect(shape).toBe("A.ref>CODE");
  await link.click();
  await expect(p).toHaveURL(/\/map\/werk-wording$/);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Wording");
});

test("73.2 a pasted image travels with the message in the same request", async ({ page: p }) => {
  const w = await project(
    {
      roles: {
        chat: { replies: [[start("m1"), open("It matches"), { pause: 1000 }, more("."), done("m1", "It matches.")]] },
      },
    },
    (s) => s.seed("node.added", { id: "visual", kind: "card", title: "Visual layout", parent: "root" }),
  );
  const requests: string[] = [];
  p.on("request", (r) => {
    if (r.url().endsWith("/api/chat")) requests.push(r.postData() ?? "");
  });
  await p.goto(`${w.url}/map/visual`);
  await box(p).click();
  // Paste a 1x1 PNG.
  await box(p).evaluate((el) => {
    const bytes = Uint8Array.from(
      atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=="),
      (c) => c.charCodeAt(0),
    );
    const data = new DataTransfer();
    data.items.add(new File([bytes], "layout.png", { type: "image/png" }));
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await box(p).pressSequentially("Does this layout match the card?");
  await typeEnter(p, "Does this layout match the card?", 0);
  await expect.poll(() => requests.length).toBeGreaterThanOrEqual(1);
  await p.waitForLoadState("networkidle");
  expect.soft(requests.length, "one request only").toBe(1);
  const raw = requests[0] ?? "";
  expect.soft(raw).toContain("Does this layout match the card?");
  expect.soft(raw).toContain('"card":"visual"');
  expect.soft(/image|iVBORw0KGgo/.test(raw), "the request carries the pasted image").toBe(true);
  expect.soft(/tab|conversation/.test(raw), "the request names the active tab").toBe(true);
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("It matches.");
});

test("73.3 each turn starts with the card the person looks at now", async ({ page: p }) => {
  const w = await project(
    {
      roles: {
        chat: { replies: [reply("m1", "The fold reads the log."), reply("m2", "This one traces props.")] },
      },
    },
    (s) => {
      s.seed("node.added", { id: "pr-log", kind: "card", title: "The log is append-only", parent: "root" });
      s.seed("node.added", { id: "vi-prop-trace", kind: "card", title: "Props are traced", parent: "root" });
    },
  );
  await p.goto(`${w.url}/map/pr-log`);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("The log is append-only");
  await say(p, "Explain the fold");
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("The fold reads the log.");
  await p.getByRole("searchbox", { name: "Search the map" }).fill("#vi-prop-trace");
  await p.getByRole("searchbox", { name: "Search the map" }).press("Enter");
  await expect(p).toHaveURL(/\/map\/vi-prop-trace$/);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Props are traced");
  await say(p, "And this one?");
  await expect(turns(p).locator(".msg.agent")).toContainText(["This one traces props."]);

  const all = heard(w).flat();
  const first = all.find((m) => m.endsWith("Explain the fold")) ?? "";
  const second = all.find((m) => m.endsWith("And this one?")) ?? "";
  // The turn input begins with the open-card line, which names the card first.
  expect(first.split("\n")[0]).toMatch(/^\[the map is now at #pr-log\b/);
  expect(second.split("\n")[0]).toMatch(/^\[the map is now at #vi-prop-trace\b/);
  expect(second.split("\n")[0]).not.toContain("#pr-log");
  // Note: a page navigation reloads the pane; both replies must still show in order.
  await expect(turns(p).locator(".msg.agent")).toHaveText(["The fold reads the log.", "This one traces props."]);
});

test("73.4 each conversation tab speaks to its own agent", async ({ page: p }) => {
  const w = await project(
    { roles: { chat: { replies: [reply("m1", "Alpha answer."), reply("m2", "Beta answer.")] } } },
    (s) => s.seed("node.added", { id: "werk-cli", kind: "card", title: "The command line", parent: "root" }),
  );
  await p.goto(`${w.url}/map/werk-cli`);
  const alpha = pane(p).getByRole("tab", { name: "alpha" });
  const beta = pane(p).getByRole("tab", { name: "beta" });
  expect.soft(await alpha.count(), 'a conversation tab "alpha"').toBe(1);
  expect.soft(await beta.count(), 'a conversation tab "beta"').toBe(1);
  if ((await alpha.count()) > 0) await alpha.click();
  await say(p, "First question");
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("Alpha answer.");
  if ((await beta.count()) > 0) await beta.click();
  await say(p, "Second question");
  await expect(pane(p).getByText("Beta answer.")).toBeVisible();

  const ls = launches(w);
  expect.soft(ls.length, "one agent per tab").toBe(2);
  expect.soft(ls[0]?.messages.map((m) => m.split("\n\n").at(-1))).toEqual(["First question"]);
  expect.soft(ls[1]?.messages.map((m) => m.split("\n\n").at(-1))).toEqual(["Second question"]);
  for (const l of ls) {
    const prompt = promptOf(l);
    expect.soft(prompt).toContain("Write a card about its subject");
    expect.soft(prompt).toContain("No session story");
    expect.soft(prompt).toMatch(/No code names\.\*\* Do not name source files, functions,[\s\S]*line numbers/);
  }
  expect.soft(ls.length).toBeGreaterThan(0);
});

test("73.5 a note sent to the note route appears in the card's thread", async ({ page: p }) => {
  const w = await project({ roles: {} }, (s) =>
    s.seed("node.added", {
      id: "werk-chat",
      kind: "card",
      title: "The composer sends a live agent turn",
      parent: "root",
    }),
  );
  const before = logLines(w).length;
  // A client outside the browser reads the page for its token, then posts the note.
  const html = await (await fetch(`${w.url}/map`)).text();
  const token = /<meta name="werk-token" content="([^"]+)"/.exec(html)?.[1] ?? "";
  const res = await fetch(`${w.url}/api/notes`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-werk-token": token },
    body: JSON.stringify({ id: "werk-chat", text: "check the stdin path" }),
  });
  expect(res.status).toBe(200);
  const added = logLines(w).slice(before);
  expect(added).toHaveLength(1);
  expect(added[0]?.type).toBe("note.added");
  expect(added[0]?.payload.id).toBe("werk-chat");
  let clip = "";
  try {
    clip = execSync("pbpaste", { encoding: "utf8" });
  } catch {
    clip = "";
  }
  expect
    .soft(clip, "the clipboard holds the note line")
    .toBe('re #werk-chat "The composer sends a live agent turn": check the stdin path');

  const noteRequests: string[] = [];
  p.on("request", (r) => {
    if (r.url().includes("/api/notes")) noteRequests.push(r.url());
  });
  await p.goto(`${w.url}/map`);
  await p
    .getByRole("link", { name: /The composer sends a live agent turn/ })
    .first()
    .click();
  await expect(p).toHaveURL(/\/map\/werk-chat$/);
  const notes = p.locator('[data-section="thread"] [data-entry="note"]');
  await expect(notes.filter({ hasText: "check the stdin path" })).toHaveCount(1);
  await expect(notes).toHaveCount(1);
  expect(noteRequests).toEqual([]);
});

test("19.2 a chat agent gets the instructions, but a sample agent does not", async ({ page: p }) => {
  const w = await project({ roles: { chat: { replies: [reply("m1", "Answered.")] } } }, (s) => {
    s.seed("node.added", { id: "how", kind: "card", title: "How we build", parent: "root" });
    s.seed("node.decided", { id: "how" });
    s.seed("node.added", { id: "how-tests", kind: "card", title: "Every pure file has a test", parent: "how" });
    s.seed("node.decided", { id: "how-tests" });
    s.seed("node.added", { id: "open-q", kind: "card", title: "Retry policy", parent: "root" });
  });
  await p.goto(`${w.url}/map/open-q`);
  await say(p, "What is open?");
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("Answered.");
  // Sample options for the open card: look for any sample control in the page and any sample verb.
  const sampleControl = p.getByRole("button", { name: /sample/i });
  const hasSample = (await sampleControl.count()) > 0;
  const help = w.werk("help");
  expect.soft(hasSample || /^\s+sample\b/m.test(help), "werk offers a way to sample options for a card").toBe(true);
  if (hasSample) await sampleControl.first().click();

  const chat = launches(w).find((l) => l.role === "chat");
  const chatPrompt = chat === undefined ? "" : promptOf(chat);
  expect.soft(chatPrompt).toContain("# werk — how to work with the decision map");
  expect.soft(chatPrompt).toContain("#how-tests — Every pure file has a test");
  const sample = launches(w).find((l) => l.role === "sample");
  expect.soft(sample, "a sample agent launched").toBeDefined();
  if (sample !== undefined) {
    expect.soft(promptOf(sample)).not.toContain("how to work with the decision map");
    expect.soft(promptOf(sample)).not.toContain("Every pure file has a test");
  }
});
