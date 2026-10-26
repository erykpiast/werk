# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: heldout-24.spec.ts >> 24.1 pick a card from the hash menu
- Location: .werk-heldout/heldout-24.spec.ts:10:1

# Error details

```
Error: the menu opens below the caret

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
          - strong [ref=e13]: We build software with agents
      - generic [ref=e14]:
        - generic [ref=e16]:
          - generic "2 cards in the whole map" [ref=e17]: "2"
          - generic "2 open" [ref=e18]: "2"
        - generic [ref=e19]:
          - navigation "Views" [ref=e20]:
            - button "Map" [ref=e21] [cursor=pointer]
            - button "Board" [ref=e22] [cursor=pointer]
          - searchbox "Search the map" [ref=e24]
    - article [ref=e26]:
      - region "Card" [ref=e27]:
        - button "Remove this card" [ref=e29] [cursor=pointer]: ✕
        - generic [ref=e30]:
          - button "#root" [ref=e31] [cursor=pointer]
          - generic [ref=e32]: card
          - generic [ref=e33]: open
        - heading "We build software with agents" [level=1] [ref=e34]
        - paragraph [ref=e35]: One repeating pipeline keeps the work in step.
        - img "2 open, 0 proto, 0 decided" [ref=e36]
        - paragraph [ref=e38]:
          - generic [ref=e39]: this card and everything below it, 2 cards
          - generic [ref=e40]: ● 2 open
      - generic [ref=e41]:
        - heading "Sub-cards 1" [level=2] [ref=e42]
        - 'link "Pasted screenshots #werk-shots" [ref=e44] [cursor=pointer]':
          - /url: /map/werk-shots
          - generic [ref=e45]: Pasted screenshots
          - generic [ref=e46]: "#werk-shots"
  - complementary "Chat pane" [ref=e48]:
    - generic [ref=e50]:
      - log "Conversation" [ref=e52]
      - generic [ref=e53]:
        - generic [ref=e55]: idle
        - generic [ref=e56]:
          - combobox "Model" [ref=e57]:
            - option "Sonnet"
            - option "Opus"
            - option "Sonnet + Opus advisor" [selected]
          - button "Context 0% full" [ref=e59] [cursor=pointer]
      - textbox "Message" [active] [ref=e61]:
        - /placeholder: Message the agent
        - text: "`#wer"
```

# Test source

```ts
  1   | import { existsSync, readdirSync } from "node:fs";
  2   | import { join } from "node:path";
  3   | import { spawnSync } from "node:child_process";
  4   | import { expect, test } from "../e2e/support/fixtures.ts";
  5   | import { JPEG_BASE64, chat, composerOf, messages, putImage, say, withChat } from "./heldout-img-support.ts";
  6   | 
  7   | const chips = (page: import("@playwright/test").Page) => page.getByRole("list", { name: "Attached images" });
  8   | const projectOf = (url: string) => new URL(url).pathname.split("/")[2] as string;
  9   | 
  10  | test("24.1 pick a card from the hash menu", async ({ page, app }) => {
  11  |   expect(app.werk("add", "werk-shots", "--title", "Pasted screenshots", "--parent", "root").code).toBe(0);
  12  |   expect(app.werk("accept", "werk-shots", "--actor", "you").code).toBe(0);
  13  |   await page.goto(app.url);
  14  |   const composer = composerOf(page);
  15  |   await composer.click();
  16  |   await composer.pressSequentially("Look at #wer");
  17  |   const menu = page.getByRole("listbox");
  18  |   await expect(menu).toBeVisible();
  19  |   const opt = menu.getByRole("option").filter({ hasText: "werk-shots" });
  20  |   await expect(opt).toContainText("Pasted screenshots");
  21  |   // the menu opens below the caret
  22  |   const mb = await menu.boundingBox();
  23  |   const cb = await composer.boundingBox();
> 24  |   expect.soft(mb && cb && mb.y >= cb.y, "the menu opens below the caret").toBe(true);
      |                                                                           ^ Error: the menu opens below the caret
  25  |   // arrow keys to werk-shots, then Enter
  26  |   const options = menu.getByRole("option");
  27  |   const n = await options.count();
  28  |   for (let i = 0; i < n; i++) {
  29  |     if ((await options.nth(i).getAttribute("aria-selected")) === "true" &&
  30  |         (await options.nth(i).innerText()).includes("werk-shots")) break;
  31  |     await composer.press("ArrowDown");
  32  |   }
  33  |   await composer.press("Enter");
  34  |   await expect(composer).toHaveValue(/^Look at #werk-shots\s?$/);
  35  |   await expect(page.getByRole("listbox")).toHaveCount(0);
  36  |   await composer.fill("`#wer");
  37  |   await expect(page.getByRole("listbox")).toHaveCount(0);
  38  | });
  39  | 
  40  | test("24.2 a pasted PNG uploads at once and reaches the agent as a stored path", async ({ page }) => {
  41  |   await withChat({ roles: { chat: { replies: [[say("m1", "Seen")]] } } }, async (server) => {
  42  |     await page.goto(server.url);
  43  |     const composer = composerOf(page);
  44  |     await composer.click();
  45  |     await composer.pressSequentially("What is wrong here? ");
  46  |     await putImage(page);
  47  |     await expect(composer).toHaveValue("What is wrong here? [Image #1]");
  48  |     await expect(chips(page)).toContainText("[Image #1]");
  49  |     const thumb = chips(page).getByRole("img");
  50  |     await expect(thumb).toBeVisible();
  51  |     await expect.poll(() => thumb.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
  52  |     await composer.press("Enter");
  53  |     await expect(chat(page).getByText("Seen")).toBeVisible();
  54  |     const [text] = messages(server);
  55  |     expect(text).toMatch(/\[Image #1\] = .*\.werk\/attachments\/.+\.png/);
  56  |     expect(text).toMatch(/open (each|that|the) image/i);
  57  |     const status = spawnSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: server.dir, encoding: "utf8" }).stdout;
  58  |     expect(existsSync(join(server.dir, ".werk", "attachments"))).toBe(true);
  59  |     expect(status).not.toContain("attachments");
  60  |   });
  61  | });
  62  | 
  63  | test("24.3 an oversized image is refused and not sent", async ({ page }) => {
  64  |   await withChat({ roles: { chat: { replies: [[say("m1", "Ok")]] } } }, async (server) => {
  65  |     await page.goto(server.url);
  66  |     await putImage(page, { bytes: 25 * 1024 * 1024, how: "drop" });
  67  |     await expect(composerOf(page)).toHaveValue("[Image #1]");
  68  |     await expect(chips(page)).toContainText("[Image #1]");
  69  |     await expect(chips(page).getByRole("alert")).toContainText("20 MB");
  70  |     await composerOf(page).press("Enter");
  71  |     // Whatever turn the agent gets, it carries no path for the refused image.
  72  |     for (const text of messages(server)) {
  73  |       expect(text).not.toMatch(/\[Image #1\] =/);
  74  |       expect(text).not.toContain(".werk/attachments");
  75  |     }
  76  |     const dir = join(server.dir, ".werk", "attachments");
  77  |     expect(existsSync(dir) ? readdirSync(dir).filter((n) => !n.startsWith(".")).length : 0).toBe(0);
  78  |   });
  79  | });
  80  | 
  81  | test("24.4 removing the first of two images renumbers the second", async ({ page }) => {
  82  |   await withChat({ roles: { chat: { replies: [[say("m1", "Seen")]] } } }, async (server) => {
  83  |     await page.goto(server.url);
  84  |     await putImage(page, { name: "a.png", type: "image/png" });
  85  |     await putImage(page, { name: "b.jpg", type: "image/jpeg", base64: JPEG_BASE64 });
  86  |     await expect(composerOf(page)).toHaveValue("[Image #1][Image #2]");
  87  |     await expect(chips(page).getByRole("img")).toHaveCount(2);
  88  |     await chips(page).getByRole("button", { name: "Remove [Image #1]" }).click();
  89  |     await expect(composerOf(page)).toHaveValue("[Image #1]");
  90  |     await expect(chips(page).getByRole("img")).toHaveCount(1);
  91  |     await composerOf(page).press("Enter");
  92  |     await expect(chat(page).getByText("Seen")).toBeVisible();
  93  |     const [text] = messages(server);
  94  |     expect(text).toMatch(/\[Image #1\] = .*\.werk\/attachments\/.+/);
  95  |     expect(text).not.toContain("[Image #2]");
  96  |     expect(text).toMatch(/\.jpe?g/);
  97  |   });
  98  | });
  99  | 
  100 | test("24.5 a bad image request does not harm the server", async ({ page }) => {
  101 |   const start = { event: { type: "system", subtype: "init", slash_commands: ["review", "recall"] } };
  102 |   await withChat({ roles: { chat: { replies: [[start, say("m1", "Hello")]] } } }, async (server) => {
  103 |     await page.goto(server.url);
  104 |     const composer = composerOf(page);
  105 |     await composer.fill("hi");
  106 |     await composer.press("Enter");
  107 |     await expect(chat(page).getByText("Hello")).toBeVisible();
  108 |     const base = `${server.origin}/api/projects/${projectOf(server.url)}/image`;
  109 |     const get = (q: string) =>
  110 |       page.evaluate((u) => fetch(u).then(async (r) => ({ s: r.status, t: (await r.text()).slice(0, 80) })), `${base}${q}`);
  111 |     expect((await get("?name=")).s).toBe(404);
  112 |     for (const q of ["?name=..%2F..%2Flog.jsonl", "?name=..%2F..%2F..%2Fpackage.json", "?name=..%2F..%2F..%2F..%2F..%2Fetc%2Fhosts"]) {
  113 |       const r = await get(q);
  114 |       expect(r.s).toBe(404);
  115 |       expect(r.t).not.toContain("node.proposed");
  116 |     }
  117 |     await composer.click();
  118 |     await composer.pressSequentially("/");
  119 |     await expect(page.getByRole("listbox").getByRole("option")).toHaveText(["/review", "/recall"]);
  120 |   });
  121 | });
  122 | 
```