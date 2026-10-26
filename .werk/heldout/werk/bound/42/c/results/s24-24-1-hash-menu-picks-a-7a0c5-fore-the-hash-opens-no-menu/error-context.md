# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: s24.spec.ts >> 24.1 hash menu picks a card; a backtick before the hash opens no menu
- Location: .werk-heldout/c/s24.spec.ts:12:1

# Error details

```
Error: BELOW-CARET

expect(received).toBeGreaterThanOrEqual(expected)

Expected: >= 676
Received:    568
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
      - generic [ref=e64]:
        - listbox "Cards" [ref=e65]:
          - option "#werk-shots Pasted screenshots" [selected] [ref=e66] [cursor=pointer]:
            - code [ref=e68]: "#werk-shots"
            - generic [ref=e69]: Pasted screenshots
        - textbox "Message" [active] [ref=e70]:
          - /placeholder: Message the agent
          - text: "#wer"
      - generic [ref=e71]:
        - button "main" [ref=e72]
        - button "New conversation" [ref=e73]: +
```

# Test source

```ts
  1   | import { readdirSync, existsSync } from "node:fs";
  2   | import { join } from "node:path";
  3   | import { spawnSync } from "node:child_process";
  4   | import { expect, test } from "@playwright/test";
  5   | import { chat, composer, pasteImage, say, send, withServer } from "./support.ts";
  6   | 
  7   | const reply = { roles: { chat: { replies: [[say("m1", "Seen")], [say("m2", "Seen again")]] } } };
  8   | const attachments = (dir: string) => join(dir, ".werk", "attachments");
  9   | const chipsOf = (page: import("@playwright/test").Page) =>
  10  |   page.getByRole("list", { name: "Attached images" });
  11  | 
  12  | test("24.1 hash menu picks a card; a backtick before the hash opens no menu", async ({ page }) => {
  13  |   await withServer({}, async (s) => {
  14  |     await page.goto(s.url);
  15  |     await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  16  |     await composer(page).pressSequentially("Look at #wer");
  17  |     const menu = page.getByRole("listbox");
  18  |     await expect(menu).toBeVisible();
  19  |     const opt = menu.getByRole("option");
  20  |     await expect(opt).toHaveCount(1);
  21  |     await expect(opt.first()).toContainText("#werk-shots");
  22  |     await expect(opt.first()).toContainText("Pasted screenshots");
  23  |     // the menu opens below the caret: it sits under the composer text area top? record geometry
  24  |     const m = await menu.boundingBox();
  25  |     const c = await composer(page).boundingBox();
  26  |     expect(m && c).toBeTruthy();
  27  |     await composer(page).press("ArrowDown");
  28  |     await composer(page).press("Enter");
  29  |     expect((await composer(page).inputValue()).trim()).toBe("Look at #werk-shots");
  30  |     await expect(menu).toHaveCount(0);
  31  |     await composer(page).fill("`#wer");
  32  |     await expect(page.getByRole("listbox")).toHaveCount(0);
  33  |     // the menu is placed below the caret
  34  |     await composer(page).fill("");
  35  |     await composer(page).pressSequentially("#wer");
  36  |     const m2 = await page.getByRole("listbox").boundingBox();
  37  |     const c2 = await composer(page).boundingBox();
> 38  |     expect.soft(m2!.y, "BELOW-CARET").toBeGreaterThanOrEqual(c2!.y + c2!.height - 2);
      |                                       ^ Error: BELOW-CARET
  39  |   }, (s) => s.card("werk-shots", "Pasted screenshots", "root"));
  40  | });
  41  | 
  42  | test("24.2 a pasted PNG uploads at once and reaches the agent as a stored path", async ({ page }) => {
  43  |   await withServer({ script: reply }, async (s) => {
  44  |     let release: () => void = () => {};
  45  |     const gate = new Promise<void>((r) => (release = r));
  46  |     await page.route("**/image", async (route) => {
  47  |       if (route.request().method() === "POST") await gate;
  48  |       await route.continue();
  49  |     });
  50  |     await page.goto(s.url);
  51  |     await composer(page).pressSequentially("What is wrong here? ");
  52  |     await pasteImage(page);
  53  |     await expect(composer(page)).toHaveValue("What is wrong here? [Image #1]");
  54  |     const chips = chipsOf(page);
  55  |     await expect(chips.getByRole("status", { name: "Uploading" })).toBeVisible();
  56  |     await expect(chips).toContainText("[Image #1]");
  57  |     release();
  58  |     const thumb = chips.getByRole("img");
  59  |     await expect(thumb).toBeVisible();
  60  |     await expect.poll(() => thumb.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
  61  |     await composer(page).press("Enter");
  62  |     await expect(chat(page).getByText("Seen", { exact: true })).toBeVisible();
  63  |     const [text] = s.messages();
  64  |     expect(text).toMatch(/\[Image #1\] = \S*\.werk\/attachments\/\S+\.png/);
  65  |     expect(text).toContain("Open each image above with Read");
  66  |     const files = readdirSync(attachments(s.dir)).filter((f) => f.endsWith(".png"));
  67  |     expect(files).toHaveLength(1);
  68  |     const st = spawnSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: s.dir, encoding: "utf8" });
  69  |     expect(st.stdout).not.toContain("attachments");
  70  |   });
  71  | });
  72  | 
  73  | test("24.3 an oversized image is refused and not sent", async ({ page }) => {
  74  |   await withServer({ script: reply }, async (s) => {
  75  |     await page.goto(s.url);
  76  |     await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  77  |     await pasteImage(page, 25 * 1024 * 1024, "png", "drop");
  78  |     await expect(composer(page)).toHaveValue("[Image #1]");
  79  |     const chip = chipsOf(page);
  80  |     await expect(chip).toContainText("[Image #1]");
  81  |     await expect(chip.getByRole("alert")).toContainText("20 MB");
  82  |     await composer(page).pressSequentially(" why");
  83  |     await composer(page).press("Enter");
  84  |     await expect(chat(page).getByText("Seen", { exact: true })).toBeVisible();
  85  |     const [text] = s.messages();
  86  |     expect(text).not.toContain("[Image");
  87  |     expect(text).not.toContain("attachments");
  88  |     const dir = attachments(s.dir);
  89  |     const files = existsSync(dir) ? readdirSync(dir).filter((f) => f !== ".gitignore") : [];
  90  |     expect(files).toEqual([]);
  91  |   });
  92  | });
  93  | 
  94  | test("24.4 removing the first of two images renumbers the second", async ({ page }) => {
  95  |   await withServer({ script: reply }, async (s) => {
  96  |     await page.goto(s.url);
  97  |     await pasteImage(page, null, "png");
  98  |     await expect(chipsOf(page).getByRole("img")).toHaveCount(1);
  99  |     await pasteImage(page, null, "jpeg");
  100 |     await expect(chipsOf(page).getByRole("img")).toHaveCount(2);
  101 |     await expect(composer(page)).toHaveValue("[Image #1][Image #2]");
  102 |     await chipsOf(page).getByRole("button", { name: "Remove [Image #1]" }).click();
  103 |     await expect(composer(page)).toHaveValue("[Image #1]");
  104 |     await expect(chipsOf(page).getByRole("img")).toHaveCount(1);
  105 |     await expect(chipsOf(page).getByRole("img")).toHaveAttribute("src", /\.jpg$/);
  106 |     await composer(page).pressSequentially(" x");
  107 |     await composer(page).press("Enter");
  108 |     await expect(chat(page).getByText("Seen", { exact: true })).toBeVisible();
  109 |     const [text] = s.messages();
  110 |     expect(text).toMatch(/\[Image #1\] = \S*\.jpg/);
  111 |     expect(text).not.toContain("[Image #2]");
  112 |     expect(text).not.toMatch(/\.png/);
  113 |   });
  114 | });
  115 | 
  116 | test("24.5 a bad image request does not harm the server", async ({ page }) => {
  117 |   const start = { event: { type: "system", subtype: "init", slash_commands: ["review", "recall"] } };
  118 |   await withServer({ script: { roles: { chat: { replies: [[start, say("m1", "Hello")]] } } } }, async (s) => {
  119 |     await page.goto(s.url);
  120 |     await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  121 |     await send(page, "hi");
  122 |     await expect(chat(page).getByText("Hello", { exact: true })).toBeVisible();
  123 |     const base = `${s.origin}/api/projects/${s.dir.split("/").pop()}/image`;
  124 |     expect((await page.request.get(`${base}?name=`)).status()).toBe(404);
  125 |     expect((await page.request.get(base)).status()).toBe(404);
  126 |     for (const name of ["../log.jsonl", "../../project/.werk/log.jsonl", "%2e%2e%2flog.jsonl", "..%2F..%2F.werk%2Flog.jsonl"]) {
  127 |       const r = await page.request.get(`${base}?name=${name}`);
  128 |       expect(r.status()).toBe(404);
  129 |       expect(await r.text()).not.toContain("node.proposed");
  130 |     }
  131 |     await composer(page).pressSequentially("/");
  132 |     await expect(page.getByRole("listbox")).toBeVisible({ timeout: 10000 });
  133 |   }, undefined);
  134 | });
  135 | 
```