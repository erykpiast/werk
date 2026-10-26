import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { boot, done, heardMessages, more, open, pane, reply, say, start, stopAll, turns } from "./f6-lib.ts";

test.afterEach(stopAll);

const seedCards = (x: { seed(t: string, p: object): void }) => {
  for (const [id, title, extra] of [
    ["werk-chat", "The composer sends a live agent turn", { body: "See #werk-wording." }],
    ["werk-wording", "Wording of cards", {}],
    ["pr-log", "The log", {}],
    ["vi-prop-trace", "Trace", {}],
    ["visual", "Visual", {}],
    ["werk-cli", "The CLI", {}],
  ] as const)
    x.seed("node.added", { id, kind: "card", title, parent: "root", ...extra });
};

const chatBodies = (p: import("@playwright/test").Page) => {
  const seen: Record<string, unknown>[] = [];
  void p.route("**/api/chat", async (r) => {
    if (r.request().method() === "POST") seen.push(JSON.parse(r.request().postData() ?? "{}"));
    await r.continue();
  });
  return seen;
};

test("73.1 a message streams a reply back; tab field", async ({ page: p }) => {
  const b = await boot(
    {
      roles: {
        chat: {
          replies: [
            [
              start("m1"),
              open("Part one"),
              { pause: 1500 },
              more(" part two, see #werk-wording"),
              { pause: 1500 },
              more(" and **bold** end."),
              done("m1", "Part one part two, see #werk-wording and **bold** end."),
            ],
          ],
        },
      },
    },
    seedCards,
  );
  const seen = chatBodies(p);
  await p.goto(`${b.url}/map/werk-chat`);
  const bodyLink = p.locator('article a[href="/map/werk-wording"]').first();
  await expect(bodyLink).toBeVisible();
  const bodyClass = await bodyLink.getAttribute("class");
  const box = pane(p).getByRole("textbox", { name: "Message" });
  await box.fill("What does this card decide?");
  await box.press("Enter");
  await expect(box).toHaveValue("");
  const agent = turns(p).nth(0).locator(".msg.agent");
  await expect(agent).toContainText("Part one");
  await expect(agent).not.toContainText("end.");
  await expect(agent).toContainText("end.");
  await expect(agent.locator("strong")).toHaveText("bold");
  const link = agent.locator('a[href="/map/werk-wording"]');
  await expect(link).toBeVisible();
  expect(await link.getAttribute("class")).toBe(bodyClass);
  expect(seen).toHaveLength(1);
  expect(seen[0]).toMatchObject({ text: "What does this card decide?", card: "werk-chat" });
  expect(seen[0]).toHaveProperty("tab", "design");
  await link.click();
  await expect(p).toHaveURL(/\/map\/werk-wording$/);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Wording of cards");
});

test("73.1b conversation tab 'design' exists", async ({ page: p }) => {
  const b = await boot({ roles: { chat: { replies: [reply("m1", "x")] } } }, seedCards);
  await p.goto(`${b.url}/map/werk-chat`);
  await expect(pane(p).getByRole("tab", { name: "design" })).toHaveCount(1);
});

test("73.2 pasted image travels with the message", async ({ page: p }) => {
  const b = await boot({ roles: { chat: { replies: [reply("m1", "Looks right.")] } } }, seedCards);
  const seen = chatBodies(p);
  await p.goto(`${b.url}/map/visual`);
  const box = pane(p).getByRole("textbox", { name: "Message" });
  await box.focus();
  await box.evaluate((el) => {
    const dt = new DataTransfer();
    const bytes = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
    dt.items.add(new File([bytes], "shot.png", { type: "image/png" }));
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await box.fill("Does this layout match the card?");
  await box.press("Enter");
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("Looks right.");
  expect(seen).toHaveLength(1);
  expect(seen[0]).toMatchObject({ text: "Does this layout match the card?", card: "visual" });
  expect(JSON.stringify(seen[0])).toMatch(/image|png|base64/i);
  expect(seen[0]).toHaveProperty("tab");
});

test("73.3 each turn starts with the card in view", async ({ page: p }) => {
  const b = await boot({ roles: { chat: { replies: [reply("m1", "first"), reply("m2", "second")] } } }, seedCards);
  await p.goto(`${b.url}/map`);
  await p.locator('a[data-tile="pr-log"]').click();
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("The log");
  await say(p, "Explain the fold", "Enter");
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("first");
  await p.getByRole("navigation", { name: "Breadcrumbs" }).getByRole("button", { name: "Home" }).click();
  await p.locator('a[data-tile="vi-prop-trace"]').click();
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("Trace");
  await say(p, "And this one?", "Enter");
  await expect(turns(p).nth(1).locator(".msg.agent")).toHaveText("second");
  const m = heardMessages(b);
  expect(m[0]?.split("\n")[0]).toContain("#pr-log");
  expect(m[0]).toMatch(/^\[the map is now at #pr-log/);
  expect(m[0]).not.toMatch(/^#pr-log/);
  expect(m[1]?.split("\n")[0]).toContain("#vi-prop-trace");
  expect(m[1]).not.toContain("#pr-log");
  await expect(turns(p).nth(0).locator(".msg.user")).toHaveText("Explain the fold");
  await expect(turns(p).nth(1).locator(".msg.user")).toHaveText("And this one?");
});

test("73.4 each conversation tab has its own agent", async ({ page: p }) => {
  const b = await boot({ roles: { chat: { replies: [reply("m1", "a1")] } } }, seedCards);
  await p.goto(`${b.url}/map/werk-cli`);
  await expect(pane(p).getByRole("tab", { name: "alpha" })).toHaveCount(1);
  await expect(pane(p).getByRole("tab", { name: "beta" })).toHaveCount(1);
  await say(p, "First question", "Enter");
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("a1");
  const launches = b.launches().filter((e) => e.kind === "launch");
  const prompt = JSON.stringify(launches.map((e) => (e.kind === "launch" ? e.args : [])));
  expect(prompt).toMatch(/No session story/);
  expect(prompt).toMatch(/No code names/);
});

test("73.5 a note from outside appears in the thread; clipboard line", async ({ page: p, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const b = await boot({ roles: { chat: { replies: [] } } }, seedCards);
  const html = await (await fetch(`${b.url}/map/werk-chat`)).text();
  const token = /name="werk-token"\s+content="([^"]+)"/.exec(html)?.[1] ?? /content="([^"]+)"\s+name="werk-token"/.exec(html)?.[1] ?? "";
  expect(token).not.toBe("");
  const before = b.werk("inbox");
  const res = await fetch(`${b.url}/api/notes`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-werk-token": token },
    body: JSON.stringify({ id: "werk-chat", text: "check the stdin path" }),
  });
  expect(res.status).toBeLessThan(300);
  const log = (readFileSync(`${b.dir}/.werk/log.jsonl`, "utf8")).split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const notes = log.filter((e) => e.type === "note.added");
  expect(notes).toHaveLength(1);
  expect(notes[0].payload.id).toBe("werk-chat");
  expect(before).not.toContain("check the stdin path");
  const requests: string[] = [];
  p.on("request", (r) => {
    if (r.url().includes("/api/notes")) requests.push(r.url());
  });
  await p.goto(`${b.url}/map/werk-chat`);
  const thread = p.locator('[data-section="thread"] [data-entry="note"]').filter({ hasText: "check the stdin path" });
  await expect(thread).toHaveCount(1);
  expect(requests).toEqual([]);
  const clip = await p.evaluate(() => navigator.clipboard.readText().catch(() => ""));
  expect(clip).toBe('re #werk-chat "The composer sends a live agent turn": check the stdin path');
});
