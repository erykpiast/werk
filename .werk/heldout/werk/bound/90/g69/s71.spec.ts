/** Held-out steps 71.1–71.5: card links and code in the map. */
import { expect, test } from '../../e2e/harness.ts'
import type { Werk } from '../../e2e/harness.ts'
import { card, realCard, seed } from './helpers.ts'

const alDiff = (werk: Werk, extra: Record<string, unknown> = {}) =>
  seed(werk, [...realCard('al-diff', 'Diff the alignment', { parent: 'werk', ...extra }), ...realCard('align', 'Align things', { parent: 'werk' })])

test('71.1 known card ids in a card body become links, and other text stays plain', async ({ page, werk }) => {
  alDiff(werk)
  const body = 'See #al-diff and #ghost-card. Also al-diff and align.\n\nRun `node src/cli.ts show #al-diff` to print.'
  seed(werk, realCard('notes-card', 'Notes card', { parent: 'werk', body }))
  await page.goto(werk.url)
  await page.locator(`${card('notes-card')} > a`).click()
  const md = page.getByTestId('card').locator('.body')
  await expect(md).toContainText('See #al-diff and #ghost-card')
  const links = md.locator('a')
  await expect(links).toHaveText(['#al-diff', 'al-diff'])
  for (const l of await links.all()) await expect(l).toHaveAttribute('href', '#al-diff')
  await expect(md.locator('a', { hasText: 'ghost-card' })).toHaveCount(0)
  await expect(md.locator('a', { hasText: /^align$/ })).toHaveCount(0)
  const code = md.locator('code', { hasText: 'node src/cli.ts show #al-diff' })
  await expect(code).toHaveCount(1)
  await expect(code.locator('a')).toHaveCount(0)
})

test('71.2 a click on a card link in a why line opens that card', async ({ page, werk }) => {
  alDiff(werk)
  seed(werk, realCard('pr-iface', 'PR interface', { parent: 'werk', why: 'It builds on #al-diff.' }))
  await page.goto(werk.url)
  await page.locator(`${card('pr-iface')} > a`).click()
  await page.getByTestId('card').locator('.why a', { hasText: '#al-diff' }).click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'al-diff')
  await expect(page.getByTestId('card')).toContainText('Diff the alignment')
})

test('71.3 headings, URL fragments and fenced blocks keep their own form', async ({ page, werk }) => {
  alDiff(werk)
  const body = ['# al-diff', '', 'Docs: https://example.com/page#al-diff', '', 'The span `#al-diff` names it.', '', '```', '#al-diff', '```'].join('\n')
  seed(werk, realCard('doc-card', 'Doc card', { parent: 'werk', body }))
  await page.goto(werk.url)
  await page.locator(`${card('doc-card')} > a`).click()
  const md = page.getByTestId('card').locator('.body')
  const heading = md.getByRole('heading', { name: 'al-diff' })
  await expect(heading).toHaveText('al-diff')
  await expect(heading.locator('a')).toHaveCount(0)
  // URL fragment is not a card link
  const urlish = md.locator('p', { hasText: 'https://example.com/page' })
  await expect(urlish.locator('a[href="#al-diff"]')).toHaveCount(0)
  // fenced block
  await expect(md.locator('pre')).toContainText('#al-diff')
  await expect(md.locator('pre a')).toHaveCount(0)
  // code span links
  const spanPara = md.locator('p', { hasText: 'The span' })
  await expect(spanPara.locator('a[href="#al-diff"]')).toHaveCount(1)
  await expect(spanPara.locator('a[href="#al-diff"]')).toContainText('#al-diff')
})

test('71.4 a grid tile summary with a card id holds no link, but a note on the open card does', async ({ page, werk }) => {
  alDiff(werk)
  seed(werk, realCard('ref-card', 'Follows up on #al-diff', { parent: 'werk' }))
  werk.cli(['say', 'ref-card', '--text', 'See al-diff first'])
  await page.goto(werk.url)
  const tile = page.locator(`${card('ref-card')} > a`)
  await expect(tile).toContainText('Follows up on #al-diff')
  await expect(tile.locator('a')).toHaveCount(0)
  await tile.click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'ref-card')
  const notes = page.getByRole('region', { name: 'notes' })
  await expect(notes.locator('a', { hasText: 'al-diff' })).toHaveAttribute('href', '#al-diff')
})

test('71.5 fenced code in a card shows boxed, highlighted, and with its own indentation', async ({ page, werk }) => {
  const longLine = `        "long": "${'y'.repeat(400)}"`
  const lines = ['{', '    "outer": {', '        "inner": 1,', longLine, '    }', '}']
  const body = ['Some text before the code.', '', '```json', ...lines, '```', '', 'Some text after.'].join('\n')
  seed(werk, realCard('code-card', 'Code card', { parent: 'werk', body }))
  await page.goto(werk.url)
  await page.locator(`${card('code-card')} > a`).click()
  const detail = page.getByTestId('card')
  const pre = detail.locator('pre')
  await expect(pre).toHaveCount(1)
  // boxed
  const border = await pre.evaluate((el) => getComputedStyle(el).borderTopStyle)
  expect(border).not.toBe('none')
  // highlighted: some token span with a colour
  expect(await pre.locator('span[class*="tok"]').count()).toBeGreaterThan(0)
  // indentation kept
  expect(await pre.evaluate((el) => el.textContent)).toBe(lines.join('\n'))
  // sideways scroll
  expect(await pre.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
  const ox = await pre.evaluate((el) => getComputedStyle(el).overflowX)
  expect(['auto', 'scroll']).toContain(ox)
  // the rest of the body does not grow wider than the card
  const widths = await detail.evaluate((el) => {
    const body = el.querySelector('.body') as HTMLElement
    return { card: el.clientWidth, body: body.scrollWidth, page: document.documentElement.scrollWidth, win: window.innerWidth }
  })
  expect(widths.body).toBeLessThanOrEqual(widths.card)
  expect(widths.page).toBeLessThanOrEqual(widths.win)
})
