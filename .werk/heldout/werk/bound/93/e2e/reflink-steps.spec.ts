/**
 * Steps 71.x: card links and fenced code in the map.
 * Mapping: "summary" of a card = its title (the text a tile shows, and the card's h1).
 * "grid"/"tile" = the refines tree on the map page (the source calls its items tiles).
 * "notes thread" = notes written with `werk say`.
 * Cards are proposed with `add` and accepted with `accept --actor you`, so they are real.
 */
import { expect, test, type Werk } from './harness.ts'

function card(werk: Werk, id: string, title: string, extra: string[] = []) {
  werk.cli(['add', id, '--title', title, ...extra])
  werk.cli(['accept', id, '--actor', 'you'])
}

test('71.1 Known card ids in a card body become links, and other text stays plain', async ({ page, werk }) => {
  card(werk, 'al-diff', 'Align diff')
  card(werk, 'align', 'Align')
  const body = 'Mentions #al-diff and #ghost-card, then the bare al-diff and the word align. Run `node src/cli.ts show #al-diff` to see it.'
  card(werk, 'notes-card', 'Notes card', ['--body', body])
  await page.goto(`${werk.url}#notes-card`)
  const b = page.getByTestId('card').locator('.body')
  await expect(b).toContainText('Mentions #al-diff and #ghost-card')
  // "#al-diff" as a link
  await expect(b.locator('a', { hasText: /^#al-diff$/ })).toHaveCount(1)
  await expect(b.locator('a', { hasText: /^#al-diff$/ })).toHaveAttribute('href', '#al-diff')
  // the bare "al-diff" as a link
  await expect(b.locator('a', { hasText: /^al-diff$/ })).toHaveCount(1)
  await expect(b.locator('a', { hasText: /^al-diff$/ })).toHaveAttribute('href', '#al-diff')
  // "#ghost-card" plain
  await expect(b.locator('a', { hasText: 'ghost-card' })).toHaveCount(0)
  // the bare word "align" plain
  await expect(b.locator('a', { hasText: /^#?align$/ })).toHaveCount(0)
  // the code span is code, with no link in it and not inside a link
  const code = b.locator('code', { hasText: 'node src/cli.ts show #al-diff' })
  await expect(code).toHaveCount(1)
  await expect(code.locator('a')).toHaveCount(0)
  await expect(b.locator('a code')).toHaveCount(0)
})

test('71.2 A click on a card link in a why line opens that card', async ({ page, werk }) => {
  card(werk, 'al-diff', 'Diff the alignment')
  card(werk, 'pr-iface', 'PR interface', ['--why', 'It builds on #al-diff.'])
  await page.goto(`${werk.url}#pr-iface`)
  await page.getByTestId('card').locator('.why a', { hasText: '#al-diff' }).click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'al-diff')
  await expect(page.getByTestId('card').getByRole('heading', { level: 1 })).toHaveText('Diff the alignment')
})

test('71.3 Headings, URL fragments and fenced blocks keep their own form', async ({ page, werk }) => {
  card(werk, 'al-diff', 'Align diff')
  const body = [
    '# al-diff',
    '',
    'Docs at https://example.com/page#al-diff here.',
    '',
    'The span `#al-diff` names it.',
    '',
    '```',
    '#al-diff',
    '```',
  ].join('\n')
  card(werk, 'doc-card', 'Doc card', ['--body', body])
  await page.goto(`${werk.url}#doc-card`)
  const b = page.getByTestId('card').locator('.body')
  const heading = b.getByRole('heading', { name: 'al-diff' })
  await expect(heading).toHaveText('al-diff')
  await expect(heading.locator('a')).toHaveCount(0)
  const urlPara = b.locator('p', { hasText: 'https://example.com/page#al-diff' })
  await expect(urlPara).toHaveCount(1)
  await expect(urlPara.locator('a.ref')).toHaveCount(0)
  await expect(urlPara.locator('a', { hasText: /^#?al-diff$/ })).toHaveCount(0)
  const pre = b.locator('pre')
  await expect(pre).toContainText('#al-diff')
  await expect(pre.locator('code')).toHaveCount(1)
  await expect(pre.locator('a')).toHaveCount(0)
  const spanLink = b.locator('a', { has: page.locator('code', { hasText: /^#al-diff$/ }) })
  await expect(spanLink).toHaveCount(1)
  await expect(spanLink).toHaveAttribute('href', '#al-diff')
})

test('71.4 A grid tile summary with a card id holds no link, but a note on the open card does', async ({ page, werk }) => {
  card(werk, 'al-diff', 'Align diff')
  card(werk, 'ref-card', 'Follows up on #al-diff')
  werk.cli(['say', 'ref-card', '--text', 'See al-diff first'])
  await page.goto(werk.url)
  const tile = page.locator('li[data-card-id="ref-card"] > a')
  await expect(tile).toContainText('Follows up on #al-diff')
  await expect(tile.locator('a')).toHaveCount(0)
  await tile.click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'ref-card')
  const notes = page.getByRole('region', { name: 'notes' })
  await expect(notes).toContainText('See al-diff first')
  await expect(notes.locator('a', { hasText: /^al-diff$/ })).toHaveCount(1)
})

const LONG = `        "end": "${'x'.repeat(300)}END"`
const CODE_LINES = ['{', '    "outer": {', '        "inner": {', '            "n": 1', '        },', LONG, '    }', '}']

test('71.5 Fenced code in a card shows boxed, highlighted, and with its own indentation', async ({ page, werk }) => {
  const body = ['Some text before the code.', '', '```json', ...CODE_LINES, '```', '', 'Some text after the code.'].join('\n')
  card(werk, 'code-card', 'Code card', ['--body', body])
  await page.goto(`${werk.url}#code-card`)
  const art = page.getByTestId('card')
  const pre = art.locator('.body pre')
  // boxed
  await expect(pre).toHaveCSS('border-top-style', 'solid')
  await expect(pre).toHaveCSS('overflow-x', 'auto')
  // highlighted
  expect(await pre.locator('[class^="tok-"]').count()).toBeGreaterThan(0)
  await expect(pre.locator('.tok-key').first()).toHaveText('"outer"')
  // indentation kept
  expect(await pre.evaluate((el) => el.textContent)).toBe(CODE_LINES.join('\n'))
  // sideways scroll to read the end of the long line
  expect(await pre.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
  await pre.hover()
  await page.mouse.wheel(10_000, 0)
  await expect.poll(() => pre.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0)
  const endVisible = await pre.evaluate((el) => el.scrollLeft + el.clientWidth >= el.scrollWidth - 1)
  expect(endVisible).toBe(true)
  // the rest of the body does not grow wider than the card
  const widths = await art.evaluate((a) => {
    const b = a.querySelector('.body') as HTMLElement
    return { card: a.clientWidth, body: b.scrollWidth, bodyClient: b.clientWidth, page: document.documentElement.scrollWidth, win: window.innerWidth }
  })
  expect(widths.body).toBeLessThanOrEqual(widths.card)
  expect(widths.page).toBeLessThanOrEqual(widths.win)
})
