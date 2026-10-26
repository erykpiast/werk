# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: .werk-heldout/g-review.e2e.ts >> 70.4 an accept takes only the accepted card's branch
- Location: .werk-heldout/g-review.e2e.ts:339:1

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: true
Received: false
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
            - generic "2 open" [ref=f3e18]: "2"
          - navigation "Views" [ref=f3e21]:
            - link "Map" [ref=f3e22] [cursor=pointer]:
              - /url: /map/payments
            - link "Board" [ref=f3e23] [cursor=pointer]:
              - /url: /board
          - searchbox "Search the map" [ref=f3e25]
    - main [ref=f3e26]:
      - generic [ref=f3e27]:
        - article [ref=f3e28]:
          - generic [ref=f3e29]:
            - button "#payments" [ref=f3e30]
            - generic [ref=f3e31]: card
            - generic [ref=f3e32]: open
            - button "✕ Remove" [ref=f3e34]:
              - text: ✕
              - generic [ref=f3e35]: Remove
          - heading "Payments" [level=1] [ref=f3e36]
          - generic [ref=f3e39]:
            - generic [ref=f3e40]: this card and everything below it, 2 cards
            - generic [ref=f3e41]: 2 open
        - generic [ref=f3e43]:
          - heading "Refines" [level=2] [ref=f3e44]
          - list [ref=f3e45]:
            - listitem [ref=f3e46]:
              - link [ref=f3e47] [cursor=pointer]:
                - /url: /map/root
                - code [ref=f3e48]: "#root"
                - text: Root
        - generic [ref=f3e49]:
          - heading "Sub-cards 1 below, 1 proposed" [level=2] [ref=f3e50]
          - list [ref=f3e51]:
            - listitem [ref=f3e52]:
              - 'link "Refunds #refunds 1 evidence" [ref=f3e53] [cursor=pointer]':
                - /url: /map/refunds
                - generic [ref=f3e54]: Refunds
                - generic [ref=f3e55]:
                  - code [ref=f3e56]: "#refunds"
                  - generic [ref=f3e57]: 1 evidence
            - listitem [ref=f3e58]:
              - 'link "Chargebacks #chargebacks proposed" [ref=f3e59] [cursor=pointer]':
                - /url: /map/chargebacks
                - generic [ref=f3e60]: Chargebacks
                - generic [ref=f3e61]:
                  - code [ref=f3e62]: "#chargebacks"
                  - generic [ref=f3e63]: proposed
        - generic [ref=f3e64]:
          - heading "Thread" [level=2] [ref=f3e65]
          - paragraph [ref=f3e66]: No notes yet.
      - form "Add a note" [ref=f3e67]:
        - textbox "Note" [ref=f3e68]:
          - /placeholder: Write a note on this card's thread
        - generic [ref=f3e69]:
          - button "Add note" [disabled]
  - complementary "Chat" [ref=f3e70]:
    - list "Chat thread" [ref=f3e71]
    - form "Send a message" [ref=f3e72]:
      - textbox "Message" [ref=f3e73]:
        - /placeholder: Write to the agent
      - generic [ref=f3e74]:
        - button "Send" [disabled]
```

# Test source

```ts
  259 |   const legacy = tile(p, "legacy");
  260 |   const look = await styleOf(legacy);
  261 |   const c = await colour(p, look.border);
  262 |   expect(c.r).toBeGreaterThan(c.g + 40);
  263 |   expect(c.r).toBeGreaterThan(c.b + 40);
  264 | 
  265 |   await p.goto(`${w.url}/map/notes`);
  266 |   const before = readFileSync(logOf(w), "utf8");
  267 |   await p.getByRole("button", { name: /remove/i }).click();
  268 |   await p
  269 |     .getByRole("dialog")
  270 |     .getByRole("button", { name: /cancel/i })
  271 |     .click();
  272 |   await expect(p.getByRole("heading", { level: 1 })).toHaveText("Old notes");
  273 |   expect(readFileSync(logOf(w), "utf8")).toBe(before);
  274 | 
  275 |   await flagPage(p);
  276 |   const answer = await request.post(`${w.url}/api/remove`, { data: { id: "notes" } });
  277 |   expect(answer.status()).toBeGreaterThanOrEqual(400);
  278 |   expect(readFileSync(logOf(w), "utf8")).toBe(before);
  279 |   await expect(p.getByRole("heading", { level: 1 })).toHaveText("Old notes");
  280 |   expect(await stillSamePage(p)).toBe(true);
  281 | });
  282 | 
  283 | // ---------------------------------------------------------------- 70.x
  284 | 
  285 | function payments(): Promise<Werk> {
  286 |   return project(undefined, (down) => card(down, "payments", { title: "Payments" }));
  287 | }
  288 | 
  289 | test("70.1 a proposed card shows as a ghost under its proposed parent", async ({ page: p }) => {
  290 |   const w = await payments();
  291 |   w.werk("add", "refunds", "--title", "Refunds", "--parent", "payments");
  292 |   await p.goto(`${w.url}/map/payments`);
  293 |   const ghost = tile(p, "refunds");
  294 |   await expect(ghost).toBeVisible();
  295 |   const g = await styleOf(ghost);
  296 |   expect(g.borderStyle).toBe("dashed");
  297 |   expect(await isGrey(p, g.border)).toBe(true);
  298 |   const real = hero(p);
  299 |   const r = await styleOf(real);
  300 |   expect(r.borderStyle).not.toBe("dashed");
  301 |   await p.goto(`${w.url}/map/root`);
  302 |   const realTile = await styleOf(tile(p, "payments"));
  303 |   expect(realTile.borderStyle).not.toBe("dashed");
  304 | });
  305 | 
  306 | test("70.2 the person accepts one ghost with the ✓ and it becomes real", async ({ page: p }) => {
  307 |   const w = await payments();
  308 |   w.werk("add", "refunds", "--title", "Refunds", "--parent", "payments");
  309 |   await p.goto(`${w.url}/map/refunds`);
  310 |   const before = events(w).length;
  311 |   await p.getByRole("button", { name: /accept/i }).click();
  312 |   await expect(hero(p)).toHaveAttribute("data-proposed", "false");
  313 |   const added = events(w).slice(before);
  314 |   const accepts = added.filter((e) => /accept/.test(e.type) && JSON.stringify(e.payload).includes("refunds"));
  315 |   expect(accepts.length).toBe(1);
  316 |   expect(accepts[0]?.actor).toBe("you");
  317 |   await expect(p.getByRole("button", { name: /accept/i })).toHaveCount(0);
  318 |   await p.goto(`${w.url}/map/payments`);
  319 |   await expect(tile(p, "refunds")).toHaveAttribute("data-proposed", "false");
  320 | });
  321 | 
  322 | test("70.3 accepting a ghost child under a ghost parent makes both real", async ({ page: p }) => {
  323 |   const w = await payments();
  324 |   w.werk("add", "refunds", "--title", "Refunds", "--parent", "payments");
  325 |   w.werk("add", "partial", "--title", "Partial refunds", "--parent", "refunds");
  326 |   await p.goto(`${w.url}/map/partial`);
  327 |   await flagPage(p);
  328 |   await p.getByRole("button", { name: /accept/i }).click();
  329 |   await expect(hero(p)).toHaveAttribute("data-proposed", "false");
  330 |   expect(await stillSamePage(p)).toBe(true);
  331 |   await p.goto(`${w.url}/map/refunds`);
  332 |   await expect(hero(p)).toHaveAttribute("data-proposed", "false");
  333 |   await expect(tile(p, "partial")).toBeVisible();
  334 |   await p.goto(`${w.url}/map/payments`);
  335 |   await expect(tile(p, "refunds")).toBeVisible();
  336 |   await expect(tile(p, "refunds")).toHaveAttribute("data-proposed", "false");
  337 | });
  338 | 
  339 | test("70.4 an accept takes only the accepted card's branch", async ({ page: p }) => {
  340 |   const w = await payments();
  341 |   w.werk("add", "refunds", "--title", "Refunds", "--parent", "payments");
  342 |   w.werk("add", "chargebacks", "--title", "Chargebacks", "--parent", "payments");
  343 |   w.werk("add", "refunds:opt0", "--kind", "option", "--title", "Store credit", "--why_not", "People want money.");
  344 |   w.werk("link", "refunds:opt0", "refunds", "--type", "alternative_to");
  345 |   w.werk("add", "policy", "--kind", "source", "--title", "Refund policy", "--finding", "Refunds within 30 days.");
  346 |   w.werk("link", "refunds", "policy", "--type", "supported_by");
  347 |   await p.goto(`${w.url}/map/refunds`);
  348 |   await p.getByRole("button", { name: /accept/i }).click();
  349 |   await expect(hero(p)).toHaveAttribute("data-proposed", "false");
  350 |   await p.goto(`${w.url}/map/refunds:opt0`);
  351 |   await expect(hero(p)).toHaveAttribute("data-proposed", "false");
  352 |   await p.goto(`${w.url}/map/policy`);
  353 |   await expect(hero(p)).toHaveAttribute("data-proposed", "false");
  354 |   await p.goto(`${w.url}/map/payments`);
  355 |   const charge = tile(p, "chargebacks");
  356 |   await expect(charge).toHaveAttribute("data-proposed", "true");
  357 |   const look = await styleOf(charge);
  358 |   expect(look.borderStyle).toBe("dashed");
> 359 |   expect(await isGrey(p, look.border)).toBe(true);
      |                                        ^ Error: expect(received).toBe(expected) // Object.is equality
  360 |   await expect(p.getByRole("button", { name: /accept all|accept every|accept both/i })).toHaveCount(0);
  361 | });
  362 | 
  363 | test("70.5 a second view sees the accept because it reads the same log", async ({ page: p, context }) => {
  364 |   const w = await payments();
  365 |   w.werk("add", "refunds", "--title", "Refunds", "--parent", "payments");
  366 |   const second = await context.newPage();
  367 |   await p.goto(`${w.url}/map/refunds`);
  368 |   await second.goto(`${w.url}/map/refunds`);
  369 |   await expect(hero(second)).toHaveAttribute("data-proposed", "true");
  370 |   await p.getByRole("button", { name: /accept/i }).click();
  371 |   await expect(hero(p)).toHaveAttribute("data-proposed", "false");
  372 |   await expect(hero(second)).toHaveAttribute("data-proposed", "false");
  373 | });
  374 | 
  375 | // ---------------------------------------------------------------- 06.x
  376 | 
  377 | async function quotedCard(): Promise<Werk> {
  378 |   const w = await project(undefined, (down) => {
  379 |     card(down, "billing", { title: "We bill per seat", body: "Seats are counted monthly." });
  380 |     down.seed("node.decided", { id: "billing" });
  381 |   });
  382 |   mkdirSync(join(w.dir, ".werk", "chats"), { recursive: true });
  383 |   const line = { speaker: "person", at: "t0", session: "s1", kind: "spoken", text: "seats are the unit we bill" };
  384 |   writeFileSync(join(w.dir, ".werk", "chats", "pricing.jsonl"), `${JSON.stringify(line)}\n`);
  385 |   return w;
  386 | }
  387 | 
  388 | const said = (p: Page) => p.locator('[data-section="say"] [data-link="supported_by"]');
  389 | 
  390 | test("06.1 a new excerpt for a card stages as a ghost and waits for the ✓", async ({ page: p }) => {
  391 |   const w = await quotedCard();
  392 |   await p.goto(`${w.url}/map/billing`);
  393 |   const statusBefore = await p.locator('[data-tag="status"]').textContent();
  394 |   const wordsBefore = await hero(p).locator('[data-field="body"]').textContent();
  395 |   const out = w.werk("quote", "billing", "pricing", "seats are the unit");
  396 |   expect(out).toContain("proposed");
  397 |   expect(out).not.toContain("added");
  398 |   const id = /^(\S+):\s*proposed/.exec(out)?.[1] ?? "billing:ex0";
  399 | 
  400 |   await p.goto(`${w.url}/map/billing`);
  401 |   const row = said(p);
  402 |   await expect(row).toHaveCount(1);
  403 |   await expect(row).toHaveAttribute("data-pending", "true");
  404 |   await expect(row).toContainText("pending");
  405 |   await expect(p.locator('[data-tag="status"]')).toHaveText(statusBefore ?? "decided");
  406 |   await expect(hero(p).locator('[data-field="body"]')).toHaveText(wordsBefore ?? "");
  407 | 
  408 |   await p.goto(`${w.url}/map/${id}`);
  409 |   await expect(hero(p)).toHaveAttribute("data-proposed", "true");
  410 |   await expect(p.getByRole("button", { name: /accept/i })).toContainText("✓");
  411 | });
  412 | 
  413 | test("06.2 an accepted excerpt stops being a ghost and its link goes live", async ({ page: p }) => {
  414 |   const w = await quotedCard();
  415 |   const out = w.werk("quote", "billing", "pricing", "seats are the unit");
  416 |   const id = /^(\S+):\s*proposed/.exec(out)?.[1] ?? "billing:ex0";
  417 |   await p.goto(`${w.url}/map/${id}`);
  418 |   await expect(hero(p)).toHaveAttribute("data-proposed", "true");
  419 |   await p.getByRole("button", { name: /accept/i }).click();
  420 |   await expect(hero(p)).toHaveAttribute("data-proposed", "false");
  421 |   await p.goto(`${w.url}/map/billing`);
  422 |   const row = said(p);
  423 |   await expect(row).toHaveCount(1);
  424 |   await expect(row).toContainText("seats are the unit");
  425 |   await expect(row).toHaveAttribute("data-pending", "false");
  426 |   await expect(p.getByRole("button", { name: /accept/i })).toHaveCount(0);
  427 | });
  428 | 
```