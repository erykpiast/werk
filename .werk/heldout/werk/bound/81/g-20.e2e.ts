import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { cleanup, done, more, msgStart, open, pane, reply, say, start, stream, turns } from "./g-lib.ts";

test.afterEach(cleanup);

const line = (seq: number, type: string, payload: object) =>
  JSON.stringify({ seq, at: "t", actor: seq === 1 ? "you" : "agent", type, payload });

test("20.1 message streams a reply, header shows activity, map redraws, reply ends", async ({ page: p }) => {
  const log = [
    line(1, "node.added", { id: "root", kind: "card", title: "Root" }),
    line(2, "node.added", { id: "retry", kind: "card", title: "Checkout retries", why: "says three tries", body: "three tries", parent: "root" }),
  ].join("\n");
  const w = await start(
    {
      roles: {
        chat: {
          replies: [
            [
              msgStart("m1"),
              stream({ type: "content_block_start", index: 0, content_block: { type: "thinking" } }),
              stream({ type: "message_delta", usage: { output_tokens: 42 }, delta: {} }),
              { pause: 1500 },
              open("Making **three** tries, see #retry. "),
              { pause: 1500 },
              { edit: { path: ".werk/log.jsonl", content: `${log}\n` } },
              { pause: 2500 },
              more("Done."),
              done("m1", "Making **three** tries, see #retry. Done."),
            ],
          ],
        },
      },
    },
    (s) => s.seed("node.added", { id: "retry", kind: "card", title: "Checkout retries", why: "says two tries", body: "two tries", parent: "root" }),
  );
  await p.goto(`${w.url}/map/retry`);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Checkout retries");
  await say(p, "Make it three tries");
  await expect(turns(p).nth(0).locator(".msg.user")).toHaveText("Make it three tries");
  const status = pane(p).getByRole("status", { name: "Turn state" });
  await expect(status).toHaveText(/\d+s · 42 tokens|· \d+ tokens/);
  await expect(status).toHaveText(/\d+(\.\d)?s/);
  await expect(turns(p).nth(0).locator(".msg.agent")).toContainText("Making");
  // reply renders as markdown with a card link
  await expect(turns(p).nth(0).locator(".msg.agent strong")).toHaveText("three");
  const link = turns(p).nth(0).locator(".msg.agent a");
  await expect(link).toHaveAttribute("href", /\/map\/retry$/);
  // the map redraws before the reply ends
  await expect(p.locator("body")).toContainText("says three tries");
  await expect(turns(p).nth(0).locator('[data-role="turn-end"]')).toHaveCount(0);
  await expect(turns(p).nth(0).locator('[data-role="turn-end"]')).toBeVisible({ timeout: 15000 });
  await expect(turns(p).nth(0).locator(".msg.agent")).toContainText("Done.");
  await expect(status).not.toContainText("tokens");
  await link.click();
  await expect(p).toHaveURL(/\/map\/retry$/);
});

test("20.2 second message waits and the first reply finishes above it", async ({ page: p }) => {
  const w = await start({
    roles: { chat: { replies: [[msgStart("m1"), open("First part"), { pause: 2500 }, more(" rest."), done("m1", "First part rest.")], reply("m2", "Second answer")] } },
  });
  await p.goto(`${w.url}/map`);
  await say(p, "First question");
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("First part");
  await say(p, "Second question");
  await expect(turns(p).nth(1).locator(".msg.user")).toHaveText("Second question");
  await expect(turns(p).nth(1).locator('[data-mark="waiting"]')).toHaveText(/waits for the reply above/);
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("First part rest.");
  await expect(turns(p).nth(1).locator('[data-mark="waiting"]')).toHaveCount(0);
  await expect(turns(p).nth(1).locator(".msg.agent")).toHaveText("Second answer");
});

test("20.3 each turn names the open card", async ({ page: p }) => {
  const w = await start({ roles: { chat: { replies: [reply("a", "1"), reply("b", "2"), reply("c", "3")] } } }, (s) =>
    s.seed("node.added", { id: "retry", kind: "card", title: "Checkout retries", why: "Cards fail", parent: "root" }),
  );
  await p.goto(`${w.url}/map/retry`);
  await say(p, "What does this say?");
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("1");
  await say(p, "And now?");
  await expect(turns(p).nth(1).locator(".msg.agent")).toHaveText("2");
  await p.goto(`${w.url}/map`);
  await say(p, "Where am I?");
  await expect(turns(p).last().locator(".msg.agent")).toHaveText(/\S/);
  const m = w.launches().flatMap((l) => l.messages);
  expect(m[0]).toContain("Checkout retries");
  expect(m[0]).toContain("Cards fail");
  expect(m[1]).toBe("[still on #retry — Checkout retries]\n\nAnd now?");
  expect(m[2]).toContain("#root — Root");
});

test("20.4 three tool calls collapse into one line", async ({ page: p }) => {
  const call = (id: string, command: string) => ({
    event: { type: "assistant", message: { id: `m-${id}`, content: [{ type: "tool_use", id, name: "Bash", input: { command } }] } },
  });
  const result = (id: string, content: string) => ({
    event: { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content }] } },
  });
  const w = await start({
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

test("20.5 chat request without the token starts no agent", async ({ page: p }) => {
  const w = await start({ roles: { chat: { replies: [reply("m1", "never")] } } }, (s) =>
    s.seed("node.added", { id: "retry", kind: "card", title: "Checkout retries", body: "two tries", parent: "root" }),
  );
  await p.goto(`${w.url}/map`);
  const body = JSON.stringify({ text: "Make it three tries", turn: "t1", card: "root" });
  const r = await fetch(`${w.url}/api/chat`, { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example" }, body });
  expect(r.status).toBe(403);
  await p.waitForTimeout(500);
  expect(w.launches()).toEqual([]);
  await expect(turns(p)).toHaveCount(0);
  expect(readFileSync(join(w.dir, ".werk", "log.jsonl"), "utf8")).toContain("two tries");
});
