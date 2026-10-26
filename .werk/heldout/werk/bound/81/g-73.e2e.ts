import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { cleanup, done, more, msgStart, open, pane, reply, say, start, turns } from "./g-lib.ts";

test.afterEach(cleanup);
const chat = (...replies: unknown[]) => ({ roles: { chat: { replies } } });
const seedCards = (ids: [string, string][]) => (s: { seed(t: string, p: object): void }) => {
  for (const [id, title] of ids) s.seed("node.added", { id, kind: "card", title, why: `why ${id}`, parent: "root" });
};

test("73.1 a message from the open card streams its reply back into the pane", async ({ page: p }) => {
  const w = await start(
    chat([
      msgStart("m1"),
      open("First part. "),
      { pause: 1500 },
      more("Second **bold** part, see #werk-wording. "),
      { pause: 1500 },
      more("Third part."),
      done("m1", "First part. Second **bold** part, see #werk-wording. Third part."),
    ]),
    seedCards([
      ["werk-chat", "The composer sends a live agent turn"],
      ["werk-wording", "Wording"],
    ]),
  );
  const bodies: string[] = [];
  p.on("request", (r) => {
    if (r.method() === "POST" && r.url().includes("/api/chat") && r.url().split("/api/chat")[1] === "") bodies.push(r.postData() ?? "");
  });
  await p.goto(`${w.url}/map/werk-chat`);
  const box = pane(p).getByRole("textbox", { name: "Message" });
  await box.fill("What does this card decide?");
  await box.press("Enter");
  await expect(box).toHaveValue("");
  await expect(turns(p).nth(0).locator(".msg.agent")).toContainText("First part.");
  await expect(turns(p).nth(0).locator(".msg.agent")).not.toContainText("Third part.");
  await expect(turns(p).nth(0).locator(".msg.agent")).toContainText("Third part.", { timeout: 10000 });
  await expect(turns(p).nth(0).locator(".msg.agent strong")).toHaveText("bold");
  expect(bodies).toHaveLength(1);
  const body = JSON.parse(bodies[0] as string);
  expect(body.text).toBe("What does this card decide?");
  expect(body.card).toBe("werk-chat");
  const link = turns(p).nth(0).locator('.msg.agent a[href$="/map/werk-wording"]');
  await expect(link).toHaveCount(1);
  // the conversation tab "design" must be named in the request
  expect(bodies[0]).toContain("design");
  await link.click();
  await expect(p).toHaveURL(/\/map\/werk-wording$/);
});

test("73.2 a pasted image travels with the message in the same request", async ({ page: p }) => {
  const w = await start(chat(reply("m1", "Looks right")), seedCards([["visual", "Visual"]]));
  const bodies: string[] = [];
  p.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith("/api/chat")) bodies.push(r.postData() ?? "");
  });
  await p.goto(`${w.url}/map/visual`);
  const box = pane(p).getByRole("textbox", { name: "Message" });
  await box.focus();
  // paste a PNG into the composer
  await box.evaluate((el) => {
    const bytes = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], "shot.png", { type: "image/png" }));
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await box.fill("Does this layout match the card?");
  await box.press("Enter");
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("Looks right");
  expect(bodies).toHaveLength(1);
  const body = JSON.parse(bodies[0] as string);
  expect(body.text).toBe("Does this layout match the card?");
  expect(body.card).toBe("visual");
  expect(JSON.stringify(body)).toMatch(/image|png/i);
});

test("73.3 each turn starts with the card the person looks at now", async ({ page: p }) => {
  const w = await start(
    chat(reply("a", "reply one"), reply("b", "reply two")),
    seedCards([
      ["pr-log", "The log"],
      ["vi-prop-trace", "Trace"],
    ]),
  );
  await p.goto(`${w.url}/map/pr-log`);
  await say(p, "Explain the fold");
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("reply one");
  await p.goto(`${w.url}/map/vi-prop-trace`);
  await say(p, "And this one?");
  await expect(turns(p).last().locator(".msg.agent")).toHaveText("reply two");
  const msgs = w.launches().flatMap((l) => l.messages);
  const l = w.launches();
  // the second page load keeps the same agent child, so both turns are in order
  expect(msgs).toHaveLength(2);
  expect(msgs[0]).toMatch(/^\[the map is now at #pr-log/);
  expect(msgs[1]).toMatch(/^\[the map is now at #vi-prop-trace/);
  expect(msgs[1]).not.toContain("#pr-log");
  expect(l.length).toBe(1);
});

test("73.4 each conversation tab speaks to its own agent", async ({ page: p }) => {
  const w = await start(chat(reply("a", "one")), seedCards([["werk-cli", "CLI"]]));
  await p.goto(`${w.url}/map/werk-cli`);
  await expect(pane(p).getByRole("tab", { name: "alpha" })).toHaveCount(1, { timeout: 3000 });
  await expect(pane(p).getByRole("tab", { name: "beta" })).toHaveCount(1, { timeout: 3000 });
  // the prompt of the agent says a card describes its subject and names no file, function or line
  const args = w.launches()[0]?.args ?? [];
  expect(args.join(" ")).toContain("names no file");
});

test("73.5 a note sent to the note route appears in the card's thread", async ({ page: p, context }) => {
  const w = await start(chat(reply("a", "x")), seedCards([["werk-chat", "The composer sends a live agent turn"]]));
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await p.goto(`${w.url}/map`);
  const token = (await p.locator('meta[name="werk-token"]').getAttribute("content")) ?? "";
  const requests: string[] = [];
  p.on("request", (r) => {
    if (r.url().includes("/api/notes")) requests.push(r.url());
  });
  const before = readFileSync(`${w.dir}/.werk/log.jsonl`, "utf8").split("\n").filter(Boolean).length;
  const bare = await fetch(`${w.url}/api/notes`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "werk-chat", text: "check the stdin path" }) });
  const sent = await fetch(`${w.url}/api/notes`, { method: "POST", headers: { "content-type": "application/json", "x-werk-token": token }, body: JSON.stringify({ id: "werk-chat", text: "check the stdin path" }) });
  expect(sent.status).toBe(200);
  const lines = readFileSync(`${w.dir}/.werk/log.jsonl`, "utf8").split("\n").filter(Boolean);
  expect(lines.length - before).toBe(1);
  expect(lines.at(-1)).toContain('"werk-chat"');
  expect(lines.at(-1)).toContain("note");
  const clip = await p.evaluate(() => navigator.clipboard.readText());
  expect.soft(clip).toBe('re #werk-chat "The composer sends a live agent turn": check the stdin path');
  await p.goto(`${w.url}/map/werk-chat`);
  await expect(p.getByText("check the stdin path")).toHaveCount(1);
  expect(requests).toHaveLength(0);
  expect(bare.status).toBeGreaterThanOrEqual(400);
});
