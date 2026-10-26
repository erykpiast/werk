import { expect, test, type Werk } from '../e2e/harness.ts'

function base(werk: Werk) {
  werk.cli(['add', 'al-diff', '--title', 'Diff the alignment', '--parent', 'map'])
  werk.cli(['add', 'align', '--title', 'Align two texts', '--parent', 'map'])
}

test('71.1 known card ids in a body become links, other text stays plain', async ({ page, werk }) => {
  base(werk)
  const body = 'See #al-diff and #ghost-card. Then al-diff, and align.\n\nRun `node src/cli.ts show #al-diff` here.'
  werk.cli(['add', 'notes-card', '--title', 'Notes', '--parent', 'map', '--body', body])
  await page.goto(`${werk.url}#notes-card`)
  const b = page.getByTestId('card').locator('.body')
  await expect(b).toContainText('#ghost-card')
  await expect(b.locator('a', { hasText: /^#al-diff$/ })).toHaveCount(1)
  await expect(b.locator('a', { hasText: /^al-diff$/ })).toHaveCount(1)
  await expect(b.locator('a', { hasText: 'ghost-card' })).toHaveCount(0)
  await expect(b.locator('a', { hasText: /^align$/ })).toHaveCount(0)
  const code = b.locator('code', { hasText: 'node src/cli.ts show #al-diff' })
  await expect(code).toHaveCount(1)
  await expect(code.locator('a')).toHaveCount(0)
  await expect(b.locator('a:has(code)')).toHaveCount(0)
})

test('71.2 a click on a card link in a why line opens that card', async ({ page, werk }) => {
  base(werk)
  werk.cli(['add', 'pr-iface', '--title', 'PR interface', '--parent', 'map', '--why', 'It builds on #al-diff.'])
  await page.goto(`${werk.url}#pr-iface`)
  await page.getByTestId('card').locator('.why a', { hasText: '#al-diff' }).click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'al-diff')
  await expect(page.getByTestId('card')).toContainText('Diff the alignment')
})

test('71.3 headings, URL fragments and fenced blocks keep their own form', async ({ page, werk }) => {
  base(werk)
  const body = ['# al-diff', '', 'Docs: https://example.com/page#al-diff', '', 'The span `#al-diff` names it.', '', '```', '#al-diff', '```'].join('\n')
  werk.cli(['add', 'doc-card', '--title', 'Doc', '--parent', 'map', '--body', body])
  await page.goto(`${werk.url}#doc-card`)
  const b = page.getByTestId('card').locator('.body')
  const h = b.getByRole('heading', { name: 'al-diff' })
  await expect(h).toHaveText('al-diff')
  await expect(h.locator('a')).toHaveCount(0)
  // No card link points from the URL fragment: the only link with the fragment text must not be a card link.
  await expect(b.locator('a.ref', { hasText: 'example.com' })).toHaveCount(0)
  await expect(b.locator('p', { hasText: 'example.com' }).locator('a[href="#al-diff"]')).toHaveCount(0)
  await expect(b.locator('pre')).toContainText('#al-diff')
  await expect(b.locator('pre a')).toHaveCount(0)
  const span = b.locator('a:has(code)')
  await expect(span).toHaveCount(1)
  await expect(span).toHaveText('#al-diff')
  await expect(span).toHaveAttribute('href', '#al-diff')
})

test('71.4 a grid tile summary holds no link, a note on the open card does', async ({ page, werk }) => {
  base(werk)
  werk.cli(['add', 'ref-card', '--title', 'Follows up on #al-diff', '--parent', 'map'])
  werk.cli(['say', 'ref-card', '--text', 'See al-diff first'])
  await page.goto(werk.url)
  const tile = page.locator('li[data-card-id="ref-card"] > a')
  await expect(tile).toContainText('Follows up on #al-diff')
  await expect(tile.locator('a')).toHaveCount(0)
  await tile.click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'ref-card')
  const notes = page.getByRole('region', { name: 'notes' })
  await expect(notes.locator('a', { hasText: /^al-diff$/ })).toHaveCount(1)
})

test('71.5 fenced code shows boxed, highlighted, with its own indentation', async ({ page, werk }) => {
  const long = `        "deep": "${'y'.repeat(400)}"`
  const lines = ['{', '    "outer": {', '        "inner": {', long, '        }', '    }', '}']
  const body = ['Some text before the code.', '', '```json', ...lines, '```', '', 'Some text after.'].join('\n')
  werk.cli(['add', 'code-card', '--title', 'Code', '--parent', 'map', '--body', body])
  await page.goto(`${werk.url}#code-card`)
  const cardEl = page.getByTestId('card')
  const pre = cardEl.locator('pre')
  await expect(pre).toBeVisible()
  await expect(pre).toHaveCSS('border-top-style', 'solid')
  expect(await pre.locator('span[class^="tok-"]').count()).toBeGreaterThan(0)
  expect(await pre.evaluate((el) => el.textContent)).toBe(lines.join('\n'))
  await expect(pre).toHaveCSS('overflow-x', /auto|scroll/)
  expect(await pre.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
  await pre.evaluate((el) => (el.scrollLeft = el.scrollWidth))
  expect(await pre.evaluate((el) => el.scrollLeft > 0)).toBe(true)
  const cardBox = (await cardEl.boundingBox())!
  const bodyBox = (await cardEl.locator('.body').boundingBox())!
  expect(bodyBox.width).toBeLessThanOrEqual(cardBox.width)
  expect(await cardEl.locator('.body').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})
