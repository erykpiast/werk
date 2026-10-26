import { expect, type Page, test } from "@playwright/test";
import type { Script } from "../../src/fake-agent/script.ts";
import { type Srv, startServer } from "../server.ts";

const say = (id: string, text: string) => ({
  event: { type: "assistant", message: { id, content: [{ type: "text", text }] } },
});
const list = (ids: string[]) => ({ event: { type: "system", subtype: "background_tasks", tasks: ids.map((id) => ({ id })) } });

async function withChat(script: Script, body: (s: Srv) => Promise<void>) {
  const s = await startServer({ script });
  await s.start();
  try {
    await body(s);
  } finally {
    await s.dispose();
  }
}
const chat = (page: Page) => page.getByRole("complementary", { name: "Chat pane" });
const composer = (page: Page) => page.getByRole("textbox", { name: "Message" });
async function send(page: Page, text: string) {
  await composer(page).fill(text);
  await composer(page).press("Enter");
}
const messages = (s: Srv) => s.launches().flatMap((r) => (r.kind === "message" ? [r.text] : []));
const cardOf = (id: string, title: string) => [
  { type: "node.proposed", id, kind: "card", title, status: "open", parent: "root" },
  { type: "node.accepted", id, actor: "you" },
];
/** The tab strip below the composer: one chip for each conversation. */
const chips = (page: Page) => chat(page).getByRole("tab");
const project = async (s: Srv) => ((await (await fetch(`${s.origin}/api/projects`)).json()).projects as any[]).find((p) => p.folder.endsWith("/project")) ?? null;

test("23.1 two conversations with different home cards stay apart", async ({ page }) => {
  const script: Script = { roles: { chat: { replies: [[say("a1", "Reply for A")], [say("b1", "Reply for B")]] } } };
  await withChat(script, async (s) => {
    s.appendLog(cardOf("a", "Card A"), cardOf("b", "Card B"));
    await page.goto(`${s.url}/map/a`);
    await send(page, "message in A");
    await expect(chat(page).getByText("Reply for A")).toBeVisible();
    await page.goto(`${s.url}/map/b`);
    await send(page, "message in B");
    await expect(chat(page).getByText("Reply for B")).toBeVisible();
    await expect(chips(page)).toHaveCount(2);
    await expect(chips(page).nth(0)).toContainText("Card A");
    await expect(chips(page).nth(1)).toContainText("Card B");
  });
});

test("23.2 switching to a tab shows its newest message", async ({ page }) => {
  const script: Script = { roles: { chat: { replies: [[say("a1", "A reply")], [say("b1", "B reply")]] } } };
  await withChat(script, async (s) => {
    s.appendLog(cardOf("a", "Card A"), cardOf("b", "Card B"));
    await page.goto(`${s.url}/map/a`);
    await send(page, "in A");
    await expect(chat(page).getByText("A reply")).toBeVisible();
    await page.goto(`${s.url}/map/b`);
    await send(page, "in B");
    await expect(chips(page)).toHaveCount(2);
    await chips(page).nth(1).click();
    const log = chat(page).locator("[data-slot=chat-scroll]");
    await expect.poll(() => log.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThan(4);
  });
});

test("23.3 a crashed agent marks its tab and tells the other tabs", async ({ page }) => {
  const script: Script = {
    roles: { chat: { replies: [[say("a1", "A reply")], [say("b1", "B reply")], [{ stderr: "tab A died: out of memory" }, { crash: 1 }]] } },
  };
  await withChat(script, async (s) => {
    s.appendLog(cardOf("a", "Card A"), cardOf("b", "Card B"));
    await page.goto(`${s.url}/map/a`);
    await send(page, "in A");
    await expect(chat(page).getByText("A reply")).toBeVisible();
    await page.goto(`${s.url}/map/b`);
    await send(page, "in B");
    await expect(chips(page)).toHaveCount(2);
    await expect(chips(page).nth(0)).toHaveAttribute("data-state", /dead|red|crash/);
  });
});

test("23.4 a model switch is not a crash", async ({ page }) => {
  const script: Script = { roles: { chat: { replies: [[say("a1", "A reply")], [say("a2", "After switch")]] } } };
  await withChat(script, async (s) => {
    await page.goto(s.url);
    await send(page, "hello");
    await expect(chat(page).getByText("A reply")).toBeVisible();
    // the conversation sits in a tab
    await expect(chips(page)).toHaveCount(1);
    await chat(page).getByLabel("Model").selectOption("opus");
    await expect(chips(page).first()).not.toHaveAttribute("data-state", /dead|red|crash/);
    await expect(chat(page).getByText(/died|crash|exited/i)).toHaveCount(0);
    await send(page, "again");
    await expect(chat(page).getByText("After switch")).toBeVisible({ timeout: 20000 });
  });
});

test("23.5 a running background agent and a suggested next action", async ({ page }) => {
  const script: Script = {
    roles: {
      chat: {
        replies: [
          [list(["bg1"]), say("m1", "Started a task")],
          [list([]), say("m2", 'All done.\n\nNext: say "merge it"')],
          [say("m3", "Merged")],
        ],
      },
    },
  };
  await withChat(script, async (s) => {
    await page.goto(s.url);
    await send(page, "start it");
    const line = chat(page).getByText("A background agent runs");
    await expect(line).toBeVisible();
    // the conversation counts as running: the switcher marks its row busy
    await page.getByRole("button", { name: /project/ }).first().click();
    const row = page.locator("[data-slot=switcher-row]", { hasText: "project" }).filter({ hasText: "/project" }).first();
    await expect(row).toHaveAttribute("data-busy", "true", { timeout: 10000 });
    await send(page, "status?");
    await expect(line).toHaveCount(0);
    await expect(row).not.toHaveAttribute("data-busy", "true", { timeout: 10000 });
    const offer = chat(page).getByRole("button", { name: "merge it" });
    await expect(offer).toBeVisible();
    await offer.click();
    await expect(chat(page).locator("article").filter({ hasText: "merge it" }).first()).toBeVisible();
    await expect(chat(page).getByText("Merged")).toBeVisible();
    await expect(offer).toHaveCount(0);
    expect(messages(s).at(-1)).toMatch(/merge it$/);
  });
});
