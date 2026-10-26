# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: heldout-21.spec.ts >> 21.5 model switch refuses during a turn, then the advisor option, then clear context
- Location: .werk-heldout/heldout-21.spec.ts:152:1

# Error details

```
TimeoutError: locator.selectOption: Timeout 5000ms exceeded.
Call log:
  - waiting for getByRole('complementary', { name: 'Chat pane' }).getByLabel('Model')
    - locator resolved to <select aria-label="Model" data-slot="model-select">…</select>
  - attempting select option action
    2 × waiting for element to be visible and enabled
      - did not find some options
    - retrying select option action
    - waiting 20ms
    2 × waiting for element to be visible and enabled
      - did not find some options
    - retrying select option action
      - waiting 100ms
    10 × waiting for element to be visible and enabled
       - did not find some options
     - retrying select option action
       - waiting 500ms

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
      - generic [ref=e15]:
        - navigation "Views" [ref=e16]:
          - button "Map" [ref=e17] [cursor=pointer]
          - button "Board" [ref=e18] [cursor=pointer]
        - searchbox "Search the map" [ref=e20]
    - article [ref=e22]:
      - region "Card" [ref=e23]:
        - button "Remove this card" [ref=e25] [cursor=pointer]: ✕
        - generic [ref=e26]:
          - button "#root" [ref=e27] [cursor=pointer]
          - generic [ref=e28]: card
          - generic [ref=e29]: open
        - heading "We build software with agents" [level=1] [ref=e30]
        - paragraph [ref=e31]: One repeating pipeline keeps the work in step.
  - complementary "Chat pane" [ref=e32]:
    - generic [ref=e34]:
      - log "Conversation" [ref=e36]:
        - article [ref=e37]:
          - generic [ref=e38]: Make a long turn
          - paragraph [ref=e40]: Long start
          - paragraph [ref=e42]: Long end
          - generic [ref=e43]: 5s
      - generic [ref=e44]:
        - generic [ref=e46]: idle
        - generic [ref=e47]:
          - combobox "Model" [ref=e48]:
            - option "Sonnet" [selected]
            - option "Opus"
            - option "Sonnet + Opus advisor"
          - button "Context 0% full" [ref=e50] [cursor=pointer]
      - textbox "Message" [active] [ref=e52]:
        - /placeholder: Message the agent
```

# Test source

```ts
  67  | });
  68  | 
  69  | test("21.2 a dead stored session starts again and the waiting message is delivered", async ({ page }) => {
  70  |   await withChat(
  71  |     {
  72  |       roles: {
  73  |         chat: {
  74  |           replies: [
  75  |             [say("m1", "First answer")],
  76  |             [{ stderr: "No conversation found with session ID: fake-session-1" }, { crash: 1 }],
  77  |             [say("m3", "Fresh session answer")],
  78  |           ],
  79  |         },
  80  |       },
  81  |     },
  82  |     async (server) => {
  83  |       await page.goto(server.url);
  84  |       await send(page, "Hello");
  85  |       await expect(chat(page).getByText("First answer")).toBeVisible();
  86  |       await server.stop();
  87  |       await server.start();
  88  |       await page.goto(server.url);
  89  |       await send(page, "Second message");
  90  |       await expect(chat(page).getByText("Fresh session answer")).toBeVisible();
  91  |       await expect(chat(page).getByText("Your message was not delivered. Send it again.")).toHaveCount(0);
  92  |       const all = launches(server);
  93  |       const last = all[all.length - 1] as string[];
  94  |       expect(last).not.toContain("--resume");
  95  |       expect(messages(server)).toEqual(["Hello", "Second message", "Second message"].map((t) => expect.stringContaining(t)) as never);
  96  |     },
  97  |   );
  98  | });
  99  | 
  100 | test("21.3 another crash retries once, then asks to send again with the whole error; then continues the session", async ({ page }) => {
  101 |   const err = "agent error line one\nagent error line two\nagent error line three";
  102 |   await withChat(
  103 |     {
  104 |       roles: {
  105 |         chat: {
  106 |           replies: [
  107 |             [say("m1", "First answer")],
  108 |             [{ stderr: err }, { crash: 1 }],
  109 |             [{ stderr: err }, { crash: 1 }],
  110 |             [say("m4", "Back again")],
  111 |           ],
  112 |         },
  113 |       },
  114 |     },
  115 |     async (server) => {
  116 |       await page.goto(server.url);
  117 |       await send(page, "Hello");
  118 |       await expect(chat(page).getByText("First answer")).toBeVisible();
  119 |       await send(page, "Break it");
  120 |       await expect(chat(page).getByText("Your message was not delivered. Send it again.")).toBeVisible();
  121 |       for (const line of err.split("\n")) await expect(chat(page).getByText(line).first()).toBeVisible();
  122 |       expect(launches(server)).toHaveLength(2);
  123 |       await send(page, "Break it");
  124 |       await expect(chat(page).getByText("Back again")).toBeVisible();
  125 |       const all = launches(server);
  126 |       const last = all[all.length - 1] as string[];
  127 |       expect(last[last.indexOf("--resume") + 1]).toBe("fake-session-1");
  128 |     },
  129 |   );
  130 | });
  131 | 
  132 | test("21.4 a login problem shows its error at once with no retry", async ({ page }) => {
  133 |   const err = "Not logged in\nPlease run claude auth login\nthen try again";
  134 |   await withChat(
  135 |     { roles: { chat: { replies: [[{ stderr: err }, { crash: 1 }]] } } },
  136 |     async (server) => {
  137 |       await page.goto(server.url);
  138 |       await send(page, "Hello");
  139 |       for (const line of err.split("\n")) await expect(chat(page).getByText(line).first()).toBeVisible();
  140 |       expect(launches(server)).toHaveLength(1);
  141 |       await expect(chat(page).getByText("Your message was not delivered. Send it again.")).toBeVisible({ timeout: 3000 });
  142 |     },
  143 |   );
  144 | });
  145 | 
  146 | const longTurn = {
  147 |   roles: {
  148 |     chat: { replies: [[say("m1", "Long start"), { pause: 4000 }, say("m1b", "Long end")], [say("m2", "After clear")]] },
  149 |   },
  150 | } satisfies Script;
  151 | 
  152 | test("21.5 model switch refuses during a turn, then the advisor option, then clear context", async ({ page }) => {
  153 |   await withChat(longTurn, async (server) => {
  154 |     await page.goto(server.url);
  155 |     const model = chat(page).getByLabel("Model");
  156 |     await expect(model).toBeVisible();
  157 |     // Given: Sonnet in the selector (the product default is Sonnet with the advisor).
  158 |     await model.selectOption({ label: "Sonnet" });
  159 |     await expect(model).toHaveValue("sonnet");
  160 |     await expect(pie(page)).toHaveAttribute("data-level", "blue");
  161 |     await send(page, "Make a long turn");
  162 |     await expect(chat(page).getByText("Long start")).toBeVisible();
  163 |     // the selector is locked while the turn runs: a person cannot pick Opus
  164 |     await expect(model).toBeDisabled();
  165 |     await expect(model).toHaveValue("sonnet");
  166 |     await expect(chat(page).getByText("Long end")).toBeVisible();
> 167 |     await model.selectOption({ label: "Sonnet with Opus advisor" }, { timeout: 5000 });
      |                 ^ TimeoutError: locator.selectOption: Timeout 5000ms exceeded.
  168 |     await expect(model.locator("option:checked")).toHaveText("Sonnet with Opus advisor");
  169 |     await expect(chat(page).getByText(/the agent exited|not delivered/)).toHaveCount(0);
  170 |     await pie(page).click();
  171 |     const dialog = chat(page).getByRole("dialog");
  172 |     await expect(dialog).toContainText("%");
  173 |     await dialog.getByRole("button", { name: "Clear context" }).click();
  174 |     await expect(chat(page).getByText(/the agent exited|not delivered/)).toHaveCount(0);
  175 |     await send(page, "Next");
  176 |     await expect(chat(page).getByText("After clear")).toBeVisible();
  177 |   });
  178 | });
  179 | 
  180 | test("21.5b diagnostic: same flow picking the advisor by its product label", async ({ page }) => {
  181 |   await withChat(longTurn, async (server) => {
  182 |     await page.goto(server.url);
  183 |     const model = chat(page).getByLabel("Model");
  184 |     await model.selectOption({ label: "Sonnet" });
  185 |     await send(page, "Make a long turn");
  186 |     await expect(chat(page).getByText("Long end")).toBeVisible();
  187 |     await model.selectOption({ label: "Sonnet + Opus advisor" });
  188 |     await expect(model).toHaveValue("sonnet+opus");
  189 |     await expect(chat(page).getByText(/the agent exited|not delivered/)).toHaveCount(0);
  190 |     await pie(page).click();
  191 |     const dialog = chat(page).getByRole("dialog");
  192 |     await expect(dialog).toContainText("%");
  193 |     await dialog.getByRole("button", { name: "Clear context" }).click();
  194 |     await send(page, "Next");
  195 |     await expect(chat(page).getByText("After clear")).toBeVisible();
  196 |   });
  197 | });
  198 | 
```