import { expect, test, realCard, type Werk } from './harness.ts'

function base(werk: Werk) {
  realCard(werk, 'al-diff', 'Diff the alignment')
  realCard(werk, 'align', 'Align the cards')
}

test('71.1 known card ids in a body become links, other text stays plain', async ({ page, werk }) => {
  base(werk)
  const body = 'Read #al-diff and #ghost-card. Then al-diff, then align.\n\nRun `node src/cli.ts show #al-diff` to see it.'
  realCard(werk, 'notes-card', 'Notes card', undefined, ['--body', body])
  await page.goto(werk.url)
  await page.locator('li[data-card-id="notes-card"] > a').click()
  const b = page.getByTestId('card').locator('.body')
  await expect(b).toContainText('#ghost-card')
  await expect(b.locator('a', { hasText: '#al-diff' })).toHaveAttribute('href', '#al-diff')
  await expect(b.locator('a').filter({ hasText: /^al-diff$/ })).toHaveCount(1)
  await expect(b.locator('a', { hasText: 'ghost-card' })).toHaveCount(0)
  await expect(b.locator('a').filter({ hasText: /^align$/ })).toHaveCount(0)
  await expect(b).toContainText('align')
  const code = b.locator('code', { hasText: 'node src/cli.ts show #al-diff' })
  await expect(code).toHaveCount(1)
  await expect(code.locator('a')).toHaveCount(0)
  await expect(b.locator('a')).toHaveCount(2)
})

test('71.2 a click on a card link in a why line opens that card', async ({ page, werk }) => {
  base(werk)
  realCard(werk, 'pr-iface', 'PR interface', undefined, ['--why', 'It builds on #al-diff.'])
  await page.goto(werk.url)
  await page.locator('li[data-card-id="pr-iface"] > a').click()
  await page.getByTestId('card').locator('.why a', { hasText: '#al-diff' }).click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'al-diff')
  await expect(page.getByTestId('card')).toContainText('Diff the alignment')
})

test('71.3 headings, URL fragments and fenced blocks keep their own form', async ({ page, werk }) => {
  base(werk)
  const body = ['# al-diff', '', 'See https://example.com/page#al-diff for more.', '', 'The span `#al-diff` names it.', '', '```', '#al-diff', '```'].join('\n')
  realCard(werk, 'doc-card', 'Doc card', undefined, ['--body', body])
  await page.goto(werk.url)
  await page.locator('li[data-card-id="doc-card"] > a').click()
  const b = page.getByTestId('card').locator('.body')
  const heading = b.getByRole('heading', { name: 'al-diff' })
  await expect(heading).toHaveText('al-diff')
  await expect(heading.locator('a')).toHaveCount(0)
  await expect(b).toContainText('https://example.com/page#al-diff')
  await expect(b.locator('a[href="#al-diff"]', { hasText: /^#al-diff$/ }).filter({ has: page.locator('xpath=ancestor::pre') })).toHaveCount(0)
  const pre = b.locator('pre')
  await expect(pre).toContainText('#al-diff')
  await expect(pre.locator('a')).toHaveCount(0)
  // the URL fragment is not a card link: the only card links are the code span
  const cardLinks = b.locator('a[href="#al-diff"]')
  await expect(cardLinks).toHaveCount(1)
  await expect(cardLinks).toHaveText('#al-diff')
  expect(await cardLinks.evaluate((a) => a.closest('p')?.textContent)).toContain('The span')
})

test('71.4 a tile title with a card id holds no link, but a note does', async ({ page, werk }) => {
  base(werk)
  realCard(werk, 'ref-card', 'Follows up on #al-diff')
  werk.cli(['say', 'ref-card', '--text', 'See al-diff first'])
  await page.goto(werk.url)
  const tile = page.locator('li[data-card-id="ref-card"] > a')
  await expect(tile).toContainText('Follows up on #al-diff')
  await expect(tile.locator('a')).toHaveCount(0)
  await tile.click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'ref-card')
  const notes = page.getByRole('region', { name: 'notes' })
  await expect(notes.locator('a', { hasText: 'al-diff' })).toHaveAttribute('href', '#al-diff')
})

const LONG = `        "long": "${'y'.repeat(400)}"`
test('71.5 fenced code shows boxed, highlighted, with its own indentation', async ({ page, werk }) => {
  const body = ['Some text before.', '', '```json', '{', '    "outer": {', '        "inner": 1,', LONG, '    }', '}', '```', '', 'Some text after.'].join('\n')
  realCard(werk, 'code-card', 'Code card', undefined, ['--body', body])
  await page.goto(werk.url)
  await page.locator('li[data-card-id="code-card"] > a').click()
  const pre = page.getByTestId('card').locator('pre')
  await expect(pre).toHaveCSS('border-top-style', 'solid')
  await expect(pre).toHaveCSS('overflow-x', 'auto')
  expect(await pre.locator('[class^="tok-"]').count()).toBeGreaterThan(0)
  const text = await pre.evaluate((el) => el.textContent)
  expect(text).toContain('\n    "outer": {\n        "inner": 1,\n' + LONG + '\n    }\n')
  expect(await pre.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
  await pre.evaluate((el) => { el.scrollLeft = el.scrollWidth })
  expect(await pre.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0)
  const card = page.getByTestId('card')
  const cardW = await card.evaluate((el) => el.getBoundingClientRect().width)
  for (const p of await card.locator('.body p').all()) {
    expect(await p.evaluate((el) => el.getBoundingClientRect().width)).toBeLessThanOrEqual(cardW)
  }
  expect(await card.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})
