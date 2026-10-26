# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: images.spec.ts >> 24.1 pick a card from the hash menu
- Location: .werk-heldout/e2e-b/images.spec.ts:26:1

# Error details

```
Error: menu opens below the caret (menu top is not above the composer top)

expect(received).toBe(expected) // Object.is equality

Expected: true
Received: false
```

# Page snapshot

```yaml
- generic [ref=e2]:
  - region "Map pane" [ref=e3]:
    - generic [ref=e4]:
      - generic [ref=e5]:
        - button "project ▾" [ref=e8]
        - navigation "Breadcrumbs" [ref=e10]:
          - strong [ref=e13]: Home
      - generic [ref=e15]:
        - navigation "Views" [ref=e16]:
          - button "Home" [ref=e17] [cursor=pointer]
          - button "Map" [ref=e18] [cursor=pointer]
          - button "Board" [ref=e19] [cursor=pointer]
        - searchbox "Search the map" [ref=e21]
    - generic [ref=e23]:
      - article [ref=e25]:
        - region "Card" [ref=e26]:
          - button "Remove this card" [ref=e28] [cursor=pointer]: ✕
          - generic [ref=e29]:
            - button "#root" [ref=e30] [cursor=pointer]
            - generic [ref=e31]: card
            - generic [ref=e32]: open
          - heading "We build software with agents" [level=1] [ref=e33]
          - paragraph [ref=e34]: One repeating pipeline keeps the work in step.
          - img "2 open, 0 proto, 0 decided" [ref=e35]
          - paragraph [ref=e37]:
            - generic [ref=e38]: this card and everything below it, 2 cards
            - generic [ref=e39]: ● 2 open
        - generic [ref=e40]:
          - heading "Sub-cards 1" [level=2] [ref=e41]
          - 'link "Pasted screenshots #werk-shots" [ref=e43] [cursor=pointer]':
            - /url: /map/werk-shots
            - generic [ref=e44]: Pasted screenshots
            - generic [ref=e45]: "#werk-shots"
      - article [ref=e48]:
        - region "Build rules" [ref=e49]:
          - heading "Build rules" [level=2] [ref=e50]
          - paragraph [ref=e51]: This map has no build rules yet.
  - complementary "Chat pane" [ref=e52]:
    - generic [ref=e54]:
      - log "Conversation" [ref=e56]
      - generic [ref=e57]:
        - generic [ref=e59]: idle
        - generic [ref=e60]:
          - combobox "Model" [ref=e61]:
            - option "Sonnet"
            - option "Opus"
            - option "Sonnet + Opus advisor" [selected]
          - button "Context 0% full" [ref=e63] [cursor=pointer]
      - textbox "Message" [active] [ref=e65]:
        - /placeholder: Message the agent
        - text: "`#wer"
      - generic [ref=e66]:
        - button "main" [ref=e67]
        - button "New conversation" [ref=e68]: +
```

# Test source

```ts
  1   | import { spawnSync } from "node:child_process";
  2   | import { existsSync } from "node:fs";
  3   | import { basename } from "node:path";
  4   | import {
  5   |   apiUrl,
  6   |   chat,
  7   |   chips,
  8   |   composerOf,
  9   |   dropShot,
  10  |   expect,
  11  |   messages,
  12  |   pasteShot,
  13  |   PNG_BASE64,
  14  |   say,
  15  |   send,
  16  |   storedFiles,
  17  |   test,
  18  |   thumbNames,
  19  |   withChat,
  20  | } from "./common.ts";
  21  | 
  22  | const ok = { roles: { chat: { replies: [[say("m1", "Seen")], [say("m2", "Seen again")]] } } };
  23  | const thumbLoaded = (img: import("@playwright/test").Locator) =>
  24  |   expect.poll(() => img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
  25  | 
  26  | test("24.1 pick a card from the hash menu", async ({ page }) => {
  27  |   await withChat(
  28  |     undefined,
  29  |     async (server) => {
  30  |       await page.goto(server.url);
  31  |       await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  32  |       await expect(page.getByRole("region", { name: "Map pane" }).getByText("Pasted screenshots")).toBeVisible();
  33  |       const composer = composerOf(page);
  34  |       await composer.pressSequentially("Look at #wer");
  35  |       const menu = page.getByRole("listbox");
  36  |       await expect(menu).toBeVisible();
  37  |       const options = menu.getByRole("option");
  38  |       await expect(options).toHaveCount(1);
  39  |       await expect(options.first()).toContainText("#werk-shots");
  40  |       await expect(options.first()).toContainText("Pasted screenshots");
  41  |       const m = await menu.boundingBox();
  42  |       const c = await composer.boundingBox();
> 43  |       expect.soft(m && c && m.y >= c.y, "menu opens below the caret (menu top is not above the composer top)").toBe(true);
      |                                                                                                                ^ Error: menu opens below the caret (menu top is not above the composer top)
  44  |       await composer.press("ArrowDown");
  45  |       await composer.press("Enter");
  46  |       await expect(composer).toHaveValue(/^Look at #werk-shots\s?$/);
  47  |       await expect(page.getByRole("listbox")).toHaveCount(0);
  48  |       await composer.fill("`#wer");
  49  |       await expect(page.getByRole("listbox")).toHaveCount(0);
  50  |     },
  51  |     (s) => {
  52  |       expect(s.werk("add", "werk-shots", "--title", "Pasted screenshots", "--parent", "root").code).toBe(0);
  53  |       expect(s.werk("accept", "werk-shots", "--actor", "you").code).toBe(0);
  54  |     },
  55  |   );
  56  | });
  57  | 
  58  | test("24.2 a pasted PNG uploads at once and reaches the agent as a stored path", async ({ page }) => {
  59  |   await withChat(ok, async (server) => {
  60  |     // Delay the upload answer so the spinner can be seen.
  61  |     await page.route("**/image", async (route) => {
  62  |       if (route.request().method() === "POST") await new Promise((r) => setTimeout(r, 1500));
  63  |       await route.continue();
  64  |     });
  65  |     await page.goto(server.url);
  66  |     const composer = composerOf(page);
  67  |     await composer.pressSequentially("What is wrong here? ");
  68  |     await pasteShot(page);
  69  |     await expect(composer).toHaveValue("What is wrong here? [Image #1]");
  70  |     await expect(chips(page)).toContainText("[Image #1]");
  71  |     await expect(chips(page).getByRole("status", { name: "Uploading" })).toBeVisible();
  72  |     const thumb = chips(page).getByRole("img");
  73  |     await expect(thumb).toBeVisible();
  74  |     await thumbLoaded(thumb);
  75  |     await composer.press("Enter");
  76  |     await expect(chat(page).getByText("Seen")).toBeVisible();
  77  |     const [text] = messages(server);
  78  |     const path = /\[Image #1\] = (.*\.werk\/attachments\/[^\n]+\.png)/.exec(text ?? "")?.[1];
  79  |     expect(path).toBeTruthy();
  80  |     expect(text).toContain("Open each image above with Read");
  81  |     expect(storedFiles(server)).toHaveLength(1);
  82  |     expect(path).toContain(storedFiles(server)[0]);
  83  |     const status = spawnSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: server.dir, encoding: "utf8" }).stdout;
  84  |     expect(status).not.toContain("attachments");
  85  |     const ignored = spawnSync("git", ["check-ignore", "-q", `.werk/attachments/${storedFiles(server)[0]}`], { cwd: server.dir });
  86  |     expect(ignored.status).toBe(0);
  87  |   }, (s) => {
  88  |     expect(s.werk("add", "x", "--title", "x", "--parent", "root").code).toBe(0);
  89  |   });
  90  | });
  91  | 
  92  | test("24.3 an oversized image is refused and is not sent", async ({ page }) => {
  93  |   await withChat(ok, async (server) => {
  94  |     await page.goto(server.url);
  95  |     const composer = composerOf(page);
  96  |     await composer.pressSequentially("Look: ");
  97  |     await dropShot(page, { kind: "png", size: 25 * 1024 * 1024 });
  98  |     await expect(composer).toHaveValue("Look: [Image #1]");
  99  |     await expect(chips(page)).toContainText("[Image #1]");
  100 |     await expect(chips(page).getByRole("alert")).toContainText("20 MB");
  101 |     await composer.press("Enter");
  102 |     await expect(chat(page).getByText("Seen")).toBeVisible();
  103 |     const [text] = messages(server);
  104 |     expect(text).not.toContain("attachments");
  105 |     expect(text).not.toMatch(/\[Image #1\] =/);
  106 |     expect(storedFiles(server)).toEqual([]);
  107 |   });
  108 | });
  109 | 
  110 | test("24.4 removing the first of two images renumbers the second", async ({ page }) => {
  111 |   await withChat(ok, async (server) => {
  112 |     await page.goto(server.url);
  113 |     const composer = composerOf(page);
  114 |     await pasteShot(page, { kind: "png" });
  115 |     await expect(chips(page).getByRole("img")).toHaveCount(1);
  116 |     await pasteShot(page, { kind: "jpeg" });
  117 |     await expect(chips(page).getByRole("img")).toHaveCount(2);
  118 |     await expect(composer).toHaveValue("[Image #1][Image #2]");
  119 |     const names = await thumbNames(page);
  120 |     expect(names[1]).toMatch(/\.jpg$/);
  121 |     await chips(page).getByRole("button", { name: "Remove [Image #1]" }).click();
  122 |     await expect(composer).toHaveValue("[Image #1]");
  123 |     await expect(chips(page).getByRole("listitem")).toHaveCount(1);
  124 |     await expect(chips(page)).toContainText("[Image #1]");
  125 |     expect(await thumbNames(page)).toEqual([names[1]]);
  126 |     await thumbLoaded(chips(page).getByRole("img"));
  127 |     await composer.press("Enter");
  128 |     await expect(chat(page).getByText("Seen")).toBeVisible();
  129 |     const [text] = messages(server);
  130 |     expect(text).toMatch(new RegExp(`\\[Image #1\\] = .*attachments/${names[1]}`));
  131 |     expect(text).not.toContain("[Image #2]");
  132 |   });
  133 | });
  134 | 
  135 | test("24.5 a bad image request does not harm the server", async ({ page }) => {
  136 |   const start = { event: { type: "system", subtype: "init", slash_commands: ["review", "recall"] } };
  137 |   await withChat({ roles: { chat: { replies: [[start, say("m1", "Hello")]] } } }, async (server) => {
  138 |     await page.goto(server.url);
  139 |     await send(page, "hi");
  140 |     await expect(chat(page).getByText("Hello")).toBeVisible();
  141 |     const empty = await page.request.get(apiUrl(server, "/image?name="));
  142 |     expect(empty.status()).toBe(404);
  143 |     for (const name of ["../log.jsonl", "..%2Flog.jsonl", "..%2F..%2Fpackage.json", "%2e%2e%2f%2e%2e%2fpackage.json", "/etc/passwd"]) {
```