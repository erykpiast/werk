import { expect, type Page, test } from "@playwright/test";
import { open } from "../src/map/mark-fixtures.ts";
import { served } from "./server.ts";

const say = (id: string, text: string) => ({
  event: { type: "assistant", message: { id, content: [{ type: "text", text }] } },
});
const composer = (page: Page) => page.getByRole("textbox", { name: "Message" });
const send = async (page: Page, text: string) => {
  await composer(page).fill(text);
  await composer(page).press("Enter");
};
const chipStrip = (page: Page) => page.getByRole("tablist", { name: /conversations|tabs/i });
const chip = (page: Page, title: string) => chipStrip(page).getByRole("tab", { name: title });
const mapPane = (page: Page) => page.getByRole("region", { name: "Map pane" });

async function twoTabs(page: Page, script: Parameters<typeof served>[0]) {
  const s = await served(script);
  s.append(...open("a", { title: "Card A", parent: "root" }), ...open("b", { title: "Card B", parent: "root" }));
  return s;
}

test("23.1 two conversations with different home cards stay apart", async ({ page }) => {
  const s = await twoTabs(page, {
    script: { roles: { chat: { replies: [[say("1", "Reply for A")], [say("2", "Reply for B")]] } } },
  });
  try {
    await page.goto(`${s.url}/map/a`);
    await send(page, "message in A");
    await page.goto(`${s.url}/map/b`);
    await page.getByRole("button", { name: /new conversation/i }).click();
    await send(page, "message in B");
    await expect(chipStrip(page).getByRole("tab")).toHaveCount(2);
    await expect(chip(page, "Card A")).toBeVisible();
    await expect(chip(page, "Card B")).toBeVisible();
    await chip(page, "Card A").click();
    await expect(page.getByRole("log", { name: "Conversation" })).toContainText("message in A");
    await expect(page.getByRole("log", { name: "Conversation" })).not.toContainText("message in B");
  } finally {
    await s.dispose();
  }
});

test("23.2 switching to a tab shows its newest message", async ({ page }) => {
  const long = Array.from({ length: 30 }, (_, i) => say(`m${i}`, `line ${i}`));
  const s = await twoTabs(page, { script: { roles: { chat: { replies: [long, [say("z", "newest reply")]] } } } });
  try {
    await page.goto(`${s.url}/map/a`);
    await send(page, "first");
    await chip(page, "Card A").click();
    await chip(page, "Card B").click();
    const scroller = page.locator("[data-slot=chat-scroll]");
    await expect.poll(() => scroller.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThan(5);
  } finally {
    await s.dispose();
  }
});

test("23.3 a crashed agent marks its tab and tells the other tabs", async ({ page }) => {
  const s = await twoTabs(page, { script: { roles: { chat: { replies: [[say("1", "ok"), { crash: 1 }]] } } } });
  try {
    await page.goto(`${s.url}/map/a`);
    await send(page, "go");
    await expect(chip(page, "Card A")).toHaveAttribute("data-state", /dead|crash|red/);
    await chip(page, "Card B").click();
    await expect(page.getByRole("complementary", { name: "Chat pane" })).toContainText("Card A");
  } finally {
    await s.dispose();
  }
});

test("23.4 a model switch is not a crash", async ({ page }) => {
  const s = await twoTabs(page, { script: { roles: { chat: { replies: [[say("1", "one")], [say("2", "two")]] } } } });
  try {
    await page.goto(`${s.url}/map/a`);
    await send(page, "first");
    await expect(page.getByRole("log", { name: "Conversation" })).toContainText("one");
    await page.getByRole("combobox", { name: /model/i }).selectOption({ label: "Opus" });
    await expect(chip(page, "Card A")).not.toHaveAttribute("data-state", /dead|crash|red/);
    await send(page, "second");
    await expect(page.getByRole("log", { name: "Conversation" })).toContainText("two");
  } finally {
    await s.dispose();
  }
});

test("23.5 a running background agent and a suggested next action", async ({ page }) => {
  const s = await served({
    script: {
      roles: {
        chat: {
          replies: [
            [
              {
                event: {
                  type: "assistant",
                  message: {
                    id: "t1",
                    content: [{ type: "tool_use", id: "u1", name: "Task", input: { description: "scan", prompt: "scan", run_in_background: true } }],
                  },
                },
              },
              say("t2", "Started it.\nNext: say \"merge it\""),
            ],
            [say("t3", "Merging now")],
          ],
        },
      },
    },
  });
  try {
    await page.goto(s.url);
    await send(page, "go on");
    await expect(page.getByText(/background/i).first()).toBeVisible();
    const button = page.getByRole("button", { name: "merge it" });
    await expect(button).toBeVisible();
    await button.click();
    await expect(page.getByRole("log", { name: "Conversation" })).toContainText("merge it");
    await expect(page.getByRole("log", { name: "Conversation" })).toContainText("Merging now");
    await expect(button).toBeHidden();
  } finally {
    await s.dispose();
  }
});
