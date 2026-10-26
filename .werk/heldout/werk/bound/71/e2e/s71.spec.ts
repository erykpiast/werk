import { expect, test } from '../../e2e/harness.ts'
import { real } from './util.ts'

test('71.1 known card ids in a card body become links, and other text stays plain', async ({ page, werk }) => {
  real(werk, 'al-diff', 'Diff the alignment')
  real(werk, 'align', 'Align things')
  const body = 'Mentions #al-diff and #ghost-card, then al-diff and align. Run `node src/cli.ts show #al-diff` here.'
  real(werk, 'notes-card', 'Notes card', ['--body', body])
  await page.goto(`${werk.url}#notes-card`)
  const b = page.getByTestId('card').locator('.body')
  await expect(b).toContainText('Mentions')
  await expect(b.locator('a')).toHaveText(['#al-diff', 'al-diff'])
  for (const a of await b.locator('a').all()) await expect(a).toHaveAttribute('href', '#al-diff')
  await expect(b).toContainText('#ghost-card')
  await expect(b).toContainText('align.')
  await expect(b.locator('a', { hasText: 'ghost-card' })).toHaveCount(0)
  await expect(b.locator('a', { hasText: /^align$/ })).toHaveCount(0)
  const code = b.locator('code', { hasText: 'node src/cli.ts show #al-diff' })
  await expect(code).toHaveCount(1)
  await expect(code.locator('a')).toHaveCount(0)
  await expect(b.locator('a code')).toHaveCount(0)
})

test('71.2 a click on a card link in a why line opens that card', async ({ page, werk }) => {
  real(werk, 'al-diff', 'Diff the alignment')
  real(werk, 'pr-iface', 'PR interface', ['--why', 'It builds on #al-diff.'])
  await page.goto(`${werk.url}#pr-iface`)
  await page.getByTestId('card').locator('.why').getByRole('link', { name: '#al-diff' }).click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'al-diff')
  await expect(page.getByTestId('card')).toContainText('Diff the alignment')
})

test('71.3 headings, URL fragments and fenced blocks keep their own form', async ({ page, werk }) => {
  real(werk, 'al-diff', 'Diff the alignment')
  const body = ['# al-diff', '', 'See https://example.com/page#al-diff for more.', '', 'The span `#al-diff` names it.', '', '```', '#al-diff', '```'].join('\n')
  real(werk, 'doc-card', 'Doc card', ['--body', body])
  await page.goto(`${werk.url}#doc-card`)
  const b = page.getByTestId('card').locator('.body')
  const h = b.getByRole('heading', { name: 'al-diff' })
  await expect(h).toHaveText('al-diff')
  await expect(h.locator('a')).toHaveCount(0)
  await expect(b).toContainText('https://example.com/page#al-diff')
  const para = b.locator('p', { hasText: 'example.com' })
  await expect(para.locator('a[href="#al-diff"]')).toHaveCount(0)
  await expect(b.locator('pre')).toContainText('#al-diff')
  await expect(b.locator('pre a')).toHaveCount(0)
  const span = b.locator('a', { has: page.locator('code', { hasText: '#al-diff' }) })
  await expect(span).toHaveCount(1)
  await expect(span).toHaveAttribute('href', '#al-diff')
})

test('71.4 a grid tile summary with a card id holds no link, but a note on the open card does', async ({ page, werk }) => {
  real(werk, 'al-diff', 'Diff the alignment')
  real(werk, 'ref-card', 'Follows up on #al-diff')
  werk.cli(['say', 'ref-card', '--text', 'See al-diff first'])
  await page.goto(werk.url)
  const tile = page.locator('li[data-card-id="ref-card"] > a')
  await expect(tile).toContainText('Follows up on #al-diff')
  await expect(tile.locator('a')).toHaveCount(0)
  await tile.click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'ref-card')
  const notes = page.getByRole('region', { name: 'notes' })
  await expect(notes.getByRole('link', { name: 'al-diff' })).toHaveAttribute('href', '#al-diff')
})

test('71.5 fenced code in a card shows boxed, highlighted, and with its own indentation', async ({ page, werk }) => {
  const long = `        "end": "${'y'.repeat(300)}END"`
  const src = ['{', '    "outer": {', '        "inner": 1,', long, '    }', '}']
  real(werk, 'code-card', 'Code card', ['--body', ['Some text.', '', '```json', ...src, '```', '', 'More text.'].join('\n')])
  await page.goto(`${werk.url}#code-card`)
  const pre = page.getByTestId('card').locator('pre')
  await expect(pre).toBeVisible()
  await expect(pre).toHaveCSS('border-top-style', 'solid')
  expect(await pre.locator('[class^="tok-"]').count()).toBeGreaterThan(0)
  const colors = await pre.locator('[class^="tok-"]').evaluateAll((els) => [...new Set(els.map((e) => getComputedStyle(e).color))])
  expect(colors.length).toBeGreaterThan(1)
  expect(await pre.evaluate((el) => el.textContent)).toBe(src.join('\n'))
  expect(await pre.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
  const scrolled = await pre.evaluate((el) => {
    el.scrollLeft = el.scrollWidth
    return el.scrollLeft > 0
  })
  expect(scrolled).toBe(true)
  const fits = await page.getByTestId('card').locator('.body').evaluate((el) => el.scrollWidth <= el.clientWidth)
  expect(fits).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})
