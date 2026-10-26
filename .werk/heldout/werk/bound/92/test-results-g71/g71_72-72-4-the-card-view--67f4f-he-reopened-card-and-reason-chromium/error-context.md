# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: g71_72.spec.ts >> 72.4 the card view of a paused card two hops away names the reopened card and reason
- Location: .werk-heldout/e2e/g71_72.spec.ts:153:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('region', { name: 'marks' }).getByRole('heading', { name: /Why this card is stale/ })
Expected: visible
Timeout: 3000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" getByRole('region', { name: 'marks' }).getByRole('heading', { name: /Why this card is stale/ }) with timeout 3000ms
  - waiting for getByRole('region', { name: 'marks' }).getByRole('heading', { name: /Why this card is stale/ })

```

```yaml
- navigation "views":
  - link "Map":
    - /url: "#"
  - link "Board":
    - /url: "#/board"
- main:
  - navigation "breadcrumbs":
    - link "The map":
      - /url: "#"
    - text: /
    - 'link "werk: a visual layer over Claude Code"':
      - /url: "#werk"
  - article:
    - paragraph: "#cc"
    - heading "Card C" [level=1]
    - term: kind
    - definition: card
    - term: status
    - definition: decided
    - term: who
    - definition: me
  - region "marks":
    - heading "Why this card is paused paused" [level=2]
    - list:
      - listitem:
        - paragraph:
          - link "#ca Card A":
            - /url: "#ca"
          - text: was reopened, postponed (event 25), along depends_on through
          - link "#cb":
            - /url: "#cb"
          - text: .
        - text: "why:"
        - paragraph: We build the engine next quarter
    - paragraph: This card keeps its status. The mark clears when the postponed card is decided again.
  - region "sub-cards":
    - heading "Sub-cards" [level=2]
    - paragraph: No sub-cards.
```

# Test source

```ts
  66  | })
  67  | 
  68  | test('71.4 a tile summary holds no link, a note on the open card does', async ({ page, werk }) => {
  69  |   card(werk, 'al-diff', 'Diff the alignment')
  70  |   card(werk, 'ref-card', 'Follows up on #al-diff')
  71  |   werk.cli(['say', 'ref-card', '--text', 'See al-diff first'])
  72  |   await page.goto(werk.url)
  73  |   // The fixture's #map is a child of #werk in the tree.
  74  |   const t = tile(page, 'ref-card')
  75  |   await expect(t).toContainText('Follows up on #al-diff')
  76  |   await expect(t.locator('a')).toHaveCount(0)
  77  |   await t.click()
  78  |   await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'ref-card')
  79  |   const notes = page.getByRole('region', { name: 'notes' })
  80  |   await expect(notes.locator('a', { hasText: /^al-diff$/ })).toHaveCount(1)
  81  | })
  82  | 
  83  | test('71.5 fenced code is boxed, highlighted, keeps indentation, and scrolls sideways', async ({ page, werk }) => {
  84  |   const long = `        "deep": "${'y'.repeat(400)}"`
  85  |   const lines = ['{', '    "outer": {', '        "inner": {', long, '        }', '    }', '}']
  86  |   card(werk, 'code-card', 'Code', ['--body', ['Intro text.', '', '```json', ...lines, '```', '', 'After text.'].join('\n')])
  87  |   await page.goto(`${werk.url}#code-card`)
  88  |   const article = page.getByTestId('card')
  89  |   const pre = article.locator('.body pre')
  90  |   await expect(pre).toHaveCount(1)
  91  |   await expect(pre).toHaveCSS('border-top-style', 'solid')
  92  |   expect(await pre.locator('[class^="tok-"]').count()).toBeGreaterThan(0)
  93  |   expect(await pre.evaluate((el) => el.textContent)).toBe(lines.join('\n'))
  94  |   expect(await pre.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
  95  |   await pre.evaluate((el) => (el.scrollLeft = el.scrollWidth))
  96  |   expect(await pre.evaluate((el) => el.scrollLeft > 0)).toBe(true)
  97  |   const body = article.locator('.body')
  98  |   expect(await body.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
  99  |   expect(await article.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
  100 |   expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  101 | })
  102 | 
  103 | // ---------- 72 ----------
  104 | 
  105 | const RED = 'rgb(179, 38, 30)'
  106 | const GREY = 'rgb(117, 117, 117)'
  107 | const GREEN = 'rgb(46, 125, 50)'
  108 | 
  109 | test('72.1 a rejected reopen marks only the direct dependent stale, in red', async ({ page, werk }) => {
  110 |   decided(werk, 'ca', 'Card A')
  111 |   decided(werk, 'cb', 'Card B', ['ca'])
  112 |   decided(werk, 'cc', 'Card C', ['cb'])
  113 |   werk.cli(['reopen', 'ca', '--reason', 'rejected', '--why', 'The storage choice is wrong'])
  114 |   await page.goto(werk.url)
  115 |   await expect(markOf(page, 'cb', 'stale')).toHaveCount(1)
  116 |   await expect(markOf(page, 'cb', 'stale')).toHaveCSS('background-color', RED)
  117 |   await expect(tile(page, 'cb')).toHaveAttribute('data-status', 'decided')
  118 |   await expect(tile(page, 'cb')).toHaveCSS('border-left-color', GREEN)
  119 |   await expect(markOf(page, 'cc', 'stale')).toHaveCount(0)
  120 |   await expect(markOf(page, 'cc', 'paused')).toHaveCount(0)
  121 | })
  122 | 
  123 | test('72.2 a postponed reopen pauses every downstream card in grey and keeps the status colour', async ({ page, werk }) => {
  124 |   decided(werk, 'ca', 'Card A')
  125 |   decided(werk, 'cb', 'Card B', ['ca'])
  126 |   decided(werk, 'cc', 'Card C', ['cb'])
  127 |   werk.cli(['reopen', 'ca', '--reason', 'postponed', '--why', 'It waits'])
  128 |   await page.goto(werk.url)
  129 |   for (const id of ['cb', 'cc']) {
  130 |     await expect(markOf(page, id, 'paused')).toHaveCount(1)
  131 |     await expect(markOf(page, id, 'paused')).toHaveCSS('background-color', GREY)
  132 |     await expect(markOf(page, id, 'stale')).toHaveCount(0)
  133 |   }
  134 |   await expect(tile(page, 'cc')).toHaveAttribute('data-status', 'decided')
  135 |   await expect(tile(page, 'cc')).toHaveCSS('border-left-color', GREEN)
  136 | })
  137 | 
  138 | test('72.3 the card view of a stale card explains the change, the link and the reason', async ({ page, werk }) => {
  139 |   decided(werk, 'ca', 'Card A')
  140 |   decided(werk, 'cb', 'Card B', ['ca'])
  141 |   werk.cli(['reopen', 'ca', '--reason', 'rejected', '--why', 'The vendor dropped this API'])
  142 |   await page.goto(werk.url)
  143 |   await tile(page, 'cb').click()
  144 |   const marks = page.getByRole('region', { name: 'marks' })
  145 |   await expect(marks.getByRole('heading', { name: /Why this card is stale/ })).toBeVisible()
  146 |   await expect(marks).toContainText('#ca')
  147 |   await expect(marks).toContainText('reopened')
  148 |   await expect(marks).toContainText('depends_on')
  149 |   await expect(marks).toContainText('rejected')
  150 |   await expect(marks).toContainText('The vendor dropped this API')
  151 | })
  152 | 
  153 | test('72.4 the card view of a paused card two hops away names the reopened card and reason', async ({ page, werk }) => {
  154 |   decided(werk, 'ca', 'Card A')
  155 |   decided(werk, 'cb', 'Card B', ['ca'])
  156 |   decided(werk, 'cc', 'Card C', ['cb'])
  157 |   werk.cli(['reopen', 'ca', '--reason', 'postponed', '--why', 'We build the engine next quarter'])
  158 |   await page.goto(werk.url)
  159 |   await tile(page, 'cc').click()
  160 |   const marks = page.getByRole('region', { name: 'marks' })
  161 |   await expect(marks).toContainText('#ca')
  162 |   await expect(marks).toContainText('reopened')
  163 |   await expect(marks).toContainText('postponed')
  164 |   await expect(marks).toContainText('We build the engine next quarter')
  165 |   // Checked last: the step names the heading text exactly.
> 166 |   await expect(marks.getByRole('heading', { name: /Why this card is stale/ })).toBeVisible({ timeout: 3000 })
      |                                                                                ^ Error: expect(locator).toBeVisible() failed
  167 | })
  168 | 
  169 | test('72.5 a stale mark wins over a paused mark on the same card', async ({ page, werk }) => {
  170 |   decided(werk, 'ca', 'Card A')
  171 |   decided(werk, 'cx', 'Card X')
  172 |   decided(werk, 'cb', 'Card B', ['ca', 'cx'])
  173 |   werk.cli(['reopen', 'cx', '--reason', 'postponed', '--why', 'X waits'])
  174 |   werk.cli(['reopen', 'ca', '--reason', 'rejected', '--why', 'A is wrong'])
  175 |   await page.goto(werk.url)
  176 |   await expect(markOf(page, 'cb', 'stale')).toHaveCount(1)
  177 |   await expect(markOf(page, 'cb', 'stale')).toHaveCSS('background-color', RED)
  178 |   await expect(markOf(page, 'cb', 'paused')).toHaveCount(0)
  179 |   await tile(page, 'cb').click()
  180 |   const marks = page.getByRole('region', { name: 'marks' })
  181 |   await expect(marks.locator('li[data-cause="ca"][data-reason="rejected"]')).toHaveCount(1)
  182 |   await expect(marks).toContainText('rejected')
  183 | })
  184 | 
```