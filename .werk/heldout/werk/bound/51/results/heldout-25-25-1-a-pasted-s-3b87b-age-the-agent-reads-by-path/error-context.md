# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: heldout-25.spec.ts >> 25.1 a pasted screenshot becomes a numbered image the agent reads by path
- Location: .werk-heldout/heldout-25.spec.ts:10:1

# Error details

```
Error: the chat shows the image under [Image #1]

expect(locator).toBeVisible() failed

Locator: getByRole('complementary', { name: 'Chat pane' }).getByRole('img')
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - the chat shows the image under [Image #1] getByRole('complementary', { name: 'Chat pane' }).getByRole('img') with timeout 5000ms
  - waiting for getByRole('complementary', { name: 'Chat pane' }).getByRole('img')

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
      - text: "[Image #1] Why is this red?"
      - paragraph: Seen
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
  1   | import { existsSync, readdirSync } from "node:fs";
  2   | import { join } from "node:path";
  3   | import { expect, test } from "../e2e/support/fixtures.ts";
  4   | import { chat, composerOf, messages, putImage, say, withChat } from "./heldout-img-support.ts";
  5   | 
  6   | const chips = (page: import("@playwright/test").Page) => page.getByRole("list", { name: "Attached images" });
  7   | const projectOf = (url: string) => new URL(url).pathname.split("/")[2] as string;
  8   | const reply = { roles: { chat: { replies: [[say("m1", "Seen")]] } } };
  9   | 
  10  | test("25.1 a pasted screenshot becomes a numbered image the agent reads by path", async ({ page }) => {
  11  |   let release: () => void = () => {};
  12  |   const gate = new Promise<void>((r) => (release = r));
  13  |   await withChat(reply, async (server) => {
  14  |     await page.route("**/image", async (route) => {
  15  |       if (route.request().method() === "POST") await gate;
  16  |       await route.continue();
  17  |     });
  18  |     await page.goto(server.url);
  19  |     await putImage(page);
  20  |     await expect(chips(page).locator('[data-slot="image-chip"][data-state="uploading"]')).toHaveCount(1);
  21  |     await expect(composerOf(page)).toHaveValue("[Image #1]");
  22  |     release();
  23  |     const thumb = chips(page).getByRole("img");
  24  |     await expect(thumb).toBeVisible();
  25  |     await expect(chips(page)).toContainText("[Image #1]");
  26  |     const composer = composerOf(page);
  27  |     await composer.pressSequentially(" Why is this red?");
  28  |     await composer.press("Enter");
  29  |     await expect(chat(page).getByText("Seen")).toBeVisible();
> 30  |     await expect.soft(chat(page).getByRole("img"), "the chat shows the image under [Image #1]").toBeVisible();
      |                                                                                                 ^ Error: the chat shows the image under [Image #1]
  31  |     await expect(chat(page)).toContainText("[Image #1]");
  32  |     const [text] = messages(server);
  33  |     expect(text).toMatch(/\[Image #1\] = .*\.werk\/attachments\/.+\.png/);
  34  |     expect(text).toContain("Open each image above with Read");
  35  |     expect(text).not.toContain("iVBORw0KGgo");
  36  |   });
  37  | });
  38  | 
  39  | test("25.2 an oversized image shows its refusal and is not sent", async ({ page }) => {
  40  |   await withChat(reply, async (server) => {
  41  |     await page.goto(server.url);
  42  |     await putImage(page, { bytes: 2 * 1024 * 1024 });
  43  |     await putImage(page, { bytes: 25 * 1024 * 1024 });
  44  |     const items = chips(page).locator('[data-slot="image-chip"]');
  45  |     await expect(items).toHaveCount(2);
  46  |     await expect(items.nth(0).getByRole("img")).toBeVisible();
  47  |     await expect(items.nth(0)).toContainText("[Image #1]");
  48  |     await expect(items.nth(1).getByRole("alert")).toContainText("20 MB");
  49  |     await chips(page).getByRole("button", { name: "Remove [Image #2]" }).click();
  50  |     await expect(composerOf(page)).not.toHaveValue(/Image #2/);
  51  |     const composer = composerOf(page);
  52  |     await composer.pressSequentially(" Why is this red?");
  53  |     await composer.press("Enter");
  54  |     await expect(chat(page).getByText("Seen")).toBeVisible();
  55  |     const [text] = messages(server);
  56  |     expect(text).toMatch(/\[Image #1\] = .*\.werk\/attachments\//);
  57  |     expect(text).not.toContain("[Image #2]");
  58  |     const dir = join(server.dir, ".werk", "attachments");
  59  |     expect(readdirSync(dir).filter((n) => n.endsWith(".png")).length).toBe(1);
  60  |   });
  61  | });
  62  | 
  63  | test("25.3 removing a chip renumbers the remaining images", async ({ page }) => {
  64  |   await withChat(reply, async (server) => {
  65  |     await page.goto(server.url);
  66  |     await putImage(page);
  67  |     await putImage(page);
  68  |     await expect(composerOf(page)).toHaveValue("[Image #1][Image #2]");
  69  |     await expect(chips(page).getByRole("img")).toHaveCount(2);
  70  |     await chips(page).getByRole("button", { name: "Remove [Image #1]" }).click();
  71  |     await expect(composerOf(page)).toHaveValue("[Image #1]");
  72  |     await expect(chips(page).locator('[data-slot="image-chip"]')).toHaveCount(1);
  73  |     await expect(chips(page)).toContainText("[Image #1]");
  74  |     await expect(chips(page)).not.toContainText("[Image #2]");
  75  |     await composerOf(page).press("Enter");
  76  |     await expect(chat(page).getByText("Seen")).toBeVisible();
  77  |     const [text] = messages(server);
  78  |     expect(text).toMatch(/\[Image #1\] = .*\.werk\/attachments\//);
  79  |     expect(text).not.toContain("[Image #2]");
  80  |   });
  81  | });
  82  | 
  83  | test("25.4 Enter waits for a running upload", async ({ page }) => {
  84  |   let release: () => void = () => {};
  85  |   const gate = new Promise<void>((r) => (release = r));
  86  |   await withChat(reply, async (server) => {
  87  |     await page.route("**/image", async (route) => {
  88  |       if (route.request().method() === "POST") await gate;
  89  |       await route.continue();
  90  |     });
  91  |     await page.goto(server.url);
  92  |     await putImage(page);
  93  |     await expect(chips(page).locator('[data-state="uploading"]')).toHaveCount(1);
  94  |     const composer = composerOf(page);
  95  |     await composer.pressSequentially(" what is this?");
  96  |     await composer.press("Enter");
  97  |     await expect(chat(page).getByText("Seen")).toHaveCount(0);
  98  |     expect(messages(server)).toHaveLength(0);
  99  |     release();
  100 |     await expect(chat(page).getByText("Seen")).toBeVisible();
  101 |     const [text] = messages(server);
  102 |     expect(text).toMatch(/\[Image #1\] = .*\.werk\/attachments\/.+\.png/);
  103 |   });
  104 | });
  105 | 
  106 | test("25.5 a request for an image with no name answers 404 and the server stays up", async ({ page }) => {
  107 |   await withChat(reply, async (server) => {
  108 |     await page.goto(server.url);
  109 |     await putImage(page);
  110 |     await expect(chips(page).getByRole("img")).toBeVisible();
  111 |     await composerOf(page).press("Enter"); // stored screenshot
  112 |     await expect(chat(page).getByText("Seen")).toBeVisible();
  113 |     expect(readdirSync(join(server.dir, ".werk", "attachments")).filter((n) => n.endsWith(".png")).length).toBe(1);
  114 |     const base = `${server.origin}/api/projects/${projectOf(server.url)}/image`;
  115 |     const get = (q: string) => page.evaluate((u) => fetch(u).then((r) => r.status), `${base}${q}`);
  116 |     expect(await get("?name=")).toBe(404);
  117 |     expect(await get("?name=..%2F..%2Flog.jsonl")).toBe(404);
  118 |     expect(await get("?name=..%2F..%2F..%2Fpackage.json")).toBe(404);
  119 |     await putImage(page);
  120 |     await expect(chips(page).getByRole("img")).toBeVisible();
  121 |     await composerOf(page).pressSequentially(" again");
  122 |     await composerOf(page).press("Enter");
  123 |     await expect(chat(page).getByText("Seen").first()).toBeVisible();
  124 |   });
  125 | });
  126 | 
```