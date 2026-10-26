# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: heldout-23.spec.ts >> 23.2 switching to a tab shows its newest message
- Location: .werk-heldout/heldout-23.spec.ts:51:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('complementary', { name: 'Chat pane' }).locator('[role=tablist], [data-slot=tab-strip], [data-slot=chat-tabs]')
Expected: visible
Timeout: 3000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" getByRole('complementary', { name: 'Chat pane' }).locator('[role=tablist], [data-slot=tab-strip], [data-slot=chat-tabs]') with timeout 3000ms
  - waiting for getByRole('complementary', { name: 'Chat pane' }).locator('[role=tablist], [data-slot=tab-strip], [data-slot=chat-tabs]')

```

```yaml
- region "Map pane":
  - button "project ▾"
  - navigation "Breadcrumbs":
    - strong: We build software with agents
  - navigation "Views":
    - button "Map"
    - button "Board"
  - searchbox "Search the map"
  - article:
    - region "Card":
      - button "Remove this card": ✕
      - button "#root"
      - text: card open
      - heading "We build software with agents" [level=1]
      - paragraph: One repeating pipeline keeps the work in step.
- complementary "Chat pane":
  - log "Conversation":
    - article:
      - text: Hello
      - paragraph: First tab reply
      - text: 0s
  - text: idle
  - combobox "Model":
    - option "Sonnet"
    - option "Opus"
    - option "Sonnet + Opus advisor" [selected]
  - button "Context 0% full"
  - textbox "Message":
    - /placeholder: Message the agent
```

# Test source

```ts
  1   | import { expect, test } from "@playwright/test";
  2   | import type { Page } from "@playwright/test";
  3   | import type { Script } from "../src/fake-agent/script.ts";
  4   | import { type BrowserServer, startBrowserServer } from "../e2e/support/server.ts";
  5   | 
  6   | const say = (id: string, text: string) => ({
  7   |   event: { type: "assistant", message: { id, content: [{ type: "text", text }] } },
  8   | });
  9   | 
  10  | async function withChat(script: Script, body: (s: BrowserServer) => Promise<void>) {
  11  |   const server = await startBrowserServer({ script });
  12  |   await server.start();
  13  |   try {
  14  |     await body(server);
  15  |   } finally {
  16  |     await server.dispose();
  17  |   }
  18  | }
  19  | const chat = (page: Page) => page.getByRole("complementary", { name: "Chat pane" });
  20  | async function send(page: Page, text: string) {
  21  |   const composer = page.getByRole("textbox", { name: "Message" });
  22  |   await composer.fill(text);
  23  |   await composer.press("Enter");
  24  | }
  25  | /** The tab strip below the composer: one chip for each conversation. */
  26  | const strip = (page: Page) => chat(page).locator('[role=tablist], [data-slot=tab-strip], [data-slot=chat-tabs]');
  27  | const chips = (page: Page) => strip(page).locator('[role=tab], [data-slot=tab-chip], button');
  28  | const SHORT = { timeout: 3000 };
  29  | 
  30  | const two = (a: string, b: string): Script => ({
  31  |   roles: { chat: { replies: [[say("a1", a)], [say("b1", b)]] } },
  32  | });
  33  | 
  34  | test("23.1 two conversations with different home cards stay apart", async ({ page }) => {
  35  |   await withChat(two("Reply for A", "Reply for B"), async (server) => {
  36  |     server.werk("add", "card-a", "--title", "Card A", "--parent", "root");
  37  |     server.werk("accept", "card-a", "--actor", "you");
  38  |     server.werk("add", "card-b", "--title", "Card B", "--parent", "root");
  39  |     server.werk("accept", "card-b", "--actor", "you");
  40  |     await page.goto(`${server.url}/map/card-a`);
  41  |     await expect(page.getByRole("heading", { level: 1, name: "Card A" })).toBeVisible();
  42  |     // starting a second conversation needs a control for it
  43  |     await expect(chat(page).getByRole("button", { name: /new (conversation|chat)|\+/i })).toBeVisible(SHORT);
  44  |     await send(page, "Message A");
  45  |     await expect(chat(page).getByText("Reply for A")).toBeVisible();
  46  |     await expect(chips(page)).toHaveCount(2, SHORT);
  47  |     await expect(strip(page)).toContainText("Card A", SHORT);
  48  |   });
  49  | });
  50  | 
  51  | test("23.2 switching to a tab shows its newest message", async ({ page }) => {
  52  |   await withChat(two("First tab reply", "Second tab reply"), async (server) => {
  53  |     await page.goto(server.url);
  54  |     await send(page, "Hello");
  55  |     await expect(chat(page).getByText("First tab reply")).toBeVisible();
> 56  |     await expect(strip(page)).toBeVisible(SHORT);
      |                               ^ Error: expect(locator).toBeVisible() failed
  57  |     await expect(chips(page)).toHaveCount(2, SHORT);
  58  |   });
  59  | });
  60  | 
  61  | test("23.3 a crashed agent marks its tab and tells the other tabs", async ({ page }) => {
  62  |   await withChat(
  63  |     { roles: { chat: { replies: [[say("a1", "Hi A")], [{ stderr: "boom A" }, { crash: 1 }], [{ stderr: "boom A" }, { crash: 1 }]] } } },
  64  |     async (server) => {
  65  |       await page.goto(server.url);
  66  |       await send(page, "Hello");
  67  |       await expect(chat(page).getByText("Hi A")).toBeVisible();
  68  |       await send(page, "Crash now");
  69  |       await expect(chat(page).getByText("boom A").first()).toBeVisible();
  70  |       // the chip of the tab blinks red
  71  |       await expect(strip(page).locator('[data-state=dead], [data-dead], .blink-red, [data-blink=red]')).toHaveCount(1, SHORT);
  72  |     },
  73  |   );
  74  | });
  75  | 
  76  | test("23.4 a model switch is not a crash", async ({ page }) => {
  77  |   await withChat(two("Working", "Still working"), async (server) => {
  78  |     await page.goto(server.url);
  79  |     await send(page, "Hello");
  80  |     await expect(chat(page).getByText("Working")).toBeVisible();
  81  |     await chat(page).getByLabel("Model").selectOption({ label: "Opus" });
  82  |     // the chip of the tab exists and does not blink red
  83  |     await expect(chips(page)).toHaveCount(1, SHORT);
  84  |     await send(page, "Again");
  85  |     await expect(chat(page).getByText("Still working")).toBeVisible();
  86  |     await expect(chat(page).getByText(/exited|not delivered/)).toHaveCount(0);
  87  |   });
  88  | });
  89  | 
  90  | test("23.5 a running background agent and a suggested next action", async ({ page }) => {
  91  |   const list = (ids: string[]) => ({
  92  |     event: { type: "system", subtype: "background_tasks", tasks: ids.map((id) => ({ id })) },
  93  |   });
  94  |   await withChat(
  95  |     {
  96  |       roles: {
  97  |         chat: {
  98  |           replies: [
  99  |             [list(["a"]), say("m1", "Started"), { pause: 3000 }, list([]), say("m1b", 'Done.\n\nNext: say "merge it"')],
  100 |             [say("m2", "Merged it")],
  101 |           ],
  102 |         },
  103 |       },
  104 |     },
  105 |     async (server) => {
  106 |       await page.goto(server.url);
  107 |       await send(page, "Go");
  108 |       const line = chat(page).getByText("A background agent runs");
  109 |       await expect(line).toBeVisible();
  110 |       // the tab counts as running
  111 |       await expect.soft(strip(page).locator('[data-running], [data-state=running]')).toHaveCount(1, SHORT);
  112 |       await expect(line).toHaveCount(0, { timeout: 10000 });
  113 |       await expect.soft(strip(page).locator('[data-running], [data-state=running]')).toHaveCount(0, SHORT);
  114 |       const offer = chat(page).getByRole("button", { name: "merge it" });
  115 |       await expect(offer).toBeVisible();
  116 |       await offer.click();
  117 |       await expect(chat(page).getByText("Merged it")).toBeVisible();
  118 |       await expect(offer).toHaveCount(0);
  119 |     },
  120 |   );
  121 | });
  122 | 
```