# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: tabs.spec.ts >> 23.1 two conversations with different home cards stay apart
- Location: .werk-heldout/e2e-b/tabs.spec.ts:42:1

# Error details

```
Error: chip labels are the titles of card A and card B

expect(received).toEqual(expected) // deep equality

- Expected  - 2
+ Received  + 2

  Array [
-   "Card A",
-   "Card B",
+   "main",
+   "2",
  ]
```

```
Error: chip A blinks yellow on an ask

expect(locator).toHaveAttribute(expected) failed

Locator:  locator('[data-slot=tab-chip]').first()
Expected: "yellow"
Received: ""
Timeout:  20000ms

Call log:
  - chip A blinks yellow on an ask locator('[data-slot=tab-chip]').first() with timeout 20000ms
  - waiting for locator('[data-slot=tab-chip]').first()
    44 × locator resolved to <button type="button" data-slot="tab-chip">main</button>
       - unexpected value "null"

```

```yaml
- button "main"
```

# Test source

```ts
  1   | import {
  2   |   chat,
  3   |   composerOf,
  4   |   expect,
  5   |   launched,
  6   |   leftPane,
  7   |   messages,
  8   |   say,
  9   |   send,
  10  |   test,
  11  |   withChat,
  12  | } from "./common.ts";
  13  | 
  14  | const addCards = (server: { werk: (...a: string[]) => { code: number } }) => {
  15  |   for (const [id, title] of [
  16  |     ["alpha", "Card A"],
  17  |     ["beta", "Card B"],
  18  |   ] as const) {
  19  |     expect(server.werk("add", id, "--title", title, "--parent", "root").code).toBe(0);
  20  |     expect(server.werk("accept", id, "--actor", "you").code).toBe(0);
  21  |   }
  22  | };
  23  | 
  24  | const question = {
  25  |   id: "q1",
  26  |   tool: "AskUserQuestion",
  27  |   input: {
  28  |     questions: [
  29  |       {
  30  |         question: "Which db?",
  31  |         header: "DB",
  32  |         multiSelect: false,
  33  |         options: [
  34  |           { label: "Postgres", description: "SQL" },
  35  |           { label: "SQLite", description: "file" },
  36  |         ],
  37  |       },
  38  |     ],
  39  |   },
  40  | };
  41  | 
  42  | test("23.1 two conversations with different home cards stay apart", async ({ page }) => {
  43  |   await withChat(
  44  |     {
  45  |       roles: {
  46  |         chat: {
  47  |           replies: [
  48  |             [say("a1", "Answer for A"), { pause: 7000 }, { ask: question }, say("a2", "Noted")],
  49  |             [say("b1", "Answer for B")],
  50  |           ],
  51  |         },
  52  |       },
  53  |     },
  54  |     async (server) => {
  55  |       await page.goto(server.url);
  56  |       await leftPane(page).locator("a.tile", { hasText: "Card A" }).click();
  57  |       await expect(leftPane(page).getByRole("heading", { level: 1, name: "Card A" })).toBeVisible();
  58  |       await send(page, "Message A");
  59  |       await expect(chat(page).getByText("Answer for A")).toBeVisible();
  60  |       await page.goBack();
  61  |       await leftPane(page).locator("a.tile", { hasText: "Card B" }).click();
  62  |       await expect(leftPane(page).getByRole("heading", { level: 1, name: "Card B" })).toBeVisible();
  63  |       await page.locator("[data-slot=tab-new]").click();
  64  |       await send(page, "Message B");
  65  |       await expect(chat(page).getByText("Answer for B")).toBeVisible();
  66  | 
  67  |       const chips = page.locator("[data-slot=tab-chip]");
  68  |       await expect(chips).toHaveCount(2);
  69  |       // Observed: the chips carry the tab names, not the card titles.
  70  |       expect.soft(await chips.allTextContents(), "chip labels are the titles of card A and card B").toEqual(["Card A", "Card B"]);
  71  |       // Tab B is shown.
  72  |       await expect(chat(page)).toContainText("Message B");
  73  |       await expect(chat(page)).not.toContainText("Message A");
  74  |       await expect(chat(page)).not.toContainText("Answer for A");
  75  |       // The ask of tab A arrives while tab B is shown.
  76  |       await expect
  77  |         .soft(chips.nth(0), "chip A blinks yellow on an ask")
> 78  |         .toHaveAttribute("data-blink", "yellow", { timeout: 20000 });
      |          ^ Error: chip A blinks yellow on an ask
  79  |       await expect(chat(page)).not.toContainText("Which db?");
  80  |       await chips.nth(0).click();
  81  |       await expect(chat(page)).toContainText("Message A");
  82  |       await expect(chat(page)).not.toContainText("Message B");
  83  |       await expect(chat(page)).not.toContainText("Answer for B");
  84  |       const bar = page.locator('[data-slot="ask-bar"]');
  85  |       await expect(bar).toContainText("Which db?", { timeout: 20000 });
  86  |       await bar.getByLabel(/B\. SQLite/).check();
  87  |       await bar.getByRole("button", { name: "Submit answer" }).click();
  88  |       await expect(chat(page).getByText("Noted")).toBeVisible();
  89  |     },
  90  |     addCards,
  91  |   );
  92  | });
  93  | 
  94  | const longReply = (prefix: string) =>
  95  |   Array.from({ length: 40 }, (_, i) =>
  96  |     say(`${prefix}${i}`, `${prefix} paragraph ${i}. ${"filler words ".repeat(20)}`),
  97  |   );
  98  | 
  99  | test("23.2 switching to a tab shows its newest message", async ({ page }) => {
  100 |   await withChat(
  101 |     {
  102 |       roles: {
  103 |         chat: {
  104 |           replies: [
  105 |             [say("m0", "First tab says hi")],
  106 |             longReply("long"),
  107 |             [{ pause: 800 }, say("n1", "NEWEST reply")],
  108 |             [{ pause: 3000 }, say("n2", "ANOTHER reply")],
  109 |           ],
  110 |         },
  111 |       },
  112 |     },
  113 |     async (server) => {
  114 |       await page.goto(server.url);
  115 |       const chips = page.locator("[data-slot=tab-chip]");
  116 |       await send(page, "hello first");
  117 |       await expect(chat(page).getByText("First tab says hi")).toBeVisible();
  118 |       await page.locator("[data-slot=tab-new]").click();
  119 |       await send(page, "make it long");
  120 |       await expect(chat(page).getByText("long paragraph 39.")).toBeVisible();
  121 |       const scroll = page.locator("[data-slot=chat-scroll]");
  122 |       expect(await scroll.evaluate((n) => n.scrollHeight > n.clientHeight + 200)).toBe(true);
  123 |       // Second tab: ask for a new reply, then look at the first tab while it arrives.
  124 |       await send(page, "one more");
  125 |       await chips.nth(0).click();
  126 |       await expect(chat(page)).toContainText("First tab says hi");
  127 |       await expect.poll(() => messages(server).length).toBe(3);
  128 |       // The agent replies 800 ms after the message; a person waits that long.
  129 |       await page.waitForTimeout(2500);
  130 |       await chips.nth(1).click();
  131 |       await expect(chat(page).getByText("NEWEST reply")).toBeVisible();
  132 |       const atBottom = () =>
  133 |         scroll.evaluate((n) => n.scrollHeight - n.clientHeight - n.scrollTop < 3);
  134 |       await expect.poll(atBottom).toBe(true);
  135 |       // Scroll up, then the agent sends another reply.
  136 |       await send(page, "and again");
  137 |       await scroll.hover();
  138 |       await page.mouse.wheel(0, -100000);
  139 |       await expect.poll(() => scroll.evaluate((n) => n.scrollTop)).toBe(0);
  140 |       await expect(chat(page).getByText("ANOTHER reply")).toBeAttached({ timeout: 15000 });
  141 |       expect(await scroll.evaluate((n) => n.scrollTop), "the log stays where the person scrolled it").toBeLessThan(50);
  142 |     },
  143 |   );
  144 | });
  145 | 
  146 | test("23.3 a crashed agent marks its tab and tells the other tabs", async ({ page }) => {
  147 |   const crash = [{ stderr: "boom: agent failed\nsecond line of the error" }, { crash: 1 }];
  148 |   await withChat(
  149 |     { roles: { chat: { replies: [crash, crash, [say("m1", "I am back")]] } } },
  150 |     async (server) => {
  151 |       await page.goto(server.url);
  152 |       const chips = page.locator("[data-slot=tab-chip]");
  153 |       await page.locator("[data-slot=tab-new]").click();
  154 |       await expect(chips).toHaveCount(2);
  155 |       const [a, b] = [chips.nth(1), chips.nth(0)];
  156 |       await send(page, "hello");
  157 |       await b.click();
  158 |       await expect(a).toHaveAttribute("data-blink", "red");
  159 |       const lines = page.locator("[data-slot=dead-line]");
  160 |       await expect(lines).toHaveCount(1);
  161 |       await expect(lines).toContainText("2");
  162 |       await expect(lines).toContainText("boom: agent failed");
  163 |       await a.click();
  164 |       await expect(page.locator("[data-slot=dead-error]")).toContainText("second line of the error");
  165 |       await expect(page.locator("[data-slot=dead-error]")).toContainText("boom: agent failed");
  166 |       await send(page, "try again");
  167 |       await expect(chat(page).getByText("I am back")).toBeVisible();
  168 |       await expect(a).not.toHaveAttribute("data-blink", "red");
  169 |       await b.click();
  170 |       await expect(lines).toHaveCount(0);
  171 |       expect(launched(server).length).toBeGreaterThanOrEqual(2);
  172 |     },
  173 |   );
  174 | });
  175 | 
  176 | test("23.4 a model switch is not a crash", async ({ page }) => {
  177 |   await withChat(
  178 |     { roles: { chat: { replies: [[say("m1", "First answer")], [say("m2", "Second answer")]] } } },
```