# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: .werk-heldout/g-review.e2e.ts >> 70.1 a proposed card shows as a ghost under its proposed parent
- Location: .werk-heldout/g-review.e2e.ts:289:1

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: true
Received: false
```

# Page snapshot

```yaml
- generic [ref=e2]:
  - generic [ref=e3]:
    - banner [ref=e4]:
      - generic [ref=e5]:
        - navigation "Breadcrumbs" [ref=e7]:
          - generic [ref=e8]:
            - button "Home" [ref=e9]
            - generic [ref=e10]: ›
            - button "Root" [ref=e11]
            - generic [ref=e12]: ›
            - generic [ref=e13]: Payments
        - generic [ref=e14]:
          - navigation "Views" [ref=e15]:
            - link "Map" [ref=e16] [cursor=pointer]:
              - /url: /map/payments
            - link "Board" [ref=e17] [cursor=pointer]:
              - /url: /board
          - searchbox "Search the map" [ref=e19]
    - main [ref=e20]:
      - generic [ref=e21]:
        - article [ref=e22]:
          - generic [ref=e23]:
            - button "#payments" [ref=e24]
            - generic [ref=e25]: card
            - generic [ref=e26]: open
            - button "✕ Remove" [ref=e28]:
              - text: ✕
              - generic [ref=e29]: Remove
          - heading "Payments" [level=1] [ref=e30]
        - generic [ref=e31]:
          - heading "Refines" [level=2] [ref=e32]
          - list [ref=e33]:
            - listitem [ref=e34]:
              - link [ref=e35] [cursor=pointer]:
                - /url: /map/root
                - code [ref=e36]: "#root"
                - text: Root
        - generic [ref=e37]:
          - heading "Sub-cards 0 below, 1 proposed" [level=2] [ref=e38]
          - list [ref=e39]:
            - listitem [ref=e40]:
              - 'link "Refunds #refunds proposed" [ref=e41] [cursor=pointer]':
                - /url: /map/refunds
                - generic [ref=e42]: Refunds
                - generic [ref=e43]:
                  - code [ref=e44]: "#refunds"
                  - generic [ref=e45]: proposed
        - generic [ref=e46]:
          - heading "Thread" [level=2] [ref=e47]
          - paragraph [ref=e48]: No notes yet.
      - form "Add a note" [ref=e49]:
        - textbox "Note" [ref=e50]:
          - /placeholder: Write a note on this card's thread
        - generic [ref=e51]:
          - button "Add note" [disabled]
  - complementary "Chat" [ref=e52]:
    - list "Chat thread" [ref=e53]
    - form "Send a message" [ref=e54]:
      - textbox "Message" [ref=e55]:
        - /placeholder: Write to the agent
      - generic [ref=e56]:
        - button "Send" [disabled]
```

# Test source

```ts
  197 |   const removed = body.locator('[data-diff="removed"]', { hasText: "one queue" }).first();
  198 |   await expect(removed).toBeVisible();
  199 |   expect(await removed.evaluate((el) => getComputedStyle(el).textDecorationLine)).toContain("line-through");
  200 |   expect(await isBlue(p, (await styleOf(removed)).background)).toBe(true);
  201 |   const addedList = body.locator('[data-diff="added"]', { hasText: "reads go through" }).first();
  202 |   await expect(addedList).toBeVisible();
  203 |   expect(await isBlue(p, (await styleOf(addedList)).background)).toBe(true);
  204 | });
  205 | 
  206 | // ---------------------------------------------------------------- 18.4
  207 | 
  208 | test("18.4 removing a card with two children offers subtree or reparent with counts", async ({ page: p }) => {
  209 |   const w = await project(undefined, (down) => {
  210 |     card(down, "server", { title: "Server" });
  211 |     card(down, "auth", { title: "Auth", parent: "server", status: "decided", who: "me" });
  212 |     card(down, "tokens", { title: "Tokens", parent: "auth" });
  213 |     card(down, "sessions", { title: "Sessions", parent: "auth" });
  214 |   });
  215 |   await p.goto(`${w.url}/map/auth`);
  216 |   const beforeHtml = await hero(p).innerHTML();
  217 |   await p.getByRole("button", { name: /remove/i }).click();
  218 |   const dialog = p.getByRole("dialog");
  219 |   await expect(dialog).toHaveCount(1);
  220 |   const answers = dialog.getByRole("button");
  221 |   await expect(answers).toHaveCount(3);
  222 |   await expect(answers.filter({ hasText: /subtree/i })).toContainText("3 cards");
  223 |   const reparent = answers.filter({ hasText: /Server/ });
  224 |   await expect(reparent).toContainText("1 card leaves");
  225 |   await expect(answers.filter({ hasText: /cancel/i })).toHaveCount(1);
  226 | 
  227 |   const before = events(w).length;
  228 |   await flagPage(p);
  229 |   await reparent.click();
  230 |   await expect(dialog).toHaveCount(0);
  231 |   await expect(p).toHaveURL(/\/map\/server$/);
  232 |   expect(await stillSamePage(p)).toBe(true);
  233 |   expect(events(w).length).toBe(before + 1);
  234 |   await expect(tile(p, "auth")).toHaveCount(0);
  235 |   await expect(tile(p, "tokens")).toBeVisible();
  236 |   await expect(tile(p, "sessions")).toBeVisible();
  237 | 
  238 |   w.werk("restore", "auth", "--actor", "you");
  239 |   await expect(tile(p, "auth")).toBeVisible();
  240 |   await expect(tile(p, "tokens")).toHaveCount(0);
  241 |   await p.goto(`${w.url}/map/auth`);
  242 |   expect(await hero(p).innerHTML()).toBe(beforeHtml);
  243 |   await expect(tile(p, "tokens")).toBeVisible();
  244 |   await expect(tile(p, "sessions")).toBeVisible();
  245 | });
  246 | 
  247 | // ---------------------------------------------------------------- 18.5
  248 | 
  249 | test("18.5 a proposed removal shows red, cancel changes nothing, a tokenless write is refused", async ({
  250 |   page: p,
  251 |   request,
  252 | }) => {
  253 |   const w = await project(undefined, (down) => {
  254 |     card(down, "legacy", { title: "Legacy importer", status: "decided", who: "me" });
  255 |     card(down, "notes", { title: "Old notes" });
  256 |   });
  257 |   w.werk("propose", "legacy", "--remove");
  258 |   await p.goto(`${w.url}/map/root`);
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
> 297 |   expect(await isGrey(p, g.border)).toBe(true);
      |                                     ^ Error: expect(received).toBe(expected) // Object.is equality
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
  359 |   expect(await isGrey(p, look.border)).toBe(true);
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
```