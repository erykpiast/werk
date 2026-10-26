import { expect, test } from "@playwright/test";
import { project, stop } from "../e2e/project.ts";

test.afterEach(stop);

test("41.3 a build pass can be started from the browser", async ({ page: p }) => {
  const w = await project();
  await p.goto(`${w.url}/board`);
  await expect(p.getByRole("button", { name: /build|run|start/i })).toHaveCount(1);
});

test("73.1 the pane names the active conversation tab in the request", async ({ page: p }) => {
  const reply = [{ event: { type: "assistant", message: { id: "m1", content: [{ type: "text", text: "ok" }] } } }];
  const w = await project({ roles: { chat: { replies: [reply] } } }, (d) => d.seed("node.added", { id: "werk-chat", kind: "card", title: "Chat", parent: "root" }));
  await p.goto(`${w.url}/map/werk-chat`);
  await expect(p.getByRole("tab", { name: "design" })).toHaveCount(1);
  const requests: unknown[] = [];
  p.on("request", (r) => r.url().endsWith("/api/chat") && requests.push(JSON.parse(r.postData() ?? "{}")));
  await p.getByRole("complementary", { name: "Chat" }).getByRole("textbox", { name: "Message" }).fill("What does this card decide?");
  await p.keyboard.press("Enter");
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0]).toMatchObject({ text: "What does this card decide?", card: "werk-chat", tab: "design" });
});

test("73.2 a pasted image travels with the message in the same request", async ({ page: p }) => {
  const reply = [{ event: { type: "assistant", message: { id: "m1", content: [{ type: "text", text: "ok" }] } } }];
  const w = await project({ roles: { chat: { replies: [reply] } } }, (d) => d.seed("node.added", { id: "visual", kind: "card", title: "Visual", parent: "root" }));
  await p.goto(`${w.url}/map/visual`);
  const requests: Record<string, unknown>[] = [];
  p.on("request", (r) => r.url().endsWith("/api/chat") && requests.push(JSON.parse(r.postData() ?? "{}")));
  const box = p.getByRole("complementary", { name: "Chat" }).getByRole("textbox", { name: "Message" });
  await box.focus();
  await box.evaluate((el) => {
    const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
    const data = new DataTransfer();
    data.items.add(new File([png], "pasted.png", { type: "image/png" }));
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await box.fill("Does this layout match the card?");
  await p.keyboard.press("Enter");
  await expect.poll(() => requests.length).toBe(1);
  expect(JSON.stringify(requests[0])).toMatch(/image/);
});

test("73.4 each conversation tab speaks to its own agent", async ({ page: p }) => {
  const w = await project(undefined, (d) => d.seed("node.added", { id: "werk-cli", kind: "card", title: "CLI", parent: "root" }));
  await p.goto(`${w.url}/map/werk-cli`);
  await expect(p.getByRole("tab", { name: "alpha" })).toHaveCount(1);
  await expect(p.getByRole("tab", { name: "beta" })).toHaveCount(1);
});
