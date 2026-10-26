import { writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { project, stop } from "../e2e/project.ts";
import { done, heard, more, open, pane, reply, say, start, turns } from "./chat-helpers.ts";

test.afterEach(stop);

const retries = (s: { seed: (t: string, p: object) => void }) =>
  s.seed("node.added", { id: "retry", kind: "card", title: "Checkout retries", why: "two tries", parent: "root" });

test("20.1 streaming reply, status row, markdown card link, map redraw before reply end", async ({ page: p }) => {
  const line = (seq: number, type: string, payload: object) =>
    JSON.stringify({ seq, at: "t", actor: seq <= 2 ? "you" : "agent", type, payload });
  const log = [
    line(1, "node.added", { id: "root", kind: "card", title: "Root" }),
    line(2, "node.added", { id: "retry", kind: "card", title: "Checkout retries", why: "two tries", parent: "root" }),
    line(3, "node.retitled", { id: "retry", title: "Checkout retries: three tries" }),
  ].join("\n");
  const w = await project(
    {
      roles: {
        chat: {
          replies: [
            [
              start("m1"),
              open("See #retry"),
              { pause: 1500 },
              more(" for **three** tries"),
              { edit: { path: ".werk/log.jsonl", content: `${log}\n` } },
              { pause: 3000 },
              done("m1", "See #retry for **three** tries"),
            ],
          ],
        },
      },
    },
    retries,
  );
  await p.goto(`${w.url}/map/retry`);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Checkout retries");
  await expect(p.getByText("two tries").first()).toBeVisible();
  await say(p, "Make it three tries");
  await expect(turns(p).nth(0).locator(".msg.user")).toHaveText("Make it three tries");
  await expect(turns(p).nth(0).locator(".msg.agent")).toContainText("See");
  const status = pane(p).getByRole("status", { name: "Turn state" });
  await expect(status).toContainText(/\d+s/);
  await expect(status).toContainText(/tokens?/);
  const agent = turns(p).nth(0).locator(".msg.agent");
  await expect(agent.locator("strong")).toHaveText("three");
  const link = agent.locator("a").first();
  await expect(link).toHaveAttribute("href", /\/map\/retry$/);
  // Map redraws before the reply ends.
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Checkout retries: three tries");
  await expect(turns(p).nth(0).locator('[data-role="turn-end"]')).toHaveCount(0);
  await expect(turns(p).nth(0).locator('[data-role="turn-end"]')).toBeVisible();
  await expect(status).not.toContainText("tokens");
  await expect(agent).toContainText("for three tries");
});

test("20.2 second message waits and first reply finishes above it", async ({ page: p }) => {
  const w = await project({
    roles: {
      chat: {
        replies: [
          [start("m1"), open("First"), { pause: 2000 }, more(" answer"), done("m1", "First answer")],
          reply("m2", "Second answer"),
        ],
      },
    },
  });
  await p.goto(`${w.url}/map`);
  await say(p, "First question");
  await expect(turns(p).nth(0).locator(".msg.agent")).toContainText("First");
  await say(p, "Second question");
  await expect(turns(p).nth(1).locator(".msg.user")).toHaveText("Second question");
  await expect(turns(p).nth(1).locator('[data-mark="waiting"]')).toHaveText(/waits for the reply above/);
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("First answer");
  await expect(turns(p).nth(1).locator('[data-mark="waiting"]')).toHaveCount(0);
  await expect(turns(p).nth(1).locator(".msg.agent")).toHaveText("Second answer");
  expect(w.dir).toBeTruthy();
});

test("20.3 each turn names the open card (checked on what the agent receives)", async ({ page: p }) => {
  const w = await project({ roles: { chat: { replies: [reply("a", "1"), reply("b", "2"), reply("c", "3")] } } }, retries);
  await p.goto(`${w.url}/map/retry`);
  await say(p, "What does this say?");
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("1");
  await say(p, "And now?");
  await expect(turns(p).nth(1).locator(".msg.agent")).toHaveText("2");
  await p.goto(`${w.url}/map`);
  await say(p, "Where am I?");
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("3");
  const [m] = heard(w);
  expect(m?.[0]).toContain("Checkout retries");
  expect(m?.[0]).toContain("why: two tries");
  expect(m?.[1]).toBe("[still on #retry — Checkout retries]\n\nAnd now?");
  expect(m?.[2]).toContain("#root — Root");
});

test("20.4 three tool calls collapse into one line", async ({ page: p }) => {
  const call = (id: string, command: string) => ({
    event: { type: "assistant", message: { id: `m-${id}`, content: [{ type: "tool_use", id, name: "Bash", input: { command } }] } },
  });
  const res = (id: string, content: string) => ({
    event: { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content }] } },
  });
  const w = await project({
    roles: {
      chat: {
        replies: [[call("t1", "ls"), res("t1", "a"), call("t2", "pwd"), res("t2", "/p"), call("t3", "git status"), res("t3", "clean"), ...reply("m4", "Answer.")]],
      },
    },
  });
  await p.goto(`${w.url}/map`);
  await say(p, "Look at the code");
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("Answer.");
  const runs = turns(p).nth(0).locator('[data-role="tool-run"]');
  await expect(runs).toHaveCount(1);
  await expect(runs.locator("summary")).toContainText("git status");
  await expect(runs.locator("summary")).toContainText("3");
  await runs.locator("summary").click();
  await expect(runs.locator('[data-role="tool-call"]')).toHaveCount(3);
  await expect(runs.locator('[data-role="tool-input"]').nth(0)).toContainText("ls");
  await expect(runs.locator('[data-role="tool-output"]').nth(2)).toHaveText("clean");
});

test("20.5 chat request without token starts no agent", async ({ page: p }) => {
  const w = await project({ roles: { chat: { replies: [reply("m1", "never")] } } }, retries);
  await p.goto(`${w.url}/map`);
  const res = await fetch(`${w.url}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://evil.example" },
    body: JSON.stringify({ text: "Make it three tries", turn: "t1", card: "retry" }),
  });
  expect(res.status).toBeGreaterThanOrEqual(400);
  expect(res.status).toBeLessThan(500);
  await expect(turns(p)).toHaveCount(0);
  expect(heard(w)).toEqual([]);
  const card = await (await fetch(`${w.url}/api/card/retry`)).text();
  expect(card).toContain("two tries");
  void writeFileSync;
});
