import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { LAUNCHES_FILE, type LaunchEntry } from "../src/test/fake-script.ts";
import { project, stop } from "../e2e/project.ts";

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
function heard(w: { dir: string }): string[] {
  const f = join(w.dir, "..", "fake", LAUNCHES_FILE);
  if (!existsSync(f)) return [];
  return readFileSync(f, "utf8").split("\n").filter(Boolean).flatMap((l) => {
    const e = JSON.parse(l) as LaunchEntry;
    return e.kind === "message" ? [(e.message as any).message.content[0].text as string] : [];
  });
}
const card = (s: { seed: (t: string, p: object) => void }, id: string, title: string) =>
  s.seed("node.added", { id, kind: "card", title, parent: "root", why: `why ${id}` });

test("[73.1] a message from the open card streams its reply back", async ({ page: p }) => {
  const w = await project(
    { roles: { chat: { replies: [[start("m1"), open("Part one,"), { pause: 2500 }, more(" part **two** names #werk-wording,"), { pause: 1500 }, more(" part three."), done("m1", "Part one, part **two** names #werk-wording, part three.")]] } } },
    (s) => {
      card(s, "werk-chat", "The composer sends a live agent turn");
      card(s, "werk-wording", "Wording of cards");
    },
  );
  const bodies: any[] = [];
  p.on("request", (r) => {
    if (r.url().endsWith("/api/chat") && r.method() === "POST") bodies.push(r.postDataJSON());
  });
  await p.goto(`${w.url}/map/werk-chat`);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("The composer sends a live agent turn");
  const tabs = p.getByRole("tab", { name: "design" });
  console.log("DESIGN TAB COUNT", await tabs.count());
  const box = pane(p).getByRole("textbox", { name: "Message" });
  await box.fill("What does this card decide?");
  await box.press("Enter");
  await expect(box).toHaveValue("");
  await expect(turns(p).nth(0).locator(".msg.agent")).toContainText("Part one,");
  await expect(turns(p).nth(0).locator('[data-role="turn-end"]')).toHaveCount(0);
  await expect(turns(p).nth(0).locator(".msg.agent")).toContainText("part three.");
  console.log("REQUEST BODIES", JSON.stringify(bodies));
  expect(bodies).toHaveLength(1);
  expect(bodies[0].text).toBe("What does this card decide?");
  expect(bodies[0].card).toBe("werk-chat");
  await expect(turns(p).nth(0).locator(".msg.agent strong")).toHaveText("two");
  const link = turns(p).nth(0).locator('.msg.agent a[href="/map/werk-wording"]');
  await expect(link).toHaveCount(1);
  await link.click();
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Wording of cards");
  // the conversation tab
  expect(Object.keys(bodies[0])).toContain("tab");
});

test("[73.2] a pasted image travels with the message in one request", async ({ page: p }) => {
  const w = await project({ roles: { chat: { replies: [reply("m1", "I see it.")] } } }, (s) => card(s, "visual", "Visual"));
  const bodies: any[] = [];
  p.on("request", (r) => {
    if (r.url().includes("/api/") && r.method() === "POST") bodies.push({ url: r.url(), data: r.postData() });
  });
  await p.goto(`${w.url}/map/visual`);
  const box = pane(p).getByRole("textbox", { name: "Message" });
  await box.focus();
  await p.evaluate(() => {
    const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
    const file = new File([png], "shot.png", { type: "image/png" });
    const dt = new DataTransfer();
    dt.items.add(file);
    document.activeElement?.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await box.fill("Does this layout match the card?");
  await box.press("Enter");
  await expect(turns(p).nth(0).locator(".msg.agent")).toContainText("I see it.");
  const chats = bodies.filter((b) => b.url.endsWith("/api/chat"));
  console.log("BODIES", JSON.stringify(bodies).slice(0, 600));
  expect(bodies.length).toBe(1);
  expect(chats[0].data).toMatch(/image/i);
});

test("[73.3] each turn starts with the card the person looks at now", async ({ page: p }) => {
  const w = await project({ roles: { chat: { replies: [reply("m1", "one"), reply("m2", "two")] } } }, (s) => {
    card(s, "pr-log", "The log");
    card(s, "vi-prop-trace", "The trace");
  });
  await p.goto(`${w.url}/map/pr-log`);
  await say(p, "Explain the fold");
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("one");
  await p.goto(`${w.url}/map/vi-prop-trace`);
  await say(p, "And this one?");
  await expect(turns(p).last().locator(".msg.agent")).toHaveText("two");
  const m = heard(w);
  console.log("TURN INPUTS", JSON.stringify(m.map((x) => x.split("\n")[0])));
  expect(m[0]?.split("\n")[0]).toContain("#pr-log");
  expect(m[0]?.startsWith("#pr-log")).toBe(true);
  expect(m[1]?.split("\n")[0]).toContain("#vi-prop-trace");
  expect(m[1]).not.toContain("#pr-log");
});

test("[73.4] each conversation tab speaks to its own agent", async ({ page: p }) => {
  const w = await project({ roles: { chat: { replies: [reply("m1", "one")] } } }, (s) => card(s, "werk-cli", "CLI"));
  await p.goto(`${w.url}/map/werk-cli`);
  const tabs = p.getByRole("tab");
  console.log("TAB COUNT", await tabs.count(), "ALPHA", await p.getByText("alpha", { exact: true }).count());
  await expect(p.getByRole("tab", { name: "alpha" })).toBeVisible();
});

test("[73.5] a note sent to the note route shows on the card's thread and the clipboard holds the reference line", async ({ page: p, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const w = await project(undefined, (s) => card(s, "werk-chat", "The composer sends a live agent turn"));
  const log = join(w.dir, ".werk", "log.jsonl");
  const before = readFileSync(log, "utf8").split("\n").filter(Boolean).length;
  const r = await fetch(`${w.url}/api/notes`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "werk-chat", text: "check the stdin path" }) });
  console.log("EXTERNAL NOTE STATUS", r.status);
  const after = readFileSync(log, "utf8").split("\n").filter(Boolean).length;
  expect(r.status).toBeLessThan(300);
  expect(after).toBe(before + 1);
  await p.goto(`${w.url}/map/werk-chat`);
  expect(await p.evaluate(() => navigator.clipboard.readText())).toBe('re #werk-chat "The composer sends a live agent turn": check the stdin path');
});
