# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: tabs.spec.ts >> 23.2 switching to a tab shows its newest message
- Location: .werk-heldout/e2e-b/tabs.spec.ts:99:1

# Error details

```
Error: the log stays where the person scrolled it

expect(received).toBeLessThan(expected)

Expected: < 50
Received:   4221
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
          - generic [ref=e46]: make it long
          - paragraph [ref=e48]: long paragraph 0. filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words
          - paragraph [ref=e50]: long paragraph 1. filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words
          - paragraph [ref=e52]: long paragraph 2. filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words
          - paragraph [ref=e54]: long paragraph 3. filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words
          - paragraph [ref=e56]: long paragraph 4. filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words
          - paragraph [ref=e58]: long paragraph 5. filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words
          - paragraph [ref=e60]: long paragraph 6. filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words
          - paragraph [ref=e62]: long paragraph 7. filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words
          - paragraph [ref=e64]: long paragraph 8. filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words
          - paragraph [ref=e66]: long paragraph 9. filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words
          - paragraph [ref=e68]: long paragraph 10. filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words
          - paragraph [ref=e70]: long paragraph 11. filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words
          - paragraph [ref=e72]: long paragraph 12. filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words
          - paragraph [ref=e74]: long paragraph 13. filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words
          - paragraph [ref=e76]: long paragraph 14. filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words
          - paragraph [ref=e78]: long paragraph 15. filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words
          - paragraph [ref=e80]: long paragraph 16. filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words
          - paragraph [ref=e82]: long paragraph 17. filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words
          - paragraph [ref=e84]: long paragraph 18. filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words
          - paragraph [ref=e86]: long paragraph 19. filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words
          - paragraph [ref=e88]: long paragraph 20. filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words
          - paragraph [ref=e90]: long paragraph 21. filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words
          - paragraph [ref=e92]: long paragraph 22. filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words
          - paragraph [ref=e94]: long paragraph 23. filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words
          - paragraph [ref=e96]: long paragraph 24. filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words
          - paragraph [ref=e98]: long paragraph 25. filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words
          - paragraph [ref=e100]: long paragraph 26. filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words
          - paragraph [ref=e102]: long paragraph 27. filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words
          - paragraph [ref=e104]: long paragraph 28. filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words
          - paragraph [ref=e106]: long paragraph 29. filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words
          - paragraph [ref=e108]: long paragraph 30. filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words
          - paragraph [ref=e110]: long paragraph 31. filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words
          - paragraph [ref=e112]: long paragraph 32. filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words
          - paragraph [ref=e114]: long paragraph 33. filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words
          - paragraph [ref=e116]: long paragraph 34. filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words
          - paragraph [ref=e118]: long paragraph 35. filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words
          - paragraph [ref=e120]: long paragraph 36. filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words
          - paragraph [ref=e122]: long paragraph 37. filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words
          - paragraph [ref=e124]: long paragraph 38. filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words
          - paragraph [ref=e126]: long paragraph 39. filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words filler words
          - generic [ref=e127]: 1s
        - article [ref=e128]:
          - generic [ref=e129]: one more
          - paragraph [ref=e131]: NEWEST reply
          - generic [ref=e132]: 1s
        - article [ref=e133]:
          - generic [ref=e134]: and again
          - paragraph [ref=e136]: ANOTHER reply
          - generic [ref=e137]: 3s
      - generic [ref=e138]:
        - generic [ref=e140]: idle
        - generic [ref=e141]:
          - combobox "Model" [ref=e142]:
            - option "Sonnet"
            - option "Opus"
            - option "Sonnet + Opus advisor" [selected]
          - button "Context 0% full" [ref=e144] [cursor=pointer]
      - textbox "Message" [active] [ref=e146]:
        - /placeholder: Message the agent
      - generic [ref=e147]:
        - button "main" [ref=e148]
        - button "2" [ref=e149]
        - button "New conversation" [ref=e150]: +
```

# Test source

```ts
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
  78  |         .toHaveAttribute("data-blink", "yellow", { timeout: 20000 });
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
> 141 |       expect(await scroll.evaluate((n) => n.scrollTop), "the log stays where the person scrolled it").toBeLessThan(50);
      |                                                                                                       ^ Error: the log stays where the person scrolled it
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
  179 |     async (server) => {
  180 |       await page.goto(server.url);
  181 |       const chips = page.locator("[data-slot=tab-chip]");
  182 |       await send(page, "Hello");
  183 |       await expect(chat(page).getByText("First answer")).toBeVisible();
  184 |       await page.locator("[data-slot=tab-new]").click();
  185 |       await expect(chips).toHaveCount(2);
  186 |       await chips.nth(0).click();
  187 |       // Record every moment that a chip or a line shows a dead agent.
  188 |       await page.evaluate(() => {
  189 |         const w = window as unknown as { sawDead: number };
  190 |         w.sawDead = 0;
  191 |         const check = () => {
  192 |           if (document.querySelector("[data-blink=red],[data-slot=dead-line],[data-slot=dead-error]")) w.sawDead++;
  193 |         };
  194 |         new MutationObserver(check).observe(document.body, { subtree: true, childList: true, attributes: true });
  195 |       });
  196 |       await chat(page).getByLabel("Model").selectOption("opus");
  197 |       await expect.poll(() => launched(server).length).toBe(2);
  198 |       await chips.nth(1).click();
  199 |       await expect(page.locator("[data-slot=dead-line]")).toHaveCount(0);
  200 |       await chips.nth(0).click();
  201 |       await send(page, "Next one");
  202 |       await expect(chat(page).getByText("Second answer")).toBeVisible();
  203 |       await expect(chips.nth(0)).not.toHaveAttribute("data-blink", "red");
  204 |       await expect(chips.nth(1)).not.toHaveAttribute("data-blink", "red");
  205 |       expect(await page.evaluate(() => (window as unknown as { sawDead: number }).sawDead)).toBe(0);
  206 |       void composerOf;
  207 |     },
  208 |   );
  209 | });
  210 | 
  211 | test("23.5 a background agent line and a suggested next action", async ({ page }) => {
  212 |   const list = (ids: string[]) => ({
  213 |     event: { type: "system", subtype: "background_tasks", tasks: ids.map((id) => ({ id })) },
  214 |   });
  215 |   await withChat(
  216 |     {
  217 |       roles: {
  218 |         chat: {
  219 |           replies: [
  220 |             [
  221 |               list(["a"]),
  222 |               say("m1", "Started one task"),
  223 |               { event: { type: "result", duration_ms: 100, total_cost_usd: 0 } },
  224 |               { pause: 4000 },
  225 |               list([]),
  226 |             ],
  227 |             [say("m2", 'Done.\n\nNext: say "merge it"')],
  228 |             [say("m3", "Merged")],
  229 |           ],
  230 |         },
  231 |       },
  232 |     },
  233 |     async (server) => {
  234 |       await page.goto(server.url);
  235 |       await send(page, "Go");
  236 |       const line = chat(page).getByText("A background agent runs");
  237 |       await expect(line).toBeVisible();
  238 |       await expect(chat(page).getByText("Started one task")).toBeVisible();
  239 |       // The turn has ended; the line stays while the task runs.
  240 |       await expect(page.locator('[data-slot="chat-head"]')).not.toHaveAttribute("data-busy", "true");
  241 |       await expect(line).toBeVisible();
```