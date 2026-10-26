# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: a-17.spec.ts >> 17.5 the home screen shows #root and #how side by side
- Location: .werk-heldout/a-17.spec.ts:242:1

# Error details

```
Error: expect(received).toContain(expected) // indexOf

Expected substring: "How we build"
Received string:    "project
We build software with agents
Add project…
3
3
Map
Board
#root
CARD
OPEN
We build software with agents·
Why root·
this card and everything below it, 3 cards
● 3 open·
SUB-CARDS 2
Requirement one
Why r1
#r1
Requirement two
Why r2
#r2"
```

# Page snapshot

```yaml
- generic [ref=e2]:
  - region "Map pane" [ref=e3]:
    - generic [ref=e4]:
      - generic [ref=e5]:
        - generic [ref=e6]: project
        - navigation "Breadcrumbs" [ref=e8]:
          - strong [ref=e11]: We build software with agents
      - button "Add project…" [ref=e12]
      - generic [ref=e13]:
        - generic [ref=e15]:
          - generic "3 cards in the whole map" [ref=e16]: "3"
          - generic "3 open" [ref=e17]: "3"
        - generic [ref=e18]:
          - navigation "Views" [ref=e19]:
            - button "Map" [ref=e20] [cursor=pointer]
            - button "Board" [ref=e21] [cursor=pointer]
          - searchbox "Search the map" [ref=e23]
    - article [ref=e25]:
      - region "Card" [ref=e26]:
        - generic [ref=e27]:
          - button "#root" [ref=e28] [cursor=pointer]
          - generic [ref=e29]: card
          - generic [ref=e30]: open
        - heading "We build software with agents" [level=1] [ref=e31]
        - paragraph [ref=e32]: Why root
        - img "3 open, 0 proto, 0 decided" [ref=e33]
        - paragraph [ref=e35]:
          - generic [ref=e36]: this card and everything below it, 3 cards
          - generic [ref=e37]: ● 3 open
      - generic [ref=e38]:
        - heading "Sub-cards 2" [level=2] [ref=e39]
        - generic [ref=e40]:
          - 'link "Requirement one Why r1 #r1" [ref=e41] [cursor=pointer]':
            - /url: /map/r1
            - generic [ref=e42]: Requirement one
            - generic [ref=e43]: Why r1
            - generic [ref=e44]: "#r1"
          - 'link "Requirement two Why r2 #r2" [ref=e46] [cursor=pointer]':
            - /url: /map/r2
            - generic [ref=e47]: Requirement two
            - generic [ref=e48]: Why r2
            - generic [ref=e49]: "#r2"
  - complementary "Chat pane" [ref=e51]:
    - generic [ref=e53]:
      - log "Conversation" [ref=e55]
      - generic [ref=e56]: idle
      - textbox "Message" [ref=e59]:
        - /placeholder: Message the agent
```

# Test source

```ts
  158 |     { type: "node.reopened", id: "base", at: "2026-10-10T09:00:00.000Z" },
  159 |   ];
  160 |   // Contains-only ids come first in the log, to show that rank beats log order.
  161 |   for (let i = 1; i <= 6; i++) events.push(...card(`my-werk-${i}`, `Contains ${i}`, "root"));
  162 |   for (let i = 1; i <= 8; i++) events.push(...card(`werk-${i}`, `Prefix ${i}`, "root"));
  163 |   const s = await srv({ events });
  164 |   await page.goto(s.url);
  165 |   await expect(leftPane(page).getByRole("heading", { level: 1, name: ROOT })).toBeVisible();
  166 |   const box = page.getByRole("searchbox", { name: "Search the map" });
  167 |   await box.fill("#werk");
  168 |   const rows = page.getByRole("list", { name: "Search results" }).getByRole("listitem");
  169 |   await expect(rows.first()).toBeVisible();
  170 |   const n = await rows.count();
  171 |   expect(n).toBe(12);
  172 |   const ids = await rows.locator("code").allInnerTexts();
  173 |   expect(ids[0]).toBe("werk");
  174 |   const firstContains = ids.findIndex((id) => !id.startsWith("werk"));
  175 |   const lastPrefix = ids.reduce((acc, id, i) => (id.startsWith("werk") ? i : acc), -1);
  176 |   expect(firstContains === -1 || firstContains > lastPrefix).toBe(true);
  177 |   expect(ids.filter((id) => id.startsWith("werk")).length).toBe(10);
  178 |   // Each row: a dot, a title, an id.
  179 |   for (let i = 0; i < n; i++) {
  180 |     const row = rows.nth(i);
  181 |     await expect(row.locator("[data-slot=dot]")).toHaveCount(1);
  182 |     await expect(row.locator("[data-slot=result-title]")).not.toHaveText("");
  183 |     await expect(row.locator("code")).not.toHaveText("");
  184 |   }
  185 |   const staleRow = rows.filter({ has: page.locator("code", { hasText: /^werk-stale$/ }) });
  186 |   await expect(staleRow.locator("[data-slot=dot]")).toHaveAttribute("data-color", "stale");
  187 |   const dotRgb = await staleRow
  188 |     .locator("[data-slot=dot]")
  189 |     .evaluate((el) => getComputedStyle(el).backgroundColor);
  190 |   const plainDot = await rows
  191 |     .nth(0)
  192 |     .locator("[data-slot=dot]")
  193 |     .evaluate((el) => getComputedStyle(el).backgroundColor);
  194 |   expect(dotRgb).not.toBe(plainDot);
  195 |   const [r, g, b] = (dotRgb.match(/\d+(\.\d+)?/g) ?? []).map(Number);
  196 |   expect(r).toBeGreaterThan(150);
  197 |   expect(g).toBeLessThan(100);
  198 |   expect(b).toBeLessThan(100);
  199 | 
  200 |   await expect(rows.first()).toHaveAttribute("aria-current", /.+/);
  201 |   await box.press("ArrowDown");
  202 |   await expect(rows.nth(1)).toHaveAttribute("aria-current", /.+/);
  203 |   await box.press("ArrowUp");
  204 |   await expect(rows.first()).toHaveAttribute("aria-current", /.+/);
  205 |   await expect(rows.nth(1)).not.toHaveAttribute("aria-current", /.+/);
  206 | 
  207 |   await box.press("Enter");
  208 |   await expect(page).toHaveURL(/\/map\/werk$/);
  209 |   await expect(leftPane(page).getByRole("heading", { level: 1, name: "The werk card" })).toBeVisible();
  210 |   const cur = crumbs(page).locator("[data-slot=crumb-line] [data-slot=crumb-current]");
  211 |   await expect(cur).toHaveText("The werk card");
  212 |   expect(await cur.evaluate((el) => el.tagName)).toBe("STRONG");
  213 |   await expect(box).toHaveValue("");
  214 | });
  215 | 
  216 | test("17.4 the Map and Board tabs switch the view", async ({ page, srv }) => {
  217 |   const s = await srv({
  218 |     events: [...card("root", ROOT), ...card("seats", "We charge per seat", "root")],
  219 |   });
  220 |   await page.goto(`${s.url}/map/seats`);
  221 |   const pane = leftPane(page);
  222 |   await expect(pane.getByRole("heading", { level: 1, name: "We charge per seat" })).toBeVisible();
  223 |   const views = page.getByRole("navigation", { name: "Views" });
  224 |   await expect(views.getByRole("button", { name: "Map" })).toHaveAttribute("aria-current", "page");
  225 |   await expect(views.getByRole("button", { name: "Board" })).not.toHaveAttribute("aria-current", "page");
  226 | 
  227 |   await views.getByRole("button", { name: "Board" }).click();
  228 |   await expect(page).toHaveURL(/\/board$/);
  229 |   await expect(pane.locator(".board-page")).toBeVisible();
  230 |   await expect(views.getByRole("button", { name: "Board" })).toHaveAttribute("aria-current", "page");
  231 | 
  232 |   await page.reload();
  233 |   await expect(page).toHaveURL(/\/board$/);
  234 |   await expect(pane.locator(".board-page")).toBeVisible();
  235 |   await expect(views.getByRole("button", { name: "Board" })).toHaveAttribute("aria-current", "page");
  236 | 
  237 |   await views.getByRole("button", { name: "Map" }).click();
  238 |   await expect(page).toHaveURL(/\/map\/seats$/);
  239 |   await expect(pane.getByRole("heading", { level: 1, name: "We charge per seat" })).toBeVisible();
  240 | });
  241 | 
  242 | test("17.5 the home screen shows #root and #how side by side", async ({ page, srv }) => {
  243 |   const s = await srv({
  244 |     events: [
  245 |       ...card("root", ROOT),
  246 |       ...card("r1", "Requirement one", "root"),
  247 |       ...card("r2", "Requirement two", "root"),
  248 |       ...card("how", "How we build"),
  249 |       ...card("h1", "Rule one", "how"),
  250 |       ...card("h2", "Rule two", "how"),
  251 |     ],
  252 |   });
  253 |   // The home address of the project.
  254 |   await page.goto(s.url);
  255 |   const pane = leftPane(page);
  256 |   await expect(pane.getByText(ROOT).first()).toBeVisible();
  257 |   const bodyText = await pane.innerText();
> 258 |   expect(bodyText).toContain("How we build");
      |                    ^ Error: expect(received).toContain(expected) // indexOf
  259 |   expect(bodyText).toContain("Why how");
  260 |   expect(bodyText).toContain("Rule one");
  261 |   expect(bodyText).toContain("Requirement one");
  262 | });
  263 | 
```