# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: heldout-17.spec.ts >> 17.4 Map and Board tabs
- Location: .werk-heldout/heldout-17.spec.ts:120:1

# Error details

```
Error: the address is /board

expect(received).toBe(expected) // Object.is equality

Expected: "/board"
Received: "/p/project/board"
```

# Page snapshot

```yaml
- generic [ref=f1e2]:
  - region "Map pane" [ref=f1e3]:
    - generic [ref=f1e4]:
      - generic [ref=f1e5]:
        - button "project ▾" [ref=f1e8]
        - navigation "Breadcrumbs" [ref=f1e10]:
          - generic [ref=f1e11]:
            - button "We build software with agents" [ref=f1e13] [cursor=pointer]
            - generic [ref=f1e14]:
              - generic [aria-hidden] [ref=f1e15]: ›
              - strong [ref=f1e16]: We charge per seat
      - generic [ref=f1e18]:
        - navigation "Views" [ref=f1e19]:
          - button "Map" [active] [ref=f1e20] [cursor=pointer]
          - button "Board" [ref=f1e21] [cursor=pointer]
        - searchbox "Search the map" [ref=f1e23]
    - article [ref=f1e25]:
      - region "Card" [ref=f1e26]:
        - button "Remove this card" [ref=f1e28] [cursor=pointer]: ✕
        - generic [ref=f1e29]:
          - button "#seats" [ref=f1e30] [cursor=pointer]
          - generic [ref=f1e31]: card
          - generic [ref=f1e32]: open
        - heading "We charge per seat" [level=1] [ref=f1e33]
  - complementary "Chat pane" [ref=f1e34]:
    - generic [ref=f1e36]:
      - log "Conversation" [ref=f1e38]
      - generic [ref=f1e39]:
        - generic [ref=f1e41]: idle
        - generic [ref=f1e42]:
          - combobox "Model" [ref=f1e43]:
            - option "Sonnet"
            - option "Opus"
            - option "Sonnet + Opus advisor" [selected]
          - button "Context 0% full" [ref=f1e45] [cursor=pointer]
      - textbox "Message" [ref=f1e47]:
        - /placeholder: Message the agent
```

# Test source

```ts
  29  |   }
  30  |   const crumbs = page.getByRole("navigation", { name: "Breadcrumbs" });
  31  |   const line = crumbs.locator("[data-slot=crumb-line]");
  32  |   await expect(line).toHaveText(/^\s*…\s*›\s*Level c\s*›\s*Level d\s*$/);
  33  |   await expect(line.locator("[data-slot=crumb-current]")).toHaveText("Level d");
  34  |   expect(await line.locator("[data-slot=crumb-current]").evaluate((e) => e.tagName)).toBe("STRONG");
  35  |   expect((await line.boundingBox())?.height).toBeLessThan(40);
  36  |   await line.hover({ force: true });
  37  |   const overlay = crumbs.locator("[data-slot=crumb-overlay]");
  38  |   await expect(overlay).toBeVisible();
  39  |   await expect(overlay).toHaveText(new RegExp(`${ROOT_TITLE}\\s*›\\s*Level a\\s*›\\s*Level b\\s*›\\s*Level c\\s*›\\s*Level d`));
  40  |   await overlay.getByRole("button", { name: "Level c" }).click();
  41  |   await expect(leftPane(page).getByRole("heading", { level: 1, name: "Level c" })).toBeVisible();
  42  |   await expect(line.locator("[data-slot=crumb-current]")).toHaveText("Level c");
  43  | });
  44  | 
  45  | test("17.2 header counts follow the open card", async ({ page, app }) => {
  46  |   put(
  47  |     app.dir,
  48  |     real("c-open", "Open child", { parent: "root" }),
  49  |     real("kid", "Kid", { parent: "c-open" }),
  50  |     real("c-proto", "Proto child", { parent: "root", status: "proto" }),
  51  |     decided("dec", "Decided child"),
  52  |     edge("dec", "root", "refines"),
  53  |     decided("base2", "Base two"),
  54  |     real("stale-child", "Stale child", { parent: "root" }),
  55  |     edge("stale-child", "base2", "depends_on"),
  56  |     { type: "node.reopened", id: "base2", reason: "invalidated", at: AT },
  57  |   );
  58  |   await page.goto(app.url);
  59  |   await expect(leftPane(page).getByRole("heading", { level: 1, name: ROOT_TITLE })).toBeVisible();
  60  |   const counts = page.locator("[data-slot=counts] [data-slot=count]");
  61  |   const n = async (kind: string) => {
  62  |     const el = page.locator(`[data-slot=count][data-kind=${kind}]`);
  63  |     return (await el.count()) === 0 ? null : Number(await el.innerText());
  64  |   };
  65  |   await expect(counts.first()).toBeVisible();
  66  |   const total = await n("total");
  67  |   const [o, p, d] = [await n("open"), await n("proto"), await n("decided")];
  68  |   expect(total).toBe(6);
  69  |   expect((o ?? 0) + (p ?? 0) + (d ?? 0)).toBe(total);
  70  |   expect([o, p, d]).toEqual([4, 1, 1]);
  71  |   await expect(page.locator("[data-slot=count][data-kind=open]")).toHaveAttribute("title", /open/);
  72  |   await expect(page.locator("[data-slot=count][data-kind=proto]")).toHaveAttribute("title", /proto/);
  73  |   await expect(page.locator("[data-slot=count][data-kind=decided]")).toHaveAttribute("title", /decided/);
  74  |   await expect(page.locator("[data-slot=count][data-kind=stale]")).toHaveAttribute("title", /stale/);
  75  | 
  76  |   await leftPane(page).locator("a.tile", { hasText: "Open child" }).click();
  77  |   await expect(leftPane(page).getByRole("heading", { level: 1, name: "Open child" })).toBeVisible();
  78  |   await expect(page.locator("[data-slot=count][data-kind=total]")).toHaveText("2");
  79  |   await expect(page.locator("[data-slot=count][data-kind=open]")).toHaveText("2");
  80  |   await expect(page.locator("[data-slot=count][data-kind=proto]")).toHaveCount(0);
  81  |   await expect(page.locator("[data-slot=count][data-kind=decided]")).toHaveCount(0);
  82  | });
  83  | 
  84  | test("17.3 search by id and open", async ({ page, app }) => {
  85  |   const events: unknown[] = [real("werk", "Werk itself", { parent: "root" })];
  86  |   for (const s of ["a", "b", "c"]) events.push(real(`werk-${s}`, `Werk ${s}`, { parent: "root" }));
  87  |   events.push(decided("base3", "Base three"));
  88  |   events.push(real("werk-stale", "Werk stale", { parent: "root" }), edge("werk-stale", "base3", "depends_on"));
  89  |   events.push({ type: "node.reopened", id: "base3", reason: "invalidated", at: AT });
  90  |   for (let i = 1; i <= 9; i++) events.push(real(`x-werk-${i}`, `Contains ${i}`, { parent: "root" }));
  91  |   put(app.dir, ...events);
  92  |   await page.goto(app.url);
  93  |   await expect(leftPane(page).getByRole("heading", { level: 1, name: ROOT_TITLE })).toBeVisible();
  94  |   const box = page.getByRole("searchbox", { name: "Search the map" });
  95  |   await box.fill("#werk");
  96  |   const rows = page.getByRole("list", { name: "Search results" }).getByRole("listitem");
  97  |   await expect(rows).toHaveCount(12);
  98  |   await expect(rows.first().locator("code")).toHaveText("werk");
  99  |   const ids = await rows.locator("code").allInnerTexts();
  100 |   const firstContains = ids.findIndex((id) => !id.startsWith("werk"));
  101 |   expect(firstContains).toBeGreaterThan(0);
  102 |   expect(ids.slice(firstContains).every((id) => !id.startsWith("werk"))).toBe(true);
  103 |   for (const i of [0, 1]) {
  104 |     const row = rows.nth(i);
  105 |     await expect(row.locator("[data-slot=dot]")).toHaveCount(1);
  106 |     await expect(row.locator("[data-slot=result-title]")).not.toBeEmpty();
  107 |     await expect(row.locator("code")).not.toBeEmpty();
  108 |   }
  109 |   await expect(rows.filter({ hasText: "werk-stale" }).locator("[data-slot=dot]")).toHaveAttribute("data-color", "stale");
  110 |   await box.press("ArrowDown");
  111 |   await expect(rows.nth(1)).toHaveAttribute("aria-current", "true");
  112 |   await box.press("ArrowUp");
  113 |   await expect(rows.first()).toHaveAttribute("aria-current", "true");
  114 |   await box.press("Enter");
  115 |   await expect(leftPane(page).getByRole("heading", { level: 1, name: "Werk itself" })).toBeVisible();
  116 |   await expect(page.locator("[data-slot=crumb-current]")).toHaveText("Werk itself");
  117 |   await expect(box).toHaveValue("");
  118 | });
  119 | 
  120 | test("17.4 Map and Board tabs", async ({ page, app }) => {
  121 |   put(app.dir, real("seats", "We charge per seat", { parent: "root" }));
  122 |   await page.goto(`${app.url}/map/seats`);
  123 |   await expect(leftPane(page).getByRole("heading", { level: 1, name: "We charge per seat" })).toBeVisible();
  124 |   const views = page.getByRole("navigation", { name: "Views" });
  125 |   await expect(views.getByRole("button", { name: "Map" })).toHaveAttribute("aria-current", "page");
  126 |   await views.getByRole("button", { name: "Board" }).click();
  127 |   await expect(views.getByRole("button", { name: "Board" })).toHaveAttribute("aria-current", "page");
  128 |   await expect(page.getByRole("heading", { name: "Board" })).toBeVisible();
> 129 |   expect.soft(new URL(page.url()).pathname, "the address is /board").toBe("/board");
      |                                                                      ^ Error: the address is /board
  130 |   await page.reload();
  131 |   await expect(page.getByRole("heading", { name: "Board" })).toBeVisible();
  132 |   await views.getByRole("button", { name: "Map" }).click();
  133 |   await expect(leftPane(page).getByRole("heading", { level: 1, name: "We charge per seat" })).toBeVisible();
  134 | });
  135 | 
```