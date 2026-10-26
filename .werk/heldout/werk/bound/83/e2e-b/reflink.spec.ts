/** Held-out steps 71.1-71.5: card links and fenced code in the card view. */
import { expect, test } from '../../e2e/harness.ts'

const cardView = (page: import('@playwright/test').Page) => page.getByTestId('card')

test('71.1 known card ids in a card body become links, other text stays plain', async ({ page, werk }) => {
  werk.cli(['add', 'al-diff', '--title', 'Diff the alignment'])
  werk.cli(['add', 'align', '--title', 'Align two maps'])
  const body = 'See #al-diff and #ghost-card, then al-diff and align. Run `node src/cli.ts show #al-diff` here.'
  werk.cli(['add', 'notes-card', '--title', 'Notes', '--body', body])
  // The user opens the card in the map: a click on its tile.
  await page.locator('li[data-card-id="notes-card"] > a').click()
  const b = cardView(page).locator('.body')
  await expect(b).toContainText('#ghost-card')
  await expect(b.locator('a', { hasText: /^#al-diff$/ })).toHaveCount(1)
  await expect(b.locator('a', { hasText: /^al-diff$/ })).toHaveCount(1)
  await expect(b.locator('a', { hasText: 'ghost-card' })).toHaveCount(0)
  await expect(b.locator('a', { hasText: /^align$/ })).toHaveCount(0)
  await expect(b).toContainText('align')
  const code = b.locator('code', { hasText: 'node src/cli.ts show #al-diff' })
  await expect(code).toHaveCount(1)
  await expect(code.locator('a')).toHaveCount(0)
  await expect(b.locator('a')).toHaveCount(2)
})

test('71.2 a click on a card link in a why line opens that card', async ({ page, werk }) => {
  werk.cli(['add', 'al-diff', '--title', 'Diff the alignment'])
  werk.cli(['add', 'pr-iface', '--title', 'The PR interface', '--why', 'It builds on #al-diff.'])
  await page.locator('li[data-card-id="pr-iface"] > a').click()
  await cardView(page).locator('.why a', { hasText: '#al-diff' }).click()
  await expect(cardView(page)).toHaveAttribute('data-card-id', 'al-diff')
  await expect(page.getByText('Diff the alignment').first()).toBeVisible()
})

test('71.3 headings, URL fragments and fenced blocks keep their own form', async ({ page, werk }) => {
  werk.cli(['add', 'al-diff', '--title', 'Diff the alignment'])
  const body = ['# al-diff', '', 'Docs: https://example.com/page#al-diff', '', 'The span `#al-diff` is a ref.', '', '```', '#al-diff', '```'].join('\n')
  werk.cli(['add', 'doc-card', '--title', 'Doc card', '--body', body])
  await page.locator('li[data-card-id="doc-card"] > a').click()
  const b = cardView(page).locator('.body')
  const heading = b.getByRole('heading', { name: 'al-diff' })
  await expect(heading).toHaveText('al-diff')
  await expect(heading.locator('a')).toHaveCount(0)
  // The URL fragment is not a card link: no link points at the card from inside the URL text.
  const urlPara = b.locator('p', { hasText: 'example.com' })
  await expect(urlPara.locator('a[href="#al-diff"]')).toHaveCount(0)
  await expect(b.locator('pre')).toContainText('#al-diff')
  await expect(b.locator('pre a')).toHaveCount(0)
  const spanLink = b.locator('p', { hasText: 'The span' }).locator('a[href="#al-diff"]')
  await expect(spanLink).toHaveCount(1)
  await expect(spanLink).toContainText('#al-diff')
})

test('71.4 a grid tile summary with a card id holds no link, but a note on the open card does', async ({ page, werk }) => {
  werk.cli(['add', 'al-diff', '--title', 'Diff the alignment'])
  werk.cli(['add', 'ref-card', '--title', 'Follows up on #al-diff'])
  werk.cli(['say', 'ref-card', '--text', 'See al-diff first'])
  const tile = page.locator('li[data-card-id="ref-card"] > a')
  await expect(tile).toContainText('Follows up on #al-diff')
  await expect(tile.locator('a')).toHaveCount(0)
  await tile.click()
  await expect(cardView(page)).toHaveAttribute('data-card-id', 'ref-card')
  const notes = page.getByRole('region', { name: 'notes' })
  await expect(notes.locator('a', { hasText: /^al-diff$/ })).toHaveCount(1)
})

const LONG = `        "deep": "${'x'.repeat(400)}"`
const CODE = ['Intro text for the card.', '', '```json', '{', '    "a": {', LONG, '    }', '}', '```', '', 'Text after the code.'].join('\n')

test('71.5 fenced code shows boxed, highlighted, with its own indentation', async ({ page, werk }) => {
  werk.cli(['add', 'code-card', '--title', 'A card with code', '--body', CODE])
  await page.locator('li[data-card-id="code-card"] > a').click()
  const card = cardView(page)
  const pre = card.locator('pre')
  await expect(pre).toHaveCount(1)
  await expect(pre).toHaveCSS('border-top-style', 'solid')
  await expect(pre.locator('[class^="tok-"]').first()).toBeVisible()
  expect(await pre.evaluate((el) => el.textContent)).toBe(['{', '    "a": {', LONG, '    }', '}'].join('\n'))
  await expect(pre).toHaveCSS('white-space', 'pre')
  expect(await pre.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
  await pre.evaluate((el) => (el.scrollLeft = el.scrollWidth))
  expect(await pre.evaluate((el) => el.scrollLeft > 0)).toBe(true)
  const body = card.locator('.body')
  const fits = await body.evaluate((el) => {
    const cardEl = el.closest('article')!
    return el.getBoundingClientRect().width <= cardEl.getBoundingClientRect().width && el.scrollWidth <= el.clientWidth + 1
  })
  expect(fits).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})
