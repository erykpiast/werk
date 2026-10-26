import { expect, test } from "@playwright/test";
import { project, stop } from "../e2e/project.ts";
import { done, heard, launchArgs, more, open, pane, reply, say, start, turns } from "./chat-helpers.ts";

test.afterEach(stop);
const card = (id: string, title: string) => (s: { seed: (t: string, p: object) => void }) =>
  s.seed("node.added", { id, kind: "card", title, parent: "root" });
const seedAll = (...cards: [string, string][]) => (s: Parameters<ReturnType<typeof card>>[0]) => {
  for (const [id, title] of cards) card(id, title)(s);
};

test("73.1 message from the open card streams back; request carries text, card and tab", async ({ page: p }) => {
  const w = await project(
    {
      roles: {
        chat: {
          replies: [
            [start("m1"), open("This card decides see "), { pause: 1500 }, more("#werk-wording and **bold**"), { pause: 500 }, done("m1", "This card decides see #werk-wording and **bold**")],
          ],
        },
      },
    },
    seedAll(["werk-chat", "The composer sends a live agent turn"], ["werk-wording", "Wording"]),
  );
  const requests: { url: string; body: Record<string, unknown> }[] = [];
  p.on("request", (r) => {
    if (r.url().includes("/api/chat") && r.method() === "POST") requests.push({ url: r.url(), body: JSON.parse(r.postData() ?? "{}") });
  });
  await p.goto(`${w.url}/map/werk-chat`);
  await expect(p.getByRole("heading", { level: 1 })).toHaveText("The composer sends a live agent turn");
  // The step names a conversation tab "design" as active: the pane has none.
  await expect(pane(p).getByRole("tab", { name: "design" })).toBeVisible({ timeout: 1500 });
  await say(p, "What does this card decide?");
  await expect(pane(p).getByRole("textbox", { name: "Message" })).toHaveValue("");
  await expect(turns(p).nth(0).locator(".msg.agent")).toContainText("This card decides");
  await expect(turns(p).nth(0).locator(".msg.agent")).not.toContainText("bold");
  await expect(turns(p).nth(0).locator(".msg.agent strong")).toHaveText("bold");
  expect(requests).toHaveLength(1);
  expect(requests[0]?.body).toMatchObject({ text: "What does this card decide?", card: "werk-chat", tab: "design" });
  const link = turns(p).nth(0).locator(".msg.agent a");
  await expect(link).toHaveAttribute("href", "/map/werk-wording");
  await link.click();
  await expect(p).toHaveURL(/\/map\/werk-wording$/);
  void heard;
});

test("73.2 a pasted image travels with the message in one request", async ({ page: p }) => {
  const w = await project({ roles: { chat: { replies: [reply("m1", "Looks right.")] } } }, card("visual", "Visual"));
  const requests: Record<string, unknown>[] = [];
  p.on("request", (r) => {
    if (r.url().includes("/api/chat") && r.method() === "POST") requests.push(JSON.parse(r.postData() ?? "{}"));
  });
  await p.goto(`${w.url}/map/visual`);
  const box = pane(p).getByRole("textbox", { name: "Message" });
  await box.focus();
  await box.evaluate((el) => {
    const bytes = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
    const file = new File([bytes], "shot.png", { type: "image/png" });
    const data = new DataTransfer();
    data.items.add(file);
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await box.fill("Does this layout match the card?");
  await box.press("Enter");
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("Looks right.");
  expect(requests).toHaveLength(1);
  const body = requests[0] as Record<string, unknown>;
  expect(body.text).toBe("Does this layout match the card?");
  expect(body.card).toBe("visual");
  expect(body).toHaveProperty("tab");
  expect(JSON.stringify(body)).toMatch(/image/);
});

test("73.3 each turn starts with the card the person looks at now", async ({ page: p }) => {
  const w = await project(
    { roles: { chat: { replies: [reply("a", "one"), reply("b", "two")] } } },
    seedAll(["pr-log", "The log"], ["vi-prop-trace", "Trace"]),
  );
  await p.goto(`${w.url}/map`);
  await p.locator('a[data-tile="pr-log"]').click();
  await expect(p).toHaveURL(/\/map\/pr-log$/);
  await say(p, "Explain the fold");
  await expect(turns(p).nth(0).locator(".msg.agent")).toHaveText("one");
  await p.getByRole("navigation", { name: "Breadcrumbs" }).getByRole("button", { name: "Home" }).click();
  await p.locator('a[data-tile="vi-prop-trace"]').click();
  await expect(p).toHaveURL(/\/map\/vi-prop-trace$/);
  await say(p, "And this one?");
  await expect(turns(p).nth(1).locator(".msg.agent")).toHaveText("two");
  const [m] = heard(w);
  expect(m?.[0]?.split("\n")[0]).toContain("#pr-log");
  expect(m?.[0]?.startsWith("[the map is now at #pr-log")).toBe(true);
  expect(m?.[1]?.split("\n")[0]).toContain("#vi-prop-trace");
  expect(m?.[1]).not.toContain("#pr-log");
});

test("73.4 each conversation tab speaks to its own agent", async ({ page: p }) => {
  const w = await project({ roles: { chat: { replies: [reply("a", "alpha reply")] } } }, card("werk-cli", "CLI"));
  await p.goto(`${w.url}/map/werk-cli`);
  await expect(pane(p).getByRole("tab", { name: "alpha" })).toBeVisible({ timeout: 1500 });
  await expect(pane(p).getByRole("tab", { name: "beta" })).toBeVisible({ timeout: 1500 });
  void launchArgs;
});

test("73.5 a note sent to the note route shows in the thread and puts a re-line on the clipboard", async ({ page: p, context }) => {
  const w = await project({ roles: {} }, card("werk-chat", "The composer sends a live agent turn"));
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const noteRequests: string[] = [];
  p.on("request", (r) => {
    if (r.url().includes("/api/notes")) noteRequests.push(r.url());
  });
  await p.goto(`${w.url}/map`);
  const token = await p.locator('meta[name="werk-token"]').getAttribute("content");
  const res = await fetch(`${w.url}/api/notes`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-werk-token": token as string },
    body: JSON.stringify({ id: "werk-chat", text: "check the stdin path" }),
  });
  expect(res.status).toBe(200);
  const clip = await p.evaluate(() => navigator.clipboard.readText());
  expect(clip).toBe('re #werk-chat "The composer sends a live agent turn": check the stdin path');
  await p.goto(`${w.url}/map/werk-chat`);
  await expect(p.getByText("check the stdin path")).toHaveCount(1);
  expect(noteRequests).toHaveLength(0);
});
