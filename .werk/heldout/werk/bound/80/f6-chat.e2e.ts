import { expect, test } from "@playwright/test";
import { boot, done, heardMessages, more, open, pane, reply, say, start, stopAll, turns } from "./f6-lib.ts";

test.afterEach(stopAll);

const line = (seq: number, type: string, payload: object) =>
  JSON.stringify({ seq, at: "t", actor: seq === 1 ? "you" : "agent", type, payload });
const logWith = (body: string) =>
  `${[
    line(1, "node.added", { id: "root", kind: "card", title: "Root" }),
    line(2, "node.added", { id: "retries", kind: "card", title: "Checkout retries", body, parent: "root" }),
  ].join("\n")}\n`;

test("20.1 message streams, header row shows activity, card redraws before reply ends", async ({ page: p }) => {
  const b = await boot(
    {
      roles: {
        chat: {
          replies: [
            [
              start("m1"),
              open("Okay, see #retries and **three** tries"),
              { event: { type: "stream_event", event: { type: "message_delta", usage: { output_tokens: 42 } } } },
              { pause: 1500 },
              { edit: { path: ".werk/log.jsonl", content: logWith("Three tries.") } },
              { pause: 3000 },
              done("m1", "Okay, see #retries and **three** tries"),
            ],
          ],
        },
      },
    },
    (x) => x.seed("node.added", { id: "retries", kind: "card", title: "Checkout retries", body: "Two tries.", parent: "root" }),
  );
  await p.goto(`${b.url}/map/retries`);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Checkout retries");
  await expect(p.locator("article")).toContainText("Two tries.");
  await say(p, "Make it three tries", "Enter");
  await expect(turns(p).nth(0).locator(".msg.user")).toHaveText("Make it three tries");
  await expect(turns(p).nth(0).locator(".msg.agent")).toContainText("Okay");
  const status = pane(p).getByRole("status", { name: "Turn state" });
  await expect(status).toHaveText(/writing · \d+s · 42 tokens/);
  await expect(p.locator("article")).toContainText("Three tries.");
  await expect(turns(p).nth(0).locator('[data-role="turn-end"]')).toHaveCount(0);
  const agent = turns(p).nth(0).locator(".msg.agent");
  await expect(turns(p).nth(0).locator('[data-role="turn-end"]')).toBeVisible();
  await expect(agent.locator("strong")).toHaveText("three");
  const link = agent.locator("a", { hasText: "#retries" });
  await expect(link).toHaveAttribute("href", /\/map\/retries/);
  await expect(status).not.toHaveText(/writing/);
  await expect(agent).toContainText("Okay, see #retries and three tries");
});

test("20.2 second message waits", async ({ page: p }) => {
  const b = await boot({
    roles: {
      chat: {
        replies: [
          [start("m1"), open("Part one"), { pause: 2500 }, more(" and two."), done("m1", "Part one and two.")],
          reply("m2", "Answer two."),
        ],
      },
    },
  });
  await p.goto(`${b.url}/map`);
  await say(p, "First question");
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("Part one");
  await say(p, "Second question", "Enter");
  await expect(turns(p).nth(1).locator(".msg.user")).toHaveText("Second question");
  await expect(turns(p).nth(1).locator('[data-mark="waiting"]')).toHaveText(/waits for the reply above/);
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("Part one and two.");
  await expect(turns(p).nth(1).locator('[data-mark="waiting"]')).toHaveCount(0);
  await expect(turns(p).nth(1).locator(".msg.agent")).toHaveText("Answer two.");
});

test("20.3 each turn names the open card", async ({ page: p }) => {
  const b = await boot(
    { roles: { chat: { replies: [reply("m1", "one"), reply("m2", "two"), reply("m3", "three")] } } },
    (x) => x.seed("node.added", { id: "retries", kind: "card", title: "Checkout retries", why: "Cards fail", parent: "root" }),
  );
  await p.goto(`${b.url}/map/retries`);
  await say(p, "What does this say?");
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("one");
  await say(p, "And now?");
  await expect(turns(p).nth(1).locator(".msg.agent")).toHaveText("two");
  await p.goto(`${b.url}/map`);
  await say(p, "Where am I?");
  await expect(turns(p).last().locator(".msg.agent")).toHaveText("three");
  const m = heardMessages(b);
  expect(m[0]).toContain("[the map is now at #retries — Checkout retries]");
  expect(m[0]).toContain("why: Cards fail");
  expect(m[1]).toBe("[still on #retries — Checkout retries]\n\nAnd now?");
  expect(m[2]).toContain("[the map is now at #root — Root]");
});

test("20.4 tool calls collapse", async ({ page: p }) => {
  const call = (id: string, command: string) => ({
    event: { type: "assistant", message: { id: `m-${id}`, content: [{ type: "tool_use", id, name: "Bash", input: { command } }] } },
  });
  const result = (id: string, content: string) => ({
    event: { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content }] } },
  });
  const b = await boot({
    roles: {
      chat: {
        replies: [
          [call("t1", "ls"), result("t1", "a.txt"), call("t2", "pwd"), result("t2", "/project"), call("t3", "git status"), result("t3", "clean"), ...reply("m4", "All clean.")],
        ],
      },
    },
  });
  await p.goto(`${b.url}/map`);
  await say(p, "Look at the code");
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("All clean.");
  const runs = turns(p).nth(0).locator('[data-role="tool-run"]');
  await expect(runs).toHaveCount(1);
  await expect(runs.locator("summary")).toHaveText("Bash git status · 3 calls");
  await runs.locator("summary").click();
  await expect(runs.locator('[data-role="tool-call"]')).toHaveCount(3);
  await expect(runs.locator('[data-role="tool-input"]').nth(0)).toContainText("ls");
  await expect(runs.locator('[data-role="tool-output"]').nth(2)).toHaveText("clean");
});

test("20.5 a chat request without the token starts no agent", async ({ page: p }) => {
  const b = await boot({ roles: { chat: { replies: [reply("m1", "never")] } } }, (x) =>
    x.seed("node.added", { id: "retries", kind: "card", title: "Checkout retries", body: "Two tries.", parent: "root" }),
  );
  await p.goto(`${b.url}/map/retries`);
  const res = await fetch(`${b.url}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://evil.example" },
    body: JSON.stringify({ text: "Make it three tries", turn: "t1", card: "retries" }),
  });
  expect(res.status).toBe(403);
  expect(b.launches()).toEqual([]);
  await expect(turns(p)).toHaveCount(0);
  await p.reload();
  await expect(p.locator("article")).toContainText("Two tries.");
});
