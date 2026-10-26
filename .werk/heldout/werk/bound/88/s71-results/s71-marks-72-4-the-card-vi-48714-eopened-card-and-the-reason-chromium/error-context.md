# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: s71-marks.spec.ts >> 72.4 the card view of a paused card two hops away names the reopened card and the reason
- Location: .werk-heldout/s71-marks.spec.ts:67:1

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: getByRole('region', { name: 'marks' }).getByRole('heading', { level: 2 })
Expected substring: "Why this card is stale"
Received string:    "Why this card is paused paused"
Timeout: 5000ms

Call log:
  - Expect "soft toContainText" getByRole('region', { name: 'marks' }).getByRole('heading', { level: 2 }) with timeout 5000ms
  - waiting for getByRole('region', { name: 'marks' }).getByRole('heading', { level: 2 })
    14 × locator resolved to <h2>…</h2>
       - unexpected value "Why this card is paused paused"

```

```yaml
- heading "Why this card is paused paused" [level=2]
```

# Test source

```ts
  1  | /** Held-out group 72: stale and paused marks on the map. */
  2  | import { join } from 'node:path'
  3  | import { appendEvent } from '../src/map/log.ts'
  4  | import { accepted, killed, linked, noBasis, proposed, statusSet, whoSet } from '../src/test/map-events.ts'
  5  | import { expect, test, type Werk } from '../e2e/harness.ts'
  6  | 
  7  | const GREEN = 'rgb(46, 125, 50)'
  8  | const RED = 'rgb(179, 38, 30)'
  9  | const GREY = 'rgb(117, 117, 117)'
  10 | 
  11 | /** Appends decided cards and depends_on links to the copy's decision log. */
  12 | function setUp(werk: Werk, ids: string[], deps: [string, string][]) {
  13 |   const log = join(werk.dir, '.werk', 'log.jsonl')
  14 |   for (const id of ids) {
  15 |     appendEvent(log, proposed(id, { title: `Card ${id.toUpperCase()}` }), 'agent')
  16 |     appendEvent(log, accepted(id), 'you')
  17 |     appendEvent(log, whoSet(id, 'me'), 'agent')
  18 |     appendEvent(log, noBasis(id, 'a test card'), 'agent')
  19 |     appendEvent(log, killed(id), 'agent')
  20 |     appendEvent(log, statusSet(id, 'decided'), 'agent')
  21 |   }
  22 |   for (const [from, to] of deps) appendEvent(log, linked(from, to, 'depends_on'), 'agent')
  23 | }
  24 | 
  25 | const tile = (page: import('@playwright/test').Page, id: string) => page.locator(`li[data-card-id="${id}"] > a`)
  26 | 
  27 | test('72.1 a rejected reopen marks only the direct dependent as stale, in red', async ({ page, werk }) => {
  28 |   setUp(werk, ['a', 'b', 'c'], [['b', 'a'], ['c', 'b']])
  29 |   werk.cli(['reopen', 'a', '--reason', 'rejected', '--why', 'The API is gone.'])
  30 |   await page.goto(werk.url)
  31 |   const b = tile(page, 'b')
  32 |   await expect(b.locator('.mark[data-mark="stale"]')).toHaveCSS('background-color', RED)
  33 |   await expect(b).toHaveAttribute('data-status', 'decided')
  34 |   await expect(b).toHaveCSS('border-left-color', GREEN)
  35 |   const c = tile(page, 'c')
  36 |   await expect(c).toBeVisible()
  37 |   await expect(c.locator('.mark[data-mark="stale"]')).toHaveCount(0)
  38 |   await expect(c.locator('.mark[data-mark="paused"]')).toHaveCount(0)
  39 | })
  40 | 
  41 | test('72.2 a postponed reopen marks every downstream card as paused, in grey, and keeps the status colour', async ({ page, werk }) => {
  42 |   setUp(werk, ['a', 'b', 'c'], [['b', 'a'], ['c', 'b']])
  43 |   werk.cli(['reopen', 'a', '--reason', 'postponed', '--why', 'Later.'])
  44 |   await page.goto(werk.url)
  45 |   for (const id of ['b', 'c']) {
  46 |     await expect(tile(page, id).locator('.mark[data-mark="paused"]')).toHaveCSS('background-color', GREY)
  47 |     await expect(tile(page, id).locator('.mark[data-mark="stale"]')).toHaveCount(0)
  48 |   }
  49 |   await expect(tile(page, 'c')).toHaveAttribute('data-status', 'decided')
  50 |   await expect(tile(page, 'c')).toHaveCSS('border-left-color', GREEN)
  51 | })
  52 | 
  53 | test('72.3 the card view of a stale card explains the change, the link, and the reason', async ({ page, werk }) => {
  54 |   setUp(werk, ['a', 'b'], [['b', 'a']])
  55 |   werk.cli(['reopen', 'a', '--reason', 'rejected', '--why', 'The vendor dropped this API'])
  56 |   await page.goto(werk.url)
  57 |   await tile(page, 'b').click()
  58 |   const marks = page.getByRole('region', { name: 'marks' })
  59 |   await expect(marks.getByRole('heading', { level: 2 })).toContainText('Why this card is stale')
  60 |   const item = marks.locator('li').first()
  61 |   await expect(item).toContainText('#a Card A was reopened')
  62 |   await expect(item).toContainText('depends_on')
  63 |   await expect(item).toContainText('rejected')
  64 |   await expect(item).toContainText('The vendor dropped this API')
  65 | })
  66 | 
  67 | test('72.4 the card view of a paused card two hops away names the reopened card and the reason', async ({ page, werk }) => {
  68 |   setUp(werk, ['a', 'b', 'c'], [['b', 'a'], ['c', 'b']])
  69 |   werk.cli(['reopen', 'a', '--reason', 'postponed', '--why', 'We build the engine next quarter'])
  70 |   await page.goto(werk.url)
  71 |   await tile(page, 'c').click()
  72 |   await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'c')
  73 |   const marks = page.getByRole('region', { name: 'marks' })
> 74 |   await expect.soft(marks.getByRole('heading', { level: 2 })).toContainText('Why this card is stale')
     |                                                               ^ Error: expect(locator).toContainText(expected) failed
  75 |   const item = marks.locator('li').first()
  76 |   await expect(item).toContainText('#a Card A was reopened')
  77 |   await expect(item).toContainText('postponed')
  78 |   await expect(item).toContainText('We build the engine next quarter')
  79 | })
  80 | 
  81 | test('72.5 a stale mark wins over a paused mark on the same card', async ({ page, werk }) => {
  82 |   setUp(werk, ['a', 'x', 'b'], [['b', 'a'], ['b', 'x']])
  83 |   werk.cli(['reopen', 'x', '--reason', 'postponed', '--why', 'Not now.'])
  84 |   werk.cli(['reopen', 'a', '--reason', 'rejected', '--why', 'Wrong.'])
  85 |   await page.goto(werk.url)
  86 |   const b = tile(page, 'b')
  87 |   await expect(b.locator('.mark[data-mark="stale"]')).toHaveCSS('background-color', RED)
  88 |   await expect(b.locator('.mark[data-mark="paused"]')).toHaveCount(0)
  89 |   await b.click()
  90 |   const marks = page.getByRole('region', { name: 'marks' })
  91 |   const itemA = marks.locator('li[data-cause="a"]')
  92 |   await expect(itemA).toContainText('#a Card A was reopened, rejected')
  93 | })
  94 | 
```