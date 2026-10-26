# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: .werk-heldout/d-accept.e2e.ts >> 70.1 a proposed card shows as a ghost under its proposed parent
- Location: .werk-heldout/d-accept.e2e.ts:103:1

# Error details

```
Error: expect(received).toEqual(expected) // deep equality

- Expected  - 1
+ Received  + 1

  Object {
    "ghostColor": "oklch(0.707 0.165 254.624)",
-   "ghostGrey": true,
+   "ghostGrey": false,
    "ghostStyle": "dashed",
  }
```

# Page snapshot

```yaml
- generic [ref=f1e2]:
  - generic [ref=f1e3]:
    - banner [ref=f1e4]:
      - generic [ref=f1e5]:
        - navigation "Breadcrumbs" [ref=f1e7]:
          - generic [ref=f1e8]:
            - button "Home" [ref=f1e9]
            - generic [ref=f1e10]: ›
            - generic [ref=f1e11]: Root
        - generic [ref=f1e12]:
          - generic [ref=f1e13]:
            - 'generic "2 cards: this card and everything below it" [ref=f1e14]': "2"
            - generic "1 open" [ref=f1e16]: "1"
            - generic "1 decided" [ref=f1e19]: "1"
          - navigation "Views" [ref=f1e22]:
            - link "Map" [ref=f1e23] [cursor=pointer]:
              - /url: /map/root
            - link "Board" [ref=f1e24] [cursor=pointer]:
              - /url: /board
          - searchbox "Search the map" [ref=f1e26]
    - main [ref=f1e27]:
      - generic [ref=f1e28]:
        - article [ref=f1e29]:
          - generic [ref=f1e30]:
            - button "#root" [ref=f1e31]
            - generic [ref=f1e32]: card
            - generic [ref=f1e33]: open
            - button "✕ Remove" [ref=f1e35]:
              - text: ✕
              - generic [ref=f1e36]: Remove
          - heading "Root" [level=1] [ref=f1e37]
          - generic [ref=f1e41]:
            - generic [ref=f1e42]: this card and everything below it, 2 cards
            - generic [ref=f1e43]: 1 open
            - generic [ref=f1e45]: 1 decided
        - generic [ref=f1e47]:
          - heading "Sub-cards 1 below" [level=2] [ref=f1e48]
          - list [ref=f1e49]:
            - listitem [ref=f1e50]:
              - 'link "Payments #payments I decide" [ref=f1e51] [cursor=pointer]':
                - /url: /map/payments
                - generic [ref=f1e52]: Payments
                - generic [ref=f1e53]:
                  - code [ref=f1e54]: "#payments"
                  - generic [ref=f1e55]: I decide
        - generic [ref=f1e56]:
          - heading "Thread" [level=2] [ref=f1e57]
          - paragraph [ref=f1e58]: No notes yet.
      - form "Add a note" [ref=f1e59]:
        - textbox "Note" [ref=f1e60]:
          - /placeholder: Write a note on this card's thread
        - generic [ref=f1e61]:
          - button "Add note" [disabled]
  - complementary "Chat" [ref=f1e62]:
    - list "Chat thread" [ref=f1e63]
    - form "Send a message" [ref=f1e64]:
      - textbox "Message" [ref=f1e65]:
        - /placeholder: Write to the agent
      - generic [ref=f1e66]:
        - button "Send" [disabled]
```

# Test source

```ts
  13  |   const { style, color } = await at.evaluate((el) => {
  14  |     const s = getComputedStyle(el);
  15  |     return { style: s.borderTopStyle, color: s.borderTopColor };
  16  |   });
  17  |   return { style, color, grey: isGrey(color) };
  18  | }
  19  | 
  20  | function isGrey(color: string): boolean {
  21  |   const ok = /oklch\(([\d.]+)%? ([\d.]+) ([\d.]+)/.exec(color);
  22  |   if (ok) return Number(ok[2]) < 0.04;
  23  |   const rgb = /rgba?\((\d+), (\d+), (\d+)/.exec(color);
  24  |   if (rgb) {
  25  |     const v = rgb.slice(1, 4).map(Number);
  26  |     return Math.max(...v) - Math.min(...v) < 25;
  27  |   }
  28  |   return false;
  29  | }
  30  | 
  31  | /** The computed colour of a probe element that carries the given classes. */
  32  | const probe = (p: Page, classes: string, prop: "backgroundColor" | "borderTopColor") =>
  33  |   p.evaluate(
  34  |     ({ classes, prop }) => {
  35  |       const el = document.createElement("div");
  36  |       el.className = `border ${classes}`;
  37  |       document.body.append(el);
  38  |       const value = getComputedStyle(el)[prop];
  39  |       el.remove();
  40  |       return value;
  41  |     },
  42  |     { classes, prop },
  43  |   );
  44  | 
  45  | function payments(): Proj {
  46  |   const p = proj();
  47  |   p.seed("node.added", { id: "root", kind: "card", title: "Root" });
  48  |   card(p, "payments", { title: "Payments" });
  49  |   return p;
  50  | }
  51  | 
  52  | function quotedProject(): Proj {
  53  |   const p = proj();
  54  |   p.seed("node.added", { id: "root", kind: "card", title: "Root" });
  55  |   card(p, "billing", { title: "We bill per seat", body: "Seats are the unit." });
  56  |   mkdirSync(join(p.dir, ".werk", "chats"));
  57  |   const line = { speaker: "person", at: "t0", session: "s1", kind: "spoken", text: "seats are the unit we bill" };
  58  |   writeFileSync(join(p.dir, ".werk", "chats", "pricing.jsonl"), `${JSON.stringify(line)}\n`);
  59  |   return p;
  60  | }
  61  | 
  62  | test("06.1 a new excerpt for a card stages as a ghost and waits for the ✓", async ({ page }) => {
  63  |   const p = quotedProject();
  64  |   const url = await serve(p).url;
  65  |   const out = p.ok("quote", "billing", "pricing", "seats are the unit");
  66  |   expect(out).toContain("proposed");
  67  |   expect(out).not.toContain("added");
  68  |   await page.goto(`${url}/map/billing`);
  69  |   await expect(h1(page)).toHaveText("We bill per seat");
  70  |   await expect(page.locator('[data-tag="status"]')).toHaveText("decided");
  71  |   await expect(page.locator('[data-field="body"]')).toHaveText("Seats are the unit.");
  72  |   const row = page.locator('[data-link="supported_by"]').filter({ hasText: "seats are the unit" });
  73  |   await expect(row).toHaveCount(1);
  74  |   await expect(row).toHaveAttribute("data-pending", "true");
  75  |   await expect(row).toContainText("pending");
  76  |   await row.getByRole("link").first().click();
  77  |   await expect(page.locator("article[data-card]")).toHaveAttribute("data-proposed", "true");
  78  |   await expect(page.locator('[data-tag="proposed"]')).toBeVisible();
  79  |   await expect(page.getByRole("button", { name: "Accept" })).toBeVisible();
  80  | });
  81  | 
  82  | test("06.2 an accepted excerpt stops being a ghost and its link goes live", async ({ page }) => {
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
> 113 |   expect({ ghostStyle: ghost.style, ghostGrey: ghost.grey, ghostColor: ghost.color }).toEqual({
      |                                                                                       ^ Error: expect(received).toEqual(expected) // deep equality
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
  183 |   expect({ style: look.style, grey: look.grey, color: look.color }).toEqual({
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
```