# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: s72.spec.ts >> 72.4 >> 72.4 the card view of a paused card two hops away
- Location: e2e-a/s72.spec.ts:66:3

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: getByRole('region', { name: 'marks' }).getByRole('heading', { level: 2 })
Expected substring: "Why this card is stale"
Received string:    "Why this card is paused paused"
Timeout: 5000ms

Call log:
  - Expect "toContainText" getByRole('region', { name: 'marks' }).getByRole('heading', { level: 2 }) with timeout 5000ms
  - waiting for getByRole('region', { name: 'marks' }).getByRole('heading', { level: 2 })
    14 × locator resolved to <h2>…</h2>
       - unexpected value "Why this card is paused paused"

```

```yaml
- heading "Why this card is paused paused" [level=2]
```

# Test source

```ts
  1   | import { decidedCard, expect, lnk, seedLog, test } from './harness.ts'
  2   | 
  3   | const card = (id: string) => `li[data-card-id="${id}"]`
  4   | const RED = 'rgb(179, 38, 30)'
  5   | const GREY = 'rgb(117, 117, 117)'
  6   | const GREEN = 'rgb(46, 125, 50)'
  7   | const abc = seedLog([
  8   |   ...decidedCard('a', 'Card A'),
  9   |   ...decidedCard('b', 'Card B'),
  10  |   lnk('b', 'a', 'depends_on'),
  11  |   ...decidedCard('c', 'Card C'),
  12  |   lnk('c', 'b', 'depends_on'),
  13  | ])
  14  | 
  15  | test.describe('72.1', () => {
  16  |   test.use({ seed: abc })
  17  |   test('72.1 a rejected reopen marks only the direct dependent red', async ({ page, werk }) => {
  18  |     werk.cli(['reopen', 'a', '--reason', 'rejected', '--why', 'The storage choice is wrong'])
  19  |     await page.goto(werk.url)
  20  |     const b = page.locator(`${card('b')} > a`)
  21  |     await expect(b.locator('.mark')).toHaveText('stale')
  22  |     await expect(b.locator('.mark')).toHaveCSS('background-color', RED)
  23  |     await expect(b).toHaveAttribute('data-status', 'decided')
  24  |     await expect(b).toHaveCSS('border-left-color', GREEN)
  25  |     const c = page.locator(`${card('c')} > a`)
  26  |     await expect(c).toBeVisible()
  27  |     await expect(c.locator('.mark')).toHaveCount(0)
  28  |   })
  29  | })
  30  | 
  31  | test.describe('72.2', () => {
  32  |   test.use({ seed: abc })
  33  |   test('72.2 a postponed reopen pauses every downstream card in grey', async ({ page, werk }) => {
  34  |     werk.cli(['reopen', 'a', '--reason', 'postponed', '--why', 'Waits for next quarter'])
  35  |     await page.goto(werk.url)
  36  |     for (const id of ['b', 'c']) {
  37  |       const mark = page.locator(`${card(id)} > a .mark`)
  38  |       await expect(mark).toHaveText('paused')
  39  |       await expect(mark).toHaveCSS('background-color', GREY)
  40  |       await expect(page.locator(`${card(id)} > a .mark[data-mark="stale"]`)).toHaveCount(0)
  41  |     }
  42  |     const c = page.locator(`${card('c')} > a`)
  43  |     await expect(c).toHaveAttribute('data-status', 'decided')
  44  |     await expect(c).toHaveCSS('border-left-color', GREEN)
  45  |   })
  46  | })
  47  | 
  48  | test.describe('72.3', () => {
  49  |   test.use({ seed: seedLog([...decidedCard('a', 'Card A'), ...decidedCard('b', 'Card B'), lnk('b', 'a', 'depends_on')]) })
  50  |   test('72.3 the card view of a stale card explains the change', async ({ page, werk }) => {
  51  |     werk.cli(['reopen', 'a', '--reason', 'rejected', '--why', 'The vendor dropped this API'])
  52  |     await page.goto(werk.url)
  53  |     await page.locator(`${card('b')} > a`).click()
  54  |     const marks = page.getByRole('region', { name: 'marks' })
  55  |     await expect(marks.getByRole('heading', { level: 2 })).toContainText('Why this card is stale')
  56  |     await expect(marks).toContainText('#a Card A')
  57  |     await expect(marks).toContainText('was reopened')
  58  |     await expect(marks).toContainText('along depends_on')
  59  |     await expect(marks).toContainText('rejected')
  60  |     await expect(marks).toContainText('The vendor dropped this API')
  61  |   })
  62  | })
  63  | 
  64  | test.describe('72.4', () => {
  65  |   test.use({ seed: abc })
  66  |   test('72.4 the card view of a paused card two hops away', async ({ page, werk }) => {
  67  |     werk.cli(['reopen', 'a', '--reason', 'postponed', '--why', 'We build the engine next quarter'])
  68  |     await page.goto(werk.url)
  69  |     await page.locator(`${card('c')} > a`).click()
  70  |     const marks = page.getByRole('region', { name: 'marks' })
  71  |     // Checked separately so the later checks still report.
  72  |     const heading = await marks.getByRole('heading', { level: 2 }).textContent()
  73  |     console.log(`72.4 heading: ${heading}`)
  74  |     await expect(marks).toContainText('#a Card A')
  75  |     await expect(marks).toContainText('was reopened')
  76  |     await expect(marks).toContainText('postponed')
  77  |     await expect(marks).toContainText('We build the engine next quarter')
> 78  |     await expect(marks.getByRole('heading', { level: 2 })).toContainText('Why this card is stale')
      |                                                            ^ Error: expect(locator).toContainText(expected) failed
  79  |   })
  80  | })
  81  | 
  82  | test.describe('72.5', () => {
  83  |   test.use({
  84  |     seed: seedLog([
  85  |       ...decidedCard('a', 'Card A'),
  86  |       ...decidedCard('x', 'Card X'),
  87  |       ...decidedCard('b', 'Card B'),
  88  |       lnk('b', 'a', 'depends_on'),
  89  |       lnk('b', 'x', 'depends_on'),
  90  |     ]),
  91  |   })
  92  |   test('72.5 stale wins over paused', async ({ page, werk }) => {
  93  |     werk.cli(['reopen', 'x', '--reason', 'postponed', '--why', 'X waits'])
  94  |     werk.cli(['reopen', 'a', '--reason', 'rejected', '--why', 'A is wrong'])
  95  |     await page.goto(werk.url)
  96  |     const b = page.locator(`${card('b')} > a`)
  97  |     await expect(b.locator('.mark')).toHaveCount(1)
  98  |     await expect(b.locator('.mark')).toHaveText('stale')
  99  |     await expect(b.locator('.mark')).toHaveCSS('background-color', RED)
  100 |     await expect(b.locator('.mark[data-mark="paused"]')).toHaveCount(0)
  101 |     await b.click()
  102 |     const marks = page.getByRole('region', { name: 'marks' })
  103 |     const trace = marks.locator('li[data-cause="a"]')
  104 |     await expect(trace).toHaveAttribute('data-reason', 'rejected')
  105 |     await expect(trace).toContainText('#a Card A')
  106 |     await expect(trace).toContainText('rejected')
  107 |   })
  108 | })
  109 | 
```