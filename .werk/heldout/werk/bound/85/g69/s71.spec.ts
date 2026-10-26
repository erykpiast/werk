import { test, expect } from '@playwright/test'
import { project, card, say, type Proj, type Server } from './werk.ts'

const li = (id: string) => `li[data-card-id="${id}"]`
let p: Proj
let s: Server | undefined
test.afterEach(async ({ page }, info) => {
  await page.screenshot({ path: info.outputPath('evidence.png'), fullPage: true }).catch(() => {})
  await s?.stop()
  s = undefined
  p?.cleanup()
})

const known = () => [...card('al-diff', 'Diff the alignment'), ...card('align', 'Align the sources')]

test('71.1 known card ids in a card body become links, and other text stays plain', async ({ page }) => {
  const body = 'Mentions #al-diff and #ghost-card, then al-diff, then align, and `node src/cli.ts show #al-diff` here.'
  p = project([...known(), ...card('notes-card', 'Notes card', { body })])
  s = await p.serve()
  await page.goto(s.url)
  await page.locator(`${li('notes-card')} > a`).click()
  const b = page.getByTestId('card').locator('.body')
  await expect(b).toContainText('#ghost-card')
  await expect(b.locator('a', { hasText: /^#al-diff$/ })).toHaveCount(1)
  await expect(b.locator('a', { hasText: /^al-diff$/ })).toHaveCount(1)
  await expect(b.locator('a', { hasText: 'ghost-card' })).toHaveCount(0)
  await expect(b.locator('a', { hasText: /^align$/ })).toHaveCount(0)
  await expect(b.locator('a')).toHaveCount(2)
  const code = b.locator('code', { hasText: 'node src/cli.ts show #al-diff' })
  await expect(code).toHaveCount(1)
  await expect(code.locator('a')).toHaveCount(0)
})

test('71.2 a click on a card link in a why line opens that card', async ({ page }) => {
  p = project([...known(), ...card('pr-iface', 'PR interface', { why: 'It builds on #al-diff.' })])
  s = await p.serve()
  await page.goto(s.url)
  await page.locator(`${li('pr-iface')} > a`).click()
  await page.getByTestId('card').locator('.why a', { hasText: '#al-diff' }).click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'al-diff')
  await expect(page.getByTestId('card')).toContainText('Diff the alignment')
})

test('71.3 headings, URL fragments and fenced blocks keep their own form', async ({ page }) => {
  const body = ['# al-diff', '', 'See https://example.com/page#al-diff for more.', '', 'The span `#al-diff` names it.', '', '```', '#al-diff', '```'].join('\n')
  p = project([...known(), ...card('doc-card', 'Doc card', { body })])
  s = await p.serve()
  await page.goto(s.url)
  await page.locator(`${li('doc-card')} > a`).click()
  const b = page.getByTestId('card').locator('.body')
  const heading = b.getByRole('heading', { name: 'al-diff' })
  await expect(heading).toBeVisible()
  await expect(heading.locator('a')).toHaveCount(0)
  await expect(b).toContainText('https://example.com/page#al-diff')
  await expect(b.locator('a[href="#al-diff"]', { hasText: /^#al-diff$/ }).filter({ hasNot: page.locator('xx') })).toHaveCount(1)
  // the one card link is the code span, not the URL fragment
  const cardLinks = b.locator('a[href="#al-diff"]')
  await expect(cardLinks).toHaveCount(1)
  expect(await cardLinks.first().evaluate((a) => !!a.closest('code') || !!a.querySelector('code'))).toBe(true)
  await expect(b.locator('pre')).toContainText('#al-diff')
  await expect(b.locator('pre a')).toHaveCount(0)
})

test('71.4 a grid tile summary with a card id holds no link, but a note on the open card does', async ({ page }) => {
  p = project([...known(), ...card('ref-card', 'Follows up on #al-diff'), ...say('ref-card', 'See al-diff first')])
  s = await p.serve()
  await page.goto(s.url)
  const tile = page.locator(`${li('ref-card')} > a`)
  await expect(tile).toContainText('Follows up on #al-diff')
  await expect(tile.locator('a')).toHaveCount(0)
  await tile.click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'ref-card')
  const notes = page.getByRole('region', { name: 'notes' })
  await expect(notes.locator('a', { hasText: /^al-diff$/ })).toHaveAttribute('href', '#al-diff')
})

const LONG = `    "long": "${'y'.repeat(400)}"`
const JSON_BLOCK = ['{', '    "outer": {', '        "inner": 1', '    },', LONG, '}']
test('71.5 fenced code in a card shows boxed, highlighted, and with its own indentation', async ({ page }) => {
  const body = ['Some text before the code.', '', '```json', ...JSON_BLOCK, '```', '', 'Text after.'].join('\n')
  p = project(card('code-card', 'Code card', { body }))
  s = await p.serve()
  await page.goto(s.url)
  await page.locator(`${li('code-card')} > a`).click()
  const pre = page.getByTestId('card').locator('.body pre')
  await expect(pre).toBeVisible()
  await expect(pre).toHaveCSS('border-top-style', 'solid')
  expect(await pre.locator('[class*="tok-"]').count()).toBeGreaterThan(0)
  expect(await pre.evaluate((el) => el.textContent)).toBe(JSON_BLOCK.join('\n'))
  await expect(pre).toHaveCSS('overflow-x', 'auto')
  expect(await pre.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
  const fits = await page.getByTestId('card').locator('.body').evaluate((el) => {
    const card = el.closest('article')!
    return el.scrollWidth <= card.clientWidth + 1 && document.documentElement.scrollWidth <= window.innerWidth
  })
  expect(fits).toBe(true)
})
