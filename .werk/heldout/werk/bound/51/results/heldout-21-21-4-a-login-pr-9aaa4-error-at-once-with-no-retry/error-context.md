# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: heldout-21.spec.ts >> 21.4 a login problem shows its error at once with no retry
- Location: .werk-heldout/heldout-21.spec.ts:132:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('complementary', { name: 'Chat pane' }).getByText('Your message was not delivered. Send it again.')
Expected: visible
Timeout: 3000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" getByRole('complementary', { name: 'Chat pane' }).getByText('Your message was not delivered. Send it again.') with timeout 3000ms
  - waiting for getByRole('complementary', { name: 'Chat pane' }).getByText('Your message was not delivered. Send it again.')

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
    - article: "Hello the agent exited: Not logged in Please run claude auth login then try again Fix the problem above, then send it again."
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
  41  |             [say("m2", "You asked: Hello")],
  42  |           ],
  43  |         },
  44  |       },
  45  |     },
  46  |     async (server) => {
  47  |       await page.goto(server.url);
  48  |       await expect(chat(page).getByLabel("Model")).toBeVisible();
  49  |       await chat(page).getByLabel("Model").selectOption({ label: "Opus" });
  50  |       await send(page, "Hello");
  51  |       await expect(chat(page).getByText("First answer")).toBeVisible();
  52  |       const before = await pie(page).getAttribute("aria-label");
  53  |       expect(before).not.toBe("Context 0% full");
  54  |       await server.stop();
  55  |       await server.start();
  56  |       await page.goto(server.url);
  57  |       await expect(chat(page).getByLabel("Model")).toHaveValue("opus");
  58  |       await expect(pie(page)).toHaveAttribute("aria-label", before as string);
  59  |       await send(page, "What did I ask you before?");
  60  |       await expect(chat(page).getByText("You asked: Hello")).toBeVisible();
  61  |       const all = launches(server);
  62  |       const last = all[all.length - 1] as string[];
  63  |       expect(last[last.indexOf("--resume") + 1]).toBe("fake-session-1");
  64  |       expect(messages(server)).toHaveLength(2);
  65  |     },
  66  |   );
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
> 141 |       await expect(chat(page).getByText("Your message was not delivered. Send it again.")).toBeVisible({ timeout: 3000 });
      |                                                                                            ^ Error: expect(locator).toBeVisible() failed
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
  167 |     await model.selectOption({ label: "Sonnet with Opus advisor" }, { timeout: 5000 });
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