import { card, expect, note, real, test } from './harness.ts'

const alDiff = real('al-diff', 'Diff the alignment')
const align = real('align', 'Align the map')

test('71.1 known card ids in a card body become links, and other text stays plain', async ({ page, boot }) => {
  const body = 'See #al-diff and #ghost-card. Also al-diff, and align the rows.\n\nRun `node src/cli.ts show #al-diff` to see it.'
  const werk = await boot({ log: [...alDiff, ...align, ...real('notes-card', 'Notes', { body })] })
  await page.goto(`${werk.url}#notes-card`)
  const b = page.getByTestId('card').locator('.body')
  await expect(b).toContainText('ghost-card')
  await expect(b.locator('a', { hasText: /^#al-diff$/ })).toHaveCount(1)
  await expect(b.locator('a', { hasText: /^al-diff$/ })).toHaveCount(1)
  await expect(b.locator('a', { hasText: 'ghost-card' })).toHaveCount(0)
  await expect(b.locator('a', { hasText: /^align$/ })).toHaveCount(0)
  const code = b.locator('code', { hasText: 'node src/cli.ts show #al-diff' })
  await expect(code).toHaveCount(1)
  await expect(code.locator('a')).toHaveCount(0)
})

test('71.2 a click on a card link in a why line opens that card', async ({ page, boot }) => {
  const werk = await boot({ log: [...alDiff, ...real('pr-iface', 'The PR interface', { why: 'It builds on #al-diff.' })] })
  await page.goto(`${werk.url}#pr-iface`)
  await page.getByTestId('card').locator('.why').getByRole('link', { name: '#al-diff' }).click()
  await expect(page).toHaveURL(/#al-diff$/)
  await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'al-diff')
  await expect(page.getByTestId('card')).toContainText('Diff the alignment')
})

test('71.3 headings, URL fragments and fenced blocks keep their own form', async ({ page, boot }) => {
  const body = ['# al-diff', '', 'Read https://example.com/page#al-diff first.', '', 'The id is `#al-diff`.', '', '```', '#al-diff', '```', ''].join('\n')
  const werk = await boot({ log: [...alDiff, ...real('doc-card', 'Doc', { body })] })
  await page.goto(`${werk.url}#doc-card`)
  const b = page.getByTestId('card').locator('.body')
  const heading = b.locator('h1, h2, h3, h4, h5, h6', { hasText: 'al-diff' })
  await expect(heading).toHaveCount(1)
  await expect(heading.locator('a')).toHaveCount(0)
  // No card link sits inside the URL.
  const p = b.locator('p', { hasText: 'example.com' })
  await expect(p.locator('a[href="#al-diff"]')).toHaveCount(0)
  const pre = b.locator('pre')
  await expect(pre).toContainText('#al-diff')
  await expect(pre.locator('a')).toHaveCount(0)
  const span = b.locator('p', { hasText: 'The id is' })
  await expect(span.locator('a[href="#al-diff"]')).toHaveCount(1)
})

test('71.4 a grid tile summary with a card id holds no link, but a note on the open card does', async ({ page, boot }) => {
  await boot({ log: [...alDiff, ...real('ref-card', 'Follows up on #al-diff'), note('ref-card', 'See al-diff first')] })
  const tile = page.locator(`${card('ref-card')} > a`)
  await expect(tile).toContainText('Follows up on #al-diff')
  await expect(tile.locator('a')).toHaveCount(0)
  await tile.click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'ref-card')
  const notes = page.getByRole('region', { name: 'notes' })
  await expect(notes.getByRole('link', { name: 'al-diff' })).toHaveCount(1)
})

test('71.5 fenced code in a card shows boxed, highlighted, and with its own indentation', async ({ page, boot }) => {
  const long = '"description": "' + 'a very long value that runs on and on '.repeat(12) + '"'
  const json = ['{', '    "outer": {', '        "inner": {', `            ${long}`, '        }', '    }', '}'].join('\n')
  const body = ['Before the code.', '', '```json', json, '```', '', 'After the code.'].join('\n')
  const werk = await boot({ log: real('code-card', 'Code', { body }) })
  await page.goto(`${werk.url}#code-card`)
  const art = page.getByTestId('card')
  const pre = art.locator('.body pre')
  await expect(pre).toHaveCount(1)
  const box = await pre.evaluate((el) => {
    const s = getComputedStyle(el)
    const hasBorder = s.borderTopStyle !== 'none' && parseFloat(s.borderTopWidth) > 0
    const hasBg = s.backgroundColor !== 'rgba(0, 0, 0, 0)' && s.backgroundColor !== getComputedStyle(el.parentElement!).backgroundColor
    const colors = new Set([...el.querySelectorAll('span')].map((x) => getComputedStyle(x).color))
    return {
      boxed: hasBorder || hasBg,
      highlighted: colors.size >= 2,
      overflowX: s.overflowX,
      scrolls: el.scrollWidth > el.clientWidth,
      text: el.textContent ?? '',
    }
  })
  expect(box.boxed).toBe(true)
  expect(box.highlighted).toBe(true)
  for (const line of json.split('\n')) expect(box.text).toContain(line)
  expect(['auto', 'scroll']).toContain(box.overflowX)
  expect(box.scrolls).toBe(true)
  await pre.evaluate((el) => (el.scrollLeft = el.scrollWidth))
  expect(await pre.evaluate((el) => el.scrollLeft > 0)).toBe(true)
  const widths = await art.evaluate((el) => {
    const b = el.querySelector('.body') as HTMLElement
    return { body: b.scrollWidth, card: el.clientWidth, page: document.documentElement.scrollWidth, view: window.innerWidth }
  })
  expect(widths.body).toBeLessThanOrEqual(widths.card)
  expect(widths.page).toBeLessThanOrEqual(widths.view)
})
