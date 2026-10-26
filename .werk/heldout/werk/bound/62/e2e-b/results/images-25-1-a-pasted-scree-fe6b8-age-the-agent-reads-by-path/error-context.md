# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: images.spec.ts >> 25.1 a pasted screenshot becomes a numbered image the agent reads by path
- Location: .werk-heldout/e2e-b/images.spec.ts:156:1

# Error details

```
Error: the message shows the image under [Image #1]

expect(received).toBeGreaterThan(expected)

Expected: > 0
Received:   0
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
      - article [ref=e36]:
        - region "Build rules" [ref=e37]:
          - heading "Build rules" [level=2] [ref=e38]
          - paragraph [ref=e39]: This map has no build rules yet.
  - complementary "Chat pane" [ref=e40]:
    - generic [ref=e42]:
      - log "Conversation" [ref=e44]:
        - article [ref=e45]:
          - generic [ref=e46]: "[Image #1] Why is this red?"
          - paragraph [ref=e48]: Seen
          - generic [ref=e49]: 0s
      - generic [ref=e50]:
        - generic [ref=e52]: idle
        - generic [ref=e53]:
          - combobox "Model" [ref=e54]:
            - option "Sonnet"
            - option "Opus"
            - option "Sonnet + Opus advisor" [selected]
          - button "Context 0% full" [ref=e56] [cursor=pointer]
      - textbox "Message" [active] [ref=e58]:
        - /placeholder: Message the agent
      - generic [ref=e59]:
        - button "main" [ref=e60]
        - button "New conversation" [ref=e61]: +
```

# Test source

```ts
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
  144 |       const res = await fetch(apiUrl(server, `/image?name=${name}`));
  145 |       expect(res.status, name).toBe(404);
  146 |       expect(await res.text()).not.toContain("node.proposed");
  147 |     }
  148 |     const bare = await page.request.get(apiUrl(server, "/image"));
  149 |     expect(bare.status()).toBe(404);
  150 |     const composer = composerOf(page);
  151 |     await composer.pressSequentially("/");
  152 |     await expect(page.getByRole("listbox").getByRole("option")).toHaveText(["/review", "/recall"]);
  153 |   });
  154 | });
  155 | 
  156 | test("25.1 a pasted screenshot becomes a numbered image the agent reads by path", async ({ page }) => {
  157 |   await withChat(ok, async (server) => {
  158 |     await page.route("**/image", async (route) => {
  159 |       if (route.request().method() === "POST") await new Promise((r) => setTimeout(r, 1500));
  160 |       await route.continue();
  161 |     });
  162 |     await page.goto(server.url);
  163 |     const composer = composerOf(page);
  164 |     await pasteShot(page);
  165 |     await expect(chips(page).getByRole("status", { name: "Uploading" })).toBeVisible();
  166 |     await expect(composer).toHaveValue("[Image #1]");
  167 |     const thumb = chips(page).getByRole("img");
  168 |     await expect(thumb).toBeVisible();
  169 |     await thumbLoaded(thumb);
  170 |     await expect(chips(page)).toContainText("[Image #1]");
  171 |     await composer.pressSequentially(" Why is this red?");
  172 |     await composer.press("Enter");
  173 |     const user = chat(page).locator("[data-role=user]");
  174 |     await expect(user).toContainText("[Image #1]");
  175 |     await expect(user).toContainText("Why is this red?");
  176 |     await expect(chat(page).getByText("Seen")).toBeVisible();
> 177 |     expect.soft(await user.locator("img").count(), "the message shows the image under [Image #1]").toBeGreaterThan(0);
      |                                                                                                    ^ Error: the message shows the image under [Image #1]
  178 |     const [text] = messages(server);
  179 |     expect(text).toMatch(/\[Image #1\] = .*\.werk\/attachments\/.+\.png/);
  180 |     expect(text).toContain("Open each image above with Read");
  181 |     expect(text).not.toContain(PNG_BASE64);
  182 |     expect(text).not.toContain("iVBORw0KGgo");
  183 |   });
  184 | });
  185 | 
  186 | test("25.2 an oversized image shows its refusal and is not sent", async ({ page }) => {
  187 |   await withChat(ok, async (server) => {
  188 |     await page.goto(server.url);
  189 |     const composer = composerOf(page);
  190 |     await pasteShot(page, { kind: "png", size: 2 * 1024 * 1024 });
  191 |     await expect(chips(page).getByRole("img")).toHaveCount(1);
  192 |     await pasteShot(page, { kind: "png", size: 25 * 1024 * 1024 });
  193 |     await expect(composer).toHaveValue("[Image #1][Image #2]");
  194 |     const items = chips(page).getByRole("listitem");
  195 |     await expect(items).toHaveCount(2);
  196 |     await expect(items.nth(0)).toContainText("[Image #1]");
  197 |     await thumbLoaded(items.nth(0).getByRole("img"));
  198 |     await expect(items.nth(1).getByRole("alert")).toContainText("larger than 20 MB");
  199 |     await chips(page).getByRole("button", { name: "Remove [Image #2]" }).click();
  200 |     await expect(composer).not.toHaveValue(/\[Image #2\]/);
  201 |     await composer.pressSequentially(" Why is this red?");
  202 |     await composer.press("Enter");
  203 |     await expect(chat(page).getByText("Seen")).toBeVisible();
  204 |     const [text] = messages(server);
  205 |     expect(text).toMatch(/\[Image #1\] = .*attachments\/.+\.png/);
  206 |     expect(text).not.toContain("[Image #2]");
  207 |     expect(storedFiles(server)).toHaveLength(1);
  208 |   });
  209 | });
  210 | 
  211 | test("25.3 removing a chip renumbers the remaining images", async ({ page }) => {
  212 |   await withChat(ok, async (server) => {
  213 |     await page.goto(server.url);
  214 |     const composer = composerOf(page);
  215 |     await pasteShot(page, { kind: "png" });
  216 |     await expect(chips(page).getByRole("img")).toHaveCount(1);
  217 |     await pasteShot(page, { kind: "png", size: 5000 });
  218 |     await expect(chips(page).getByRole("img")).toHaveCount(2);
  219 |     await expect(composer).toHaveValue("[Image #1][Image #2]");
  220 |     const names = await thumbNames(page);
  221 |     await chips(page).getByRole("button", { name: "Remove [Image #1]" }).click();
  222 |     await expect(composer).toHaveValue("[Image #1]");
  223 |     await expect(chips(page).getByRole("listitem")).toHaveCount(1);
  224 |     await expect(chips(page)).toContainText("[Image #1]");
  225 |     await expect(chips(page)).not.toContainText("[Image #2]");
  226 |     await composer.press("Enter");
  227 |     await expect(chat(page).getByText("Seen")).toBeVisible();
  228 |     const [text] = messages(server);
  229 |     expect(text).toMatch(new RegExp(`\\[Image #1\\] = .*attachments/${names[1]}`));
  230 |     expect(text).not.toContain(names[0] as string);
  231 |   });
  232 | });
  233 | 
  234 | test("25.4 Enter waits for a running upload", async ({ page }) => {
  235 |   await withChat(ok, async (server) => {
  236 |     let release: () => void = () => {};
  237 |     const gate = new Promise<void>((r) => {
  238 |       release = r;
  239 |     });
  240 |     await page.route("**/image", async (route) => {
  241 |       if (route.request().method() === "POST") await gate;
  242 |       await route.continue();
  243 |     });
  244 |     await page.goto(server.url);
  245 |     const composer = composerOf(page);
  246 |     await pasteShot(page);
  247 |     await expect(chips(page).getByRole("status", { name: "Uploading" })).toBeVisible();
  248 |     await composer.pressSequentially(" Why is this red?");
  249 |     await composer.press("Enter");
  250 |     await page.waitForTimeout(1000);
  251 |     expect(messages(server)).toHaveLength(0);
  252 |     await expect(chat(page).locator("article")).toHaveCount(0);
  253 |     release();
  254 |     const thumb = chips(page).getByRole("img");
  255 |     await expect(chat(page).getByText("Seen")).toBeVisible();
  256 |     void thumb;
  257 |     const [text] = messages(server);
  258 |     expect(text).toMatch(/\[Image #1\] = .*attachments\/.+\.png/);
  259 |     expect(text).toMatch(/Why is this red\?$/);
  260 |   });
  261 | });
  262 | 
  263 | test("25.5 a request for an image with no name answers 404 and the server stays up", async ({ page }) => {
  264 |   await withChat(ok, async (server) => {
  265 |     await page.goto(server.url);
  266 |     await pasteShot(page);
  267 |     await expect(chips(page).getByRole("img")).toHaveCount(1);
  268 |     const [name] = await thumbNames(page);
  269 |     expect((await page.request.get(apiUrl(server, `/image?name=${name}`))).status()).toBe(200);
  270 |     expect((await page.request.get(apiUrl(server, "/image?name="))).status()).toBe(404);
  271 |     for (const n of ["../log.jsonl", "..%2Flog.jsonl", "..%2F..%2Fpackage.json"]) {
  272 |       const res = await fetch(apiUrl(server, `/image?name=${n}`));
  273 |       expect(res.status, n).toBe(404);
  274 |     }
  275 |     await pasteShot(page);
  276 |     await expect(chips(page).getByRole("img")).toHaveCount(2);
  277 |     await thumbLoaded(chips(page).getByRole("img").nth(1));
```