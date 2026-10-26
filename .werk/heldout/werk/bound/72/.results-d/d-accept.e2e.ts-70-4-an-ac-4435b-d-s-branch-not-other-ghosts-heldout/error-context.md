# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: .werk-heldout/d-accept.e2e.ts >> 70.4 an accept takes only the accepted card's branch, not other ghosts
- Location: .werk-heldout/d-accept.e2e.ts:160:1

# Error details

```
Error: expect(received).toEqual(expected) // deep equality

- Expected  - 1
+ Received  + 1

  Object {
    "color": "oklch(0.707 0.165 254.624)",
-   "grey": true,
+   "grey": false,
    "style": "dashed",
  }
```

# Page snapshot

```yaml
- generic [ref=f3e2]:
  - generic [ref=f3e3]:
    - banner [ref=f3e4]:
      - generic [ref=f3e5]:
        - navigation "Breadcrumbs" [ref=f3e7]:
          - generic [ref=f3e8]:
            - button "Home" [ref=f3e9]
            - generic [ref=f3e10]: ›
            - button "Root" [ref=f3e11]
            - generic [ref=f3e12]: ›
            - generic [ref=f3e13]: Payments
        - generic [ref=f3e14]:
          - generic [ref=f3e15]:
            - 'generic "2 cards: this card and everything below it" [ref=f3e16]': "2"
            - generic "1 open" [ref=f3e18]: "1"
            - generic "1 decided" [ref=f3e21]: "1"
          - navigation "Views" [ref=f3e24]:
            - link "Map" [ref=f3e25] [cursor=pointer]:
              - /url: /map/payments
            - link "Board" [ref=f3e26] [cursor=pointer]:
              - /url: /board
          - searchbox "Search the map" [ref=f3e28]
    - main [ref=f3e29]:
      - generic [ref=f3e30]:
        - article [ref=f3e31]:
          - generic [ref=f3e32]:
            - button "#payments" [ref=f3e33]
            - generic [ref=f3e34]: card
            - generic [ref=f3e35]: decided
            - generic [ref=f3e36]: I decide
            - button "✕ Remove" [ref=f3e39]:
              - text: ✕
              - generic [ref=f3e40]: Remove
          - heading "Payments" [level=1] [ref=f3e41]
          - generic [ref=f3e45]:
            - generic [ref=f3e46]: this card and everything below it, 2 cards
            - generic [ref=f3e47]: 1 open
            - generic [ref=f3e49]: 1 decided
        - generic [ref=f3e51]:
          - heading "Refines" [level=2] [ref=f3e52]
          - list [ref=f3e53]:
            - listitem [ref=f3e54]:
              - link [ref=f3e55] [cursor=pointer]:
                - /url: /map/root
                - code [ref=f3e56]: "#root"
                - text: Root
        - generic [ref=f3e57]:
          - heading "Sub-cards 1 below, 1 proposed" [level=2] [ref=f3e58]
          - list [ref=f3e59]:
            - listitem [ref=f3e60]:
              - 'link "Refunds #refunds 1 evidence" [ref=f3e61] [cursor=pointer]':
                - /url: /map/refunds
                - generic [ref=f3e62]: Refunds
                - generic [ref=f3e63]:
                  - code [ref=f3e64]: "#refunds"
                  - generic [ref=f3e65]: 1 evidence
            - listitem [ref=f3e66]:
              - 'link "Chargebacks #chargebacks proposed" [ref=f3e67] [cursor=pointer]':
                - /url: /map/chargebacks
                - generic [ref=f3e68]: Chargebacks
                - generic [ref=f3e69]:
                  - code [ref=f3e70]: "#chargebacks"
                  - generic [ref=f3e71]: proposed
        - generic [ref=f3e72]:
          - heading "Thread" [level=2] [ref=f3e73]
          - paragraph [ref=f3e74]: No notes yet.
      - form "Add a note" [ref=f3e75]:
        - textbox "Note" [ref=f3e76]:
          - /placeholder: Write a note on this card's thread
        - generic [ref=f3e77]:
          - button "Add note" [disabled]
  - complementary "Chat" [ref=f3e78]:
    - list "Chat thread" [ref=f3e79]
    - form "Send a message" [ref=f3e80]:
      - textbox "Message" [ref=f3e81]:
        - /placeholder: Write to the agent
      - generic [ref=f3e82]:
        - button "Send" [disabled]
```

# Test source

```ts
  83  |   const p = quotedProject();
  84  |   const url = await serve(p).url;
  85  |   p.ok("quote", "billing", "pricing", "seats are the unit");
  86  |   await page.goto(`${url}/map/billing`);
  87  |   const row = page.locator('[data-link="supported_by"]').filter({ hasText: "seats are the unit" });
  88  |   await row.getByRole("link").first().click();
  89  |   await expect(page.locator("article[data-card]")).toHaveAttribute("data-proposed", "true");
  90  |   const accepts = () => p.lines().filter((l) => l.includes("change.accepted")).length;
  91  |   const before = accepts();
  92  |   await page.getByRole("button", { name: "Accept" }).click();
  93  |   await expect(page.locator("article[data-card]")).toHaveAttribute("data-proposed", "false");
  94  |   await expect(page.locator('[data-tag="proposed"]')).toHaveCount(0);
  95  |   expect(accepts()).toBe(before + 1);
  96  |   await page.goto(`${url}/map/billing`);
  97  |   const said = page.locator('[data-section="say"] [data-link="supported_by"]');
  98  |   await expect(said).toContainText("seats are the unit");
  99  |   await expect(said).toHaveAttribute("data-pending", "false");
  100 |   expect(p.ok("show", "billing")).not.toContain("held");
  101 | });
  102 | 
  103 | test("70.1 a proposed card shows as a ghost under its proposed parent", async ({ page }) => {
  104 |   const p = payments();
  105 |   const url = await serve(p).url;
  106 |   p.ok("add", "refunds", "--title", "Refunds", "--parent", "payments");
  107 |   await page.goto(`${url}/map/payments`);
  108 |   const tile = page.locator('#view [data-tile="refunds"]');
  109 |   await expect(tile).toContainText("Refunds");
  110 |   const ghost = await border(tile);
  111 |   await page.goto(`${url}/map`);
  112 |   const real = await border(page.locator('#view [data-tile="payments"]'));
  113 |   expect({ ghostStyle: ghost.style, ghostGrey: ghost.grey, ghostColor: ghost.color }).toEqual({
  114 |     ghostStyle: "dashed",
  115 |     ghostGrey: true,
  116 |     ghostColor: ghost.color,
  117 |   });
  118 |   expect(real.style).not.toBe("dashed");
  119 | });
  120 | 
  121 | test("70.2 the person accepts one ghost with the ✓ button and it becomes real", async ({ page }) => {
  122 |   const p = payments();
  123 |   const url = await serve(p).url;
  124 |   p.ok("add", "refunds", "--title", "Refunds", "--parent", "payments");
  125 |   const before = p.lines().length;
  126 |   await page.goto(`${url}/map/refunds`);
  127 |   await mark(page);
  128 |   await page.getByRole("button", { name: "Accept" }).click();
  129 |   await expect(page.locator("article[data-card]")).toHaveAttribute("data-proposed", "false");
  130 |   const added = p
  131 |     .lines()
  132 |     .slice(before)
  133 |     .map((l) => JSON.parse(l));
  134 |   expect(added).toHaveLength(1);
  135 |   expect(added[0]).toMatchObject({ type: "change.accepted", actor: "you", payload: { id: "refunds" } });
  136 |   await expect(page.getByRole("button", { name: "Accept" })).toHaveCount(0);
  137 |   await expect(page.locator('[data-section="refines"] [data-id="payments"]')).toBeVisible();
  138 |   expect(await marked(page)).toBe(true);
  139 |   await page.goto(`${url}/map/payments`);
  140 |   await expect(page.locator('#view [data-tile="refunds"]')).toHaveAttribute("data-proposed", "false");
  141 | });
  142 | 
  143 | test("70.3 accepting a ghost child under a ghost parent makes both real", async ({ page }) => {
  144 |   const p = payments();
  145 |   const url = await serve(p).url;
  146 |   p.ok("add", "refunds", "--title", "Refunds", "--parent", "payments");
  147 |   p.ok("add", "partial", "--title", "Partial refunds", "--parent", "refunds");
  148 |   await page.goto(`${url}/map/partial`);
  149 |   await page.getByRole("button", { name: "Accept" }).click();
  150 |   await expect(page.locator("article[data-card]")).toHaveAttribute("data-proposed", "false");
  151 |   await expect(page.locator('[data-section="refines"] [data-id="refunds"]')).toBeVisible();
  152 |   await page.goto(`${url}/map/payments`);
  153 |   await expect(page.locator('#view [data-tile="refunds"]')).toHaveAttribute("data-proposed", "false");
  154 |   await page.goto(`${url}/map/refunds`);
  155 |   await expect(page.locator("article[data-card]")).toHaveAttribute("data-proposed", "false");
  156 |   await expect(page.locator('#view [data-tile="partial"]')).toHaveAttribute("data-proposed", "false");
  157 |   await expect(page.locator('[data-section="refines"] [data-id="payments"]')).toBeVisible();
  158 | });
  159 | 
  160 | test("70.4 an accept takes only the accepted card's branch, not other ghosts", async ({ page }) => {
  161 |   const p = payments();
  162 |   const url = await serve(p).url;
  163 |   p.ok("add", "refunds", "--title", "Refunds", "--parent", "payments");
  164 |   p.ok("add", "chargebacks", "--title", "Chargebacks", "--parent", "payments");
  165 |   p.ok("add", "refunds:opt0", "--kind", "option", "--title", "No refunds", "--why_not", "Customers leave");
  166 |   p.ok("link", "refunds:opt0", "refunds", "--type", "alternative_to");
  167 |   p.ok("add", "refunds:src0", "--kind", "source", "--title", "Refund study", "--finding", "Most want refunds");
  168 |   p.ok("link", "refunds", "refunds:src0", "--type", "supported_by");
  169 |   await page.goto(`${url}/map/payments`);
  170 |   await expect(page.getByRole("button", { name: /accept (all|both|every)/i })).toHaveCount(0);
  171 |   await expect(page.locator("#view").getByRole("button", { name: "Accept" })).toHaveCount(0);
  172 |   await page.locator('#view [data-tile="refunds"]').click();
  173 |   await page.getByRole("button", { name: "Accept" }).click();
  174 |   await expect(page.locator("article[data-card]")).toHaveAttribute("data-proposed", "false");
  175 |   for (const id of ["refunds:opt0", "refunds:src0"]) {
  176 |     await page.goto(`${url}/map/${encodeURIComponent(id)}`);
  177 |     await expect(page.locator("article[data-card]")).toHaveAttribute("data-proposed", "false");
  178 |   }
  179 |   await page.goto(`${url}/map/payments`);
  180 |   const charge = page.locator('#view [data-tile="chargebacks"]');
  181 |   await expect(charge).toHaveAttribute("data-proposed", "true");
  182 |   const look = await border(charge);
> 183 |   expect({ style: look.style, grey: look.grey, color: look.color }).toEqual({
      |                                                                     ^ Error: expect(received).toEqual(expected) // deep equality
  184 |     style: "dashed",
  185 |     grey: true,
  186 |     color: look.color,
  187 |   });
  188 | });
  189 | 
  190 | test("70.5 a second view sees the accept because it reads the same log", async ({ context }) => {
  191 |   const p = payments();
  192 |   const url = await serve(p).url;
  193 |   p.ok("add", "refunds", "--title", "Refunds", "--parent", "payments");
  194 |   const one = await context.newPage();
  195 |   const two = await context.newPage();
  196 |   await one.goto(`${url}/map/refunds`);
  197 |   await two.goto(`${url}/map/refunds`);
  198 |   await expect(two.locator("article[data-card]")).toHaveAttribute("data-proposed", "true");
  199 |   await mark(two);
  200 |   await one.getByRole("button", { name: "Accept" }).click();
  201 |   await expect(two.locator("article[data-card]")).toHaveAttribute("data-proposed", "false");
  202 |   expect(await marked(two)).toBe(true);
  203 | });
  204 | 
  205 | function storage(): Proj {
  206 |   const p = proj();
  207 |   p.seed("node.added", { id: "root", kind: "card", title: "Root" });
  208 |   card(p, "storage", { title: "Storage" });
  209 |   p.ok("add", "sqlite", "--title", "Use SQLite", "--parent", "storage");
  210 |   return p;
  211 | }
  212 | 
  213 | test("18.1 accepting a proposed new card with the check mark makes it real without a reload", async ({ page }) => {
  214 |   const p = storage();
  215 |   const url = await serve(p).url;
  216 |   await page.goto(`${url}/map/sqlite`);
  217 |   const hero = page.locator("article[data-card]");
  218 |   await expect(hero.locator('[data-tag="proposed"]')).toHaveText("proposed");
  219 |   const blueBorder = await probe(page, "border-blue-400", "borderTopColor");
  220 |   const blueBg = await probe(page, "bg-blue-50", "backgroundColor");
  221 |   expect(await hero.evaluate((el) => getComputedStyle(el).borderTopColor)).toBe(blueBorder);
  222 |   expect(await hero.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(blueBg);
  223 |   const actions = hero.locator('[data-role="actions"]');
  224 |   await expect(actions.getByRole("button", { name: "Accept" })).toHaveText(/✓/);
  225 |   const box = await hero.boundingBox();
  226 |   const btn = await actions.getByRole("button", { name: "Accept" }).boundingBox();
  227 |   expect(btn && box && btn.x > box.x + box.width / 2 && btn.y < box.y + 80).toBe(true);
  228 |   await expect(page.getByRole("button", { name: /discard/i })).toHaveCount(0);
  229 |   const before = p.lines().length;
  230 |   await mark(page);
  231 |   await actions.getByRole("button", { name: "Accept" }).click();
  232 |   await expect(hero).toHaveAttribute("data-proposed", "false");
  233 |   await expect(hero.locator('[data-tag="proposed"]')).toHaveCount(0);
  234 |   expect(await hero.evaluate((el) => getComputedStyle(el).borderTopColor)).not.toBe(blueBorder);
  235 |   expect(await marked(page)).toBe(true);
  236 |   const events = p
  237 |     .lines()
  238 |     .slice(before)
  239 |     .map((l) => JSON.parse(l));
  240 |   expect(events.map((e) => [e.type, e.actor, e.payload])).toEqual([["change.accepted", "you", { id: "sqlite" }]]);
  241 |   const viaPage = p.ok("show", "sqlite");
  242 |   const q = storage();
  243 |   q.ok("accept", "sqlite", "--actor", "you");
  244 |   expect(q.ok("show", "sqlite")).toBe(viaPage);
  245 |   const cliEvent = JSON.parse(q.lines().at(-1) ?? "{}");
  246 |   expect([cliEvent.type, cliEvent.actor, cliEvent.payload]).toEqual([
  247 |     events[0].type,
  248 |     events[0].actor,
  249 |     events[0].payload,
  250 |   ]);
  251 | });
  252 | 
  253 | function cache(): Proj {
  254 |   const p = proj();
  255 |   p.seed("node.added", { id: "root", kind: "card", title: "Root" });
  256 |   p.seed("node.decided", { id: "root" });
  257 |   card(p, "cache", { title: "Cache layer", why: "Reads repeat.", body: "Entries expire after five minutes." });
  258 |   p.seed("kill.added", { id: "cache", criterion: { form: "revisit" } });
  259 |   return p;
  260 | }
  261 | 
  262 | test("18.2 a pending edit to a decided card shows as a diff and an accept amends the card", async ({ page }) => {
  263 |   const p = cache();
  264 |   const url = await serve(p).url;
  265 |   p.ok(
  266 |     "propose",
  267 |     "cache",
  268 |     "--ops",
  269 |     JSON.stringify([
  270 |       { tag: "elaborated", old: "Entries expire after five minutes.", new: "Entries expire after ten minutes." },
  271 |     ]),
  272 |   );
  273 |   await page.goto(`${url}/map/cache`);
  274 |   const hero = page.locator("article[data-card]");
  275 |   const blueBorder = await probe(page, "border-blue-400", "borderTopColor");
  276 |   const blueBg = await probe(page, "bg-blue-50", "backgroundColor");
  277 |   expect(await hero.evaluate((el) => getComputedStyle(el).borderTopColor)).toBe(blueBorder);
  278 |   expect(await hero.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(blueBg);
  279 |   await expect(hero.locator('[data-tag="proposed"]')).toHaveCount(0);
  280 |   await expect(hero.getByText("proposed", { exact: true })).toHaveCount(0);
  281 |   const added = hero.locator('[data-diff="added"]');
  282 |   const removed = hero.locator('[data-diff="removed"]');
  283 |   await expect(added).toHaveText("ten");
```