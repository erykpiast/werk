/** Held-out steps 71.1–71.5: card links and code in the card view. */
import { expect, test, type Werk } from './harness.ts'

const cards = (werk: Werk) => {
  werk.cli(['add', 'al-diff', '--title', 'Diff the alignment', '--parent', 'map'])
  werk.cli(['add', 'align', '--title', 'Align', '--parent', 'map'])
}

test('71.1 known card ids in a body become links, and other text stays plain', async ({ page, werk }) => {
  cards(werk)
  const body = 'See #al-diff and #ghost-card. The bare al-diff and the bare word align.\n\nRun `node src/cli.ts show #al-diff` here.'
  werk.cli(['add', 'notes-card', '--title', 'Notes', '--parent', 'map', '--body', body])
  await page.goto(werk.url)
  await page.locator('li[data-card-id="notes-card"] > a').click()
  const b = page.getByTestId('card').locator('.body')
  await expect(b).toContainText('See #al-diff and #ghost-card')
  await expect(b.locator('a', { hasText: /^#al-diff$/ })).toHaveAttribute('href', '#al-diff')
  await expect(b.locator('a', { hasText: /^al-diff$/ })).toHaveAttribute('href', '#al-diff')
  await expect(b.locator('a', { hasText: 'ghost-card' })).toHaveCount(0)
  await expect(b.locator('a', { hasText: /^align$/ })).toHaveCount(0)
  await expect(b.locator('a')).toHaveText(['#al-diff', 'al-diff'])
  const code = b.locator('code', { hasText: 'node src/cli.ts show #al-diff' })
  await expect(code).toHaveCount(1)
  await expect(code.locator('a')).toHaveCount(0)
})

test('71.2 a click on a card link in a why line opens that card', async ({ page, werk }) => {
  cards(werk)
  werk.cli(['add', 'pr-iface', '--title', 'The PR interface', '--parent', 'map', '--why', 'It builds on #al-diff.'])
  await page.goto(werk.url)
  await page.locator('li[data-card-id="pr-iface"] > a').click()
  await page.getByTestId('card').locator('.why').getByRole('link', { name: '#al-diff' }).click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'al-diff')
  await expect(page.getByTestId('card')).toContainText('Diff the alignment')
})

test('71.3 headings, URL fragments and fenced blocks keep their form, a code span links', async ({ page, werk }) => {
  cards(werk)
  const body = ['# al-diff', '', 'See https://example.com/page#al-diff for it.', '', 'The span `#al-diff` names it.', '', '```', '#al-diff', '```'].join('\n')
  werk.cli(['add', 'doc-card', '--title', 'Doc', '--parent', 'map', '--body', body])
  await page.goto(werk.url)
  await page.locator('li[data-card-id="doc-card"] > a').click()
  const b = page.getByTestId('card').locator('.body')
  const heading = b.getByRole('heading', { name: 'al-diff' })
  await expect(heading).toHaveText('al-diff')
  await expect(heading.locator('a')).toHaveCount(0)
  await expect(b).toContainText('example.com/page#al-diff')
  const cardLinks = b.locator('a[href="#al-diff"]')
  await expect(cardLinks).toHaveCount(1)
  await expect(cardLinks).toHaveText('#al-diff')
  // The one card link is the code span, not the URL paragraph.
  await expect(b.locator('p', { hasText: 'example.com' }).locator('a[href="#al-diff"]')).toHaveCount(0)
  await expect(b.locator('p', { hasText: 'names it' }).locator('a[href="#al-diff"]')).toHaveCount(1)
  await expect(b.locator('pre')).toContainText('#al-diff')
  await expect(b.locator('pre a')).toHaveCount(0)
})

test('71.4 a grid tile with a card id holds no link, a note on the open card does', async ({ page, werk }) => {
  cards(werk)
  werk.cli(['add', 'ref-card', '--title', 'Follows up on #al-diff', '--parent', 'map'])
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

test('71.5 fenced code shows boxed, highlighted, with its indentation, and scrolls sideways', async ({ page, werk }) => {
  const long = `        "deep": "${'y'.repeat(400)}"`
  const lines = ['{', '    "outer": {', '        "inner": {', long, '        }', '    }', '}']
  werk.cli(['add', 'code-card', '--title', 'Code', '--parent', 'map', '--body', ['Some text before.', '', '```json', ...lines, '```', '', 'Some text after.'].join('\n')])
  await page.goto(werk.url)
  await page.locator('li[data-card-id="code-card"] > a').click()
  const card = page.getByTestId('card')
  const pre = card.locator('pre')
  await expect(pre).toHaveCount(1)
  await expect(pre).toHaveCSS('border-top-style', 'solid')
  expect(await pre.locator('span[class^="tok-"]').count()).toBeGreaterThan(0)
  expect(await pre.evaluate((el) => el.textContent)).toBe(lines.join('\n'))
  expect(await pre.evaluate((el) => getComputedStyle(el).overflowX)).toMatch(/auto|scroll/)
  expect(await pre.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
  await pre.evaluate((el) => (el.scrollLeft = el.scrollWidth))
  expect(await pre.evaluate((el) => el.scrollLeft > 0)).toBe(true)
  const fits = await card.evaluate((c) => {
    const body = c.querySelector('.body')!
    return body.scrollWidth <= c.clientWidth && c.scrollWidth <= c.clientWidth && document.documentElement.scrollWidth <= window.innerWidth
  })
  expect(fits).toBe(true)
})
