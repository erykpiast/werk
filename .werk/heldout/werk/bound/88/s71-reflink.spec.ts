/** Held-out group 71: card links and fenced code in the map's card view. */
import { expect, test, type Werk } from '../e2e/harness.ts'

/** A real card: proposed, then accepted by the person. */
function realCard(werk: Werk, id: string, args: string[]) {
  werk.cli(['add', id, ...args])
  werk.cli(['accept', id, '--actor', 'you'])
}

const alDiff = (werk: Werk) => realCard(werk, 'al-diff', ['--title', 'Diff the alignment', '--parent', 'map'])

test('71.1 known card ids in a card body become links, and other text stays plain', async ({ page, werk }) => {
  alDiff(werk)
  realCard(werk, 'align', ['--title', 'Align the rows', '--parent', 'map'])
  const body = 'See #al-diff and #ghost-card. The bare al-diff and the bare align here. Run `node src/cli.ts show #al-diff` to print it.'
  realCard(werk, 'notes-card', ['--title', 'Notes', '--parent', 'map', '--body', body])
  await page.goto(`${werk.url}#notes-card`)
  const md = page.getByTestId('card').locator('.body')
  await expect(md).toContainText('See #al-diff and #ghost-card')
  const links = md.locator('a')
  await expect(links).toHaveText(['#al-diff', 'al-diff'])
  for (const l of await links.all()) await expect(l).toHaveAttribute('href', '#al-diff')
  await expect(md.locator('a', { hasText: 'ghost-card' })).toHaveCount(0)
  await expect(md).toContainText('#ghost-card')
  await expect(md.locator('a', { hasText: /^align$/ })).toHaveCount(0)
  await expect(md).toContainText('the bare align here')
  const code = md.locator('code', { hasText: 'node src/cli.ts show #al-diff' })
  await expect(code).toHaveCount(1)
  await expect(code.locator('a')).toHaveCount(0)
  await expect(md.locator('a code')).toHaveCount(0)
})

test('71.2 a click on a card link in a why line opens that card', async ({ page, werk }) => {
  alDiff(werk)
  realCard(werk, 'pr-iface', ['--title', 'The PR interface', '--parent', 'map', '--why', 'It needs #al-diff to show changes.'])
  await page.goto(`${werk.url}#pr-iface`)
  await page.getByTestId('card').locator('.why').getByRole('link', { name: '#al-diff' }).click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'al-diff')
  await expect(page.getByTestId('card').getByRole('heading', { level: 1 })).toHaveText('Diff the alignment')
})

test('71.3 headings, URL fragments and fenced blocks keep their own form', async ({ page, werk }) => {
  alDiff(werk)
  const body = ['# al-diff', '', 'Docs: https://example.com/page#al-diff', '', 'The span `#al-diff` names it.', '', '```', '#al-diff', '```'].join('\n')
  realCard(werk, 'doc-card', ['--title', 'Docs', '--parent', 'map', '--body', body])
  await page.goto(`${werk.url}#doc-card`)
  const md = page.getByTestId('card').locator('.body')
  const heading = md.getByRole('heading', { name: 'al-diff' })
  await expect(heading).toHaveText('al-diff')
  await expect(heading.locator('a')).toHaveCount(0)
  await expect(md).toContainText('https://example.com/page#al-diff')
  await expect(md.locator('p', { hasText: 'Docs:' }).locator('a')).toHaveCount(0)
  await expect(md.locator('pre')).toContainText('#al-diff')
  await expect(md.locator('pre a')).toHaveCount(0)
  const spanLink = md.locator('a', { has: page.locator('code', { hasText: '#al-diff' }) })
  await expect(spanLink).toHaveCount(1)
  await expect(spanLink).toHaveAttribute('href', '#al-diff')
  await expect(md.locator('a')).toHaveCount(1)
})

test('71.4 a grid tile summary with a card id holds no link, but a note on the open card does', async ({ page, werk }) => {
  alDiff(werk)
  realCard(werk, 'ref-card', ['--title', 'Follows up on #al-diff', '--parent', 'map'])
  werk.cli(['say', 'ref-card', '--text', 'See al-diff first'])
  await page.goto(werk.url)
  const tile = page.locator('li[data-card-id="ref-card"] > a')
  await expect(tile).toContainText('Follows up on #al-diff')
  await expect(tile.locator('a')).toHaveCount(0)
  await tile.click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'ref-card')
  const notes = page.getByRole('region', { name: 'notes' })
  await expect(notes).toContainText('See al-diff first')
  await expect(notes.getByRole('link', { name: 'al-diff' })).toHaveAttribute('href', '#al-diff')
})

const LONG_LINE = `        "deep": "${'y'.repeat(400)}"`
const CODE_LINES = ['{', '    "outer": {', '        "inner": {', '            "n": 1', '        },', LONG_LINE, '    }', '}']

test('71.5 fenced code in a card shows boxed, highlighted, and with its own indentation', async ({ page, werk }) => {
  const body = ['A paragraph before the code.', '', '```json', ...CODE_LINES, '```', '', 'A paragraph after the code.'].join('\n')
  realCard(werk, 'code-card', ['--title', 'Code card', '--parent', 'map', '--body', body])
  await page.goto(`${werk.url}#code-card`)
  const card = page.getByTestId('card')
  const pre = card.locator('pre')
  await expect(pre).toHaveCount(1)
  await expect(pre).toHaveCSS('border-top-style', 'solid')
  await expect(pre.locator('[class^="tok-"]').first()).toBeVisible()
  expect(await pre.locator('[class^="tok-"]').count()).toBeGreaterThan(3)
  expect(await pre.evaluate((el) => el.textContent)).toBe(CODE_LINES.join('\n'))
  expect(await pre.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
  await pre.hover()
  await page.mouse.wheel(2000, 0)
  await expect.poll(() => pre.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0)
  const cardWidth = await card.evaluate((el) => el.clientWidth)
  for (const p of await card.locator('.body p').all()) expect((await p.boundingBox())!.width).toBeLessThanOrEqual(cardWidth)
  expect(await card.locator('.body').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})
