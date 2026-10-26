/** Feature 71: card links in Markdown, and boxed code. "Summary" reads as the card title. */
import { accepted, proposed, said } from '../../src/test/map-events.ts'
import { expect, open, test } from './harness.ts'

const base = () => [
  proposed('al-diff', { title: 'Diff the alignment', body: 'The diff of two alignments.' }),
  accepted('al-diff'),
  proposed('align', { title: 'Align two maps' }),
  accepted('align'),
]

test('71.1 known card ids in a card body become links, and other text stays plain', async ({ page, proj }) => {
  const body = 'See #al-diff and #ghost-card. Then al-diff, then align. Run `node src/cli.ts show #al-diff` to print it.'
  proj.seed(...base(), proposed('notes-card', { title: 'Notes', body }), accepted('notes-card'))
  await open(page, proj, '#notes-card')
  const b = page.getByTestId('card').locator('.body')
  await expect(b).toContainText('See #al-diff and #ghost-card')
  await expect(b.locator('a', { hasText: '#al-diff' })).toHaveAttribute('href', '#al-diff')
  await expect(b.locator('a')).toHaveText(['#al-diff', 'al-diff'])
  for (const a of await b.locator('a').all()) await expect(a).toHaveAttribute('href', '#al-diff')
  await expect(b.locator('a', { hasText: 'ghost-card' })).toHaveCount(0)
  await expect(b.locator('a', { hasText: /^align$/ })).toHaveCount(0)
  const code = b.locator('code', { hasText: 'node src/cli.ts show #al-diff' })
  await expect(code).toHaveCount(1)
  await expect(code.locator('a')).toHaveCount(0)
})

test('71.2 a click on a card link in a why line opens that card', async ({ page, proj }) => {
  proj.seed(...base(), proposed('pr-iface', { title: 'The PR interface', why: 'It builds on #al-diff.' }), accepted('pr-iface'))
  await open(page, proj, '#pr-iface')
  await page.getByTestId('card').locator('.why a', { hasText: '#al-diff' }).click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'al-diff')
  await expect(page.getByTestId('card')).toContainText('Diff the alignment')
})

test('71.3 headings, URL fragments and fenced blocks keep their own form', async ({ page, proj }) => {
  const body = ['# al-diff', '', 'Docs: https://example.com/page#al-diff', '', 'The span `#al-diff` names it.', '', '```', '#al-diff', '```'].join('\n')
  proj.seed(...base(), proposed('doc-card', { title: 'Doc', body }), accepted('doc-card'))
  await open(page, proj, '#doc-card')
  const b = page.getByTestId('card').locator('.body')
  const heading = b.getByRole('heading', { name: 'al-diff' })
  await expect(heading).toHaveText('al-diff')
  await expect(heading.locator('a')).toHaveCount(0)
  await expect(b).toContainText('https://example.com/page#al-diff')
  const cardLinks = b.locator('a[href="#al-diff"]')
  await expect(cardLinks).toHaveCount(1)
  await expect(b.locator('pre')).toContainText('#al-diff')
  await expect(b.locator('pre a')).toHaveCount(0)
  await expect(cardLinks.first()).toHaveText('#al-diff')
  expect(await cardLinks.first().evaluate((a) => a.closest('pre') === null && (a.querySelector('code') !== null || a.closest('code') !== null || a.tagName === 'A'))).toBe(true)
})

test('71.4 a grid tile summary with a card id holds no link, but a note on the open card does', async ({ page, proj }) => {
  proj.seed(...base(), proposed('ref-card', { title: 'Follows up on #al-diff' }), accepted('ref-card'), said('ref-card', 'See al-diff first'))
  await open(page, proj)
  const tile = page.locator('li[data-card-id="ref-card"] > a')
  await expect(tile).toContainText('Follows up on #al-diff')
  await expect(tile.locator('a')).toHaveCount(0)
  await tile.click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'ref-card')
  const notes = page.getByRole('region', { name: 'notes' })
  await expect(notes.locator('a', { hasText: 'al-diff' })).toHaveAttribute('href', '#al-diff')
})

test('71.5 fenced code in a card shows boxed, highlighted, and with its own indentation', async ({ page, proj }) => {
  const long = `        "deep": "${'x'.repeat(400)}END"`
  const lines = ['{', '    "a": {', '        "b": 1,', long, '    }', '}']
  const body = ['Some text before the code.', '', '```json', ...lines, '```', '', 'Some text after the code.'].join('\n')
  proj.seed(proposed('code-card', { title: 'Code', body }), accepted('code-card'))
  await open(page, proj, '#code-card')
  const card = page.getByTestId('card')
  const pre = card.locator('.body pre')
  await expect(pre).toHaveCSS('border-top-style', 'solid')
  expect(await pre.locator('[class^="tok-"]').count()).toBeGreaterThan(0)
  expect(await pre.evaluate((el) => el.textContent)).toBe(lines.join('\n'))
  expect(await pre.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
  await pre.hover()
  await page.mouse.wheel(2000, 0)
  await expect.poll(() => pre.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0)
  const bodyBox = (await card.locator('.body').boundingBox())!
  const cardBox = (await card.boundingBox())!
  expect(bodyBox.x + bodyBox.width).toBeLessThanOrEqual(cardBox.x + cardBox.width + 0.5)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})
