# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: stale-steps.spec.ts >> 72.4 The card view of a paused card two hops away names the reopened card and the reason
- Location: .werk-heldout/e2e/stale-steps.spec.ts:96:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('region', { name: 'marks' }).getByRole('heading', { name: /Why this card is stale/ })
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "soft toBeVisible" getByRole('region', { name: 'marks' }).getByRole('heading', { name: /Why this card is stale/ }) with timeout 5000ms
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
  - article:
    - paragraph: "#c"
    - heading "Card C" [level=1]
    - term: kind
    - definition: card
    - term: status
    - definition: decided
    - term: who
    - definition: prototype
  - region "marks":
    - heading "Why this card is paused paused" [level=2]
    - list:
      - listitem:
        - paragraph:
          - link "#a Card A":
            - /url: "#a"
          - text: was reopened, postponed (event 16), along depends_on through
          - link "#b":
            - /url: "#b"
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
  2   |  * Steps 72.x: stale and paused marks in the map.
  3   |  * Setup of a decided card: add --who prototype, accept --actor you, then either
  4   |  * edit --no-basis (a root card) or link depends_on (a dependent), kill --form manual, status decided.
  5   |  * "--who prototype" removes the options fact (contract.ts). A reopen needs a decided card, so
  6   |  * card A (and X) is decided in every scenario.
  7   |  * Colours: "red" = r > 150, g < 80, b < 80. "grey" = |r-g|, |g-b|, |r-b| all < 10.
  8   |  */
  9   | import { expect, test, type Werk } from './harness.ts'
  10  | 
  11  | function decided(werk: Werk, id: string, title: string, dependsOn: string[] = []) {
  12  |   werk.cli(['add', id, '--title', title, '--who', 'prototype'])
  13  |   werk.cli(['accept', id, '--actor', 'you'])
  14  |   if (dependsOn.length === 0) werk.cli(['edit', id, '--no-basis', 'a root card'])
  15  |   for (const to of dependsOn) werk.cli(['link', id, to, '--type', 'depends_on', '--why', `${id} takes ${to}`])
  16  |   werk.cli(['kill', id, '--form', 'manual', '--text', 'check by use'])
  17  |   werk.cli(['status', id, 'decided'])
  18  | }
  19  | 
  20  | const rgb = (s: string) => {
  21  |   const m = s.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
  22  |   if (!m) throw new Error(`not a colour: ${s}`)
  23  |   return [Number(m[1]), Number(m[2]), Number(m[3])] as const
  24  | }
  25  | const isRed = (s: string) => {
  26  |   const [r, g, b] = rgb(s)
  27  |   return r > 150 && g < 80 && b < 80
  28  | }
  29  | const isGrey = (s: string) => {
  30  |   const [r, g, b] = rgb(s)
  31  |   return Math.abs(r - g) < 10 && Math.abs(g - b) < 10 && Math.abs(r - b) < 10
  32  | }
  33  | 
  34  | const tile = (page: import('@playwright/test').Page, id: string) => page.locator(`li[data-card-id="${id}"] > a`)
  35  | const markOf = (page: import('@playwright/test').Page, id: string) => tile(page, id).locator('> .mark')
  36  | const bg = (loc: import('@playwright/test').Locator) => loc.evaluate((el) => getComputedStyle(el).backgroundColor)
  37  | const stripe = (loc: import('@playwright/test').Locator) => loc.evaluate((el) => getComputedStyle(el).borderLeftColor)
  38  | 
  39  | function chain(werk: Werk) {
  40  |   decided(werk, 'a', 'Card A')
  41  |   decided(werk, 'b', 'Card B', ['a'])
  42  |   decided(werk, 'c', 'Card C', ['b'])
  43  | }
  44  | 
  45  | test('72.1 A rejected reopen marks only the direct dependent as stale, in red', async ({ page, werk }) => {
  46  |   chain(werk)
  47  |   werk.cli(['reopen', 'a', '--reason', 'rejected', '--why', 'The vendor dropped this API'])
  48  |   await page.goto(werk.url)
  49  |   const mb = markOf(page, 'b')
  50  |   await expect(mb).toHaveCount(1)
  51  |   await expect(mb).toHaveText('stale')
  52  |   const bBg = await bg(mb)
  53  |   expect(isRed(bBg), `stale mark background ${bBg}`).toBe(true)
  54  |   await expect(tile(page, 'b')).toHaveAttribute('data-status', 'decided')
  55  |   const decidedStripe = await stripe(tile(page, 'b'))
  56  |   expect(decidedStripe).toBe('rgb(46, 125, 50)')
  57  |   await expect(markOf(page, 'c').filter({ hasText: 'stale' })).toHaveCount(0)
  58  |   await expect(markOf(page, 'c').filter({ hasText: 'paused' })).toHaveCount(0)
  59  |   await expect(markOf(page, 'c')).toHaveCount(0)
  60  | })
  61  | 
  62  | test('72.2 A postponed reopen marks every downstream card as paused, in grey, and keeps the status colour', async ({ page, werk }) => {
  63  |   chain(werk)
  64  |   werk.cli(['reopen', 'a', '--reason', 'postponed', '--why', 'We build the engine next quarter'])
  65  |   await page.goto(werk.url)
  66  |   for (const id of ['b', 'c']) {
  67  |     const m = markOf(page, id)
  68  |     await expect(m).toHaveCount(1)
  69  |     await expect(m).toHaveText('paused')
  70  |     const c = await bg(m)
  71  |     expect(isGrey(c), `paused mark of ${id} background ${c}`).toBe(true)
  72  |     expect(isRed(c)).toBe(false)
  73  |   }
  74  |   await expect(tile(page, 'c')).toHaveAttribute('data-status', 'decided')
  75  |   expect(await stripe(tile(page, 'c'))).toBe('rgb(46, 125, 50)')
  76  |   await expect(page.locator('li[data-card-id="b"] > a > .mark[data-mark="stale"]')).toHaveCount(0)
  77  |   await expect(page.locator('li[data-card-id="c"] > a > .mark[data-mark="stale"]')).toHaveCount(0)
  78  | })
  79  | 
  80  | test('72.3 The card view of a stale card explains the change, the link, and the reason', async ({ page, werk }) => {
  81  |   decided(werk, 'a', 'Card A')
  82  |   decided(werk, 'b', 'Card B', ['a'])
  83  |   werk.cli(['reopen', 'a', '--reason', 'rejected', '--why', 'The vendor dropped this API'])
  84  |   await page.goto(werk.url)
  85  |   await tile(page, 'b').click()
  86  |   const marks = page.getByRole('region', { name: 'marks' })
  87  |   await expect(marks.getByRole('heading', { name: /Why this card is stale/ })).toBeVisible()
  88  |   const item = marks.locator('li').first()
  89  |   await expect(item).toContainText('#a')
  90  |   await expect(item).toContainText('was reopened')
  91  |   await expect(item).toContainText('depends_on')
  92  |   await expect(item).toContainText('rejected')
  93  |   await expect(item).toContainText('The vendor dropped this API')
  94  | })
  95  | 
  96  | test('72.4 The card view of a paused card two hops away names the reopened card and the reason', async ({ page, werk }) => {
  97  |   chain(werk)
  98  |   werk.cli(['reopen', 'a', '--reason', 'postponed', '--why', 'We build the engine next quarter'])
  99  |   await page.goto(werk.url)
  100 |   await tile(page, 'c').click()
  101 |   const marks = page.getByRole('region', { name: 'marks' })
> 102 |   await expect.soft(marks.getByRole("heading", { name: /Why this card is stale/ })).toBeVisible()
      |                                                                                     ^ Error: expect(locator).toBeVisible() failed
  103 |   const item = marks.locator('li').first()
  104 |   await expect(item).toContainText('#a')
  105 |   await expect(item).toContainText('was reopened')
  106 |   await expect(item).toContainText('postponed')
  107 |   await expect(item).toContainText('We build the engine next quarter')
  108 | })
  109 | 
  110 | test('72.5 A stale mark wins over a paused mark on the same card', async ({ page, werk }) => {
  111 |   decided(werk, 'a', 'Card A')
  112 |   decided(werk, 'x', 'Card X')
  113 |   decided(werk, 'b', 'Card B', ['a', 'x'])
  114 |   werk.cli(['reopen', 'x', '--reason', 'postponed', '--why', 'Later'])
  115 |   werk.cli(['reopen', 'a', '--reason', 'rejected', '--why', 'Wrong'])
  116 |   await page.goto(werk.url)
  117 |   const m = markOf(page, 'b')
  118 |   await expect(m).toHaveCount(1)
  119 |   await expect(m).toHaveText('stale')
  120 |   const c = await bg(m)
  121 |   expect(isRed(c), `mark background ${c}`).toBe(true)
  122 |   await expect(page.locator('li[data-card-id="b"] > a .mark[data-mark="paused"]')).toHaveCount(0)
  123 |   await tile(page, 'b').click()
  124 |   const marks = page.getByRole('region', { name: 'marks' })
  125 |   const itemA = marks.locator('li[data-cause="a"]')
  126 |   await expect(itemA).toHaveCount(1)
  127 |   await expect(itemA).toContainText('#a')
  128 |   await expect(itemA).toContainText('rejected')
  129 | })
  130 | 
```