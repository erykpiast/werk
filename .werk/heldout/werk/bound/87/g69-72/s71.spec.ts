import { expect, real, test, tile } from './h.ts'

const known = () => [...real('top', { title: 'Top' }), ...real('al-diff', { title: 'Diff the alignment', parent: 'top' }), ...real('align', { title: 'Align', parent: 'top' })]

test('71.1 known card ids in a card body become links, and other text stays plain', async ({ page, boot }) => {
  const body = 'See #al-diff and #ghost-card. Also al-diff and align. Run `node src/cli.ts show #al-diff` now.'
  const p = await boot([...known(), ...real('notes-card', { title: 'Notes', parent: 'top', body })])
  await page.goto(p.url)
  await page.locator(`${tile('notes-card')} > a`).click()
  const b = page.getByTestId('card').locator('.body')
  await expect(b).toContainText('See #al-diff')
  await expect(b.locator('a', { hasText: /^#al-diff$/ })).toHaveCount(1)
  await expect(b.locator('a', { hasText: /^al-diff$/ })).toHaveCount(1)
  for (const a of await b.locator('a').all()) await expect(a).toHaveAttribute('href', '#al-diff')
  await expect(b).toContainText('#ghost-card')
  await expect(b.locator('a', { hasText: 'ghost-card' })).toHaveCount(0)
  await expect(b).toContainText('align')
  await expect(b.locator('a', { hasText: /^align$/ })).toHaveCount(0)
  const code = b.locator('code', { hasText: 'node src/cli.ts show #al-diff' })
  await expect(code).toHaveCount(1)
  await expect(code.locator('a')).toHaveCount(0)
  await expect(b.locator('a')).toHaveCount(2)
})

test('71.2 a click on a card link in a why line opens that card', async ({ page, boot }) => {
  const p = await boot([...known(), ...real('pr-iface', { title: 'PR interface', parent: 'top', why: 'It builds on #al-diff.' })])
  await page.goto(p.url)
  await page.locator(`${tile('pr-iface')} > a`).click()
  await page.getByTestId('card').locator('.why a', { hasText: '#al-diff' }).click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'al-diff')
  await expect(page.getByTestId('card')).toContainText('Diff the alignment')
})

test('71.3 headings, URL fragments and fenced blocks keep their own form', async ({ page, boot }) => {
  const body = ['# al-diff', '', 'Docs: https://example.com/page#al-diff', '', 'The span `#al-diff` is a reference.', '', '```', '#al-diff', '```'].join('\n')
  const p = await boot([...known(), ...real('doc-card', { title: 'Doc', parent: 'top', body })])
  await page.goto(p.url)
  await page.locator(`${tile('doc-card')} > a`).click()
  const b = page.getByTestId('card').locator('.body')
  const h = b.getByRole('heading', { name: 'al-diff' })
  await expect(h).toHaveCount(1)
  await expect(h.locator('a')).toHaveCount(0)
  await expect(b).toContainText('https://example.com/page#al-diff')
  const hrefs = await b.locator('a').evaluateAll((as) => as.map((a) => [a.getAttribute('href'), a.textContent, a.closest('code,pre')?.tagName ?? a.querySelector('code') ? 'code' : '']))
  console.log(JSON.stringify(hrefs))
  // the URL fragment is not a card link: no card link whose text is a piece of the URL
  for (const a of await b.locator('a[href="#al-diff"]').all()) {
    const inPara = await a.evaluate((el) => el.parentElement?.textContent ?? '')
    expect(inPara.includes('https://example.com/page') && !inPara.includes('span')).toBe(false)
  }
  await expect(b.locator('pre')).toContainText('#al-diff')
  await expect(b.locator('pre a')).toHaveCount(0)
  // the code span #al-diff links to the card
  const spanLink = b.locator('p', { hasText: 'The span' }).locator('a[href="#al-diff"]')
  await expect(spanLink).toHaveCount(1)
  await expect(spanLink).toContainText('#al-diff')
})

test('71.4 a grid tile summary with a card id holds no link, but a note on the open card does', async ({ page, boot }) => {
  const p = await boot([...known(), ...real('ref-card', { title: 'Follows up on #al-diff', parent: 'top' }), { type: 'note.said', payload: { id: 'ref-card', text: 'See al-diff first' } }])
  await page.goto(p.url)
  const t = page.locator(`${tile('ref-card')} > a`)
  await expect(t).toContainText('Follows up on #al-diff')
  await expect(t.locator('a')).toHaveCount(0)
  await t.click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'ref-card')
  const notes = page.getByRole('region', { name: 'notes' })
  await expect(notes.locator('a', { hasText: 'al-diff' })).toHaveAttribute('href', '#al-diff')
})

test('71.5 fenced code in a card shows boxed, highlighted, and with its own indentation', async ({ page, boot }) => {
  const LONG = `        "deep": "${'y'.repeat(400)}"`
  const lines = ['{', '    "a": {', LONG, '    }', '}']
  const body = ['Some text before.', '', '```json', ...lines, '```', '', 'Some text after.'].join('\n')
  const p = await boot([...known(), ...real('code-card', { title: 'Code', parent: 'top', body })])
  await page.goto(p.url)
  await page.locator(`${tile('code-card')} > a`).click()
  const card = page.getByTestId('card')
  const pre = card.locator('pre')
  await expect(pre).toHaveCount(1)
  await expect(pre).toHaveCSS('border-top-style', 'solid')
  expect(await pre.locator('span[class]').count()).toBeGreaterThan(0)
  expect(await pre.evaluate((el) => el.textContent)).toBe(lines.join('\n'))
  expect(await pre.evaluate((el) => getComputedStyle(el).overflowX)).toMatch(/auto|scroll/)
  expect(await pre.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
  await pre.evaluate((el) => (el.scrollLeft = el.scrollWidth))
  expect(await pre.evaluate((el) => el.scrollLeft > 0)).toBe(true)
  const bodyW = await card.locator('.body').evaluate((el) => el.getBoundingClientRect().width)
  const cardW = await card.evaluate((el) => el.getBoundingClientRect().width)
  expect(bodyW).toBeLessThanOrEqual(cardW)
  expect(await card.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})
