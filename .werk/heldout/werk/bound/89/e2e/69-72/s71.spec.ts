import { expect, test, type Werk } from '../../../e2e/harness.ts'

// Reading: the product has no "summary" field; a card's title is the one-line text on its tile,
// so "summary" maps to --title. The "grid" is the map view's tree of tiles (no card open).
const card = (id: string) => `li[data-card-id="${id}"]`

function knownCards(werk: Werk) {
  werk.cli(['add', 'al-diff', '--title', 'Diff the alignment', '--parent', 'werk'])
  werk.cli(['accept', 'al-diff', '--actor', 'you'])
  werk.cli(['add', 'align', '--title', 'Align the two texts', '--parent', 'werk'])
  werk.cli(['accept', 'align', '--actor', 'you'])
}

/** The person opens the map and clicks the tile of `id`. */
async function openFromMap(page: import('@playwright/test').Page, werk: Werk, id: string) {
  await page.goto(werk.url)
  await page.locator(`${card(id)} > a`).click()
  await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', id)
}

// 71.1
// Scenario: Known card ids in a card body become links, and other text stays plain
// Given the map holds a card "al-diff" and a card "align"
// And a card "notes-card" has a body that mentions "#al-diff", "#ghost-card", the bare word "al-diff", the bare word "align", and a code span "node src/cli.ts show #al-diff"
// When the user opens the card "notes-card" in the map
// Then the body shows "#al-diff" as a link
// And the body shows the bare "al-diff" as a link
// But the body shows "#ghost-card" as plain text
// And the body shows the bare word "align" as plain text
// And the body shows the code span "node src/cli.ts show #al-diff" as code with no link in it
test('71.1 known ids in a body link, other text stays plain', async ({ page, werk }) => {
  knownCards(werk)
  const body = ['See #al-diff and #ghost-card, then al-diff and align.', '', 'Run `node src/cli.ts show #al-diff` to print it.'].join('\n')
  werk.cli(['add', 'notes-card', '--title', 'A card with notes', '--parent', 'werk', '--body', body])
  await openFromMap(page, werk, 'notes-card')

  const b = page.getByTestId('card').locator('.body')
  await expect(b).toContainText('See #al-diff and #ghost-card, then al-diff and align.')
  const links = b.locator('a')
  await expect(links).toHaveText(['#al-diff', 'al-diff'])
  for (const l of await links.all()) await expect(l).toHaveAttribute('href', '#al-diff')
  await expect(b.locator('a', { hasText: 'ghost-card' })).toHaveCount(0)
  await expect(b.locator('a', { hasText: /^align$/ })).toHaveCount(0)
  const code = b.locator('code', { hasText: 'node src/cli.ts show #al-diff' })
  await expect(code).toHaveCount(1)
  await expect(code.locator('a')).toHaveCount(0)
})

// 71.2
// Scenario: A click on a card link in a why line opens that card
// Given the map holds a card "al-diff" with the summary "Diff the alignment"
// And a card "pr-iface" has a why line that mentions "#al-diff"
// When the user opens the card "pr-iface" in the map
// And the user clicks the "#al-diff" link in the why line
// Then the map shows the card "al-diff"
// And the user sees the summary "Diff the alignment"
test('71.2 a click on a card link in a why line opens that card', async ({ page, werk }) => {
  knownCards(werk)
  werk.cli(['add', 'pr-iface', '--title', 'The PR interface', '--parent', 'werk', '--why', 'It builds on #al-diff.'])
  await openFromMap(page, werk, 'pr-iface')
  await page.getByTestId('card').locator('.why a', { hasText: '#al-diff' }).click()
  await expect(page).toHaveURL(/#al-diff$/)
  await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'al-diff')
  await expect(page.getByTestId('card').getByRole('heading', { level: 1 })).toHaveText('Diff the alignment')
})

// 71.3
// Scenario: Headings, URL fragments and fenced blocks keep their own form
// Given the map holds a card "al-diff"
// And a card "doc-card" has a body with the heading "# al-diff", the URL "https://example.com/page#al-diff", a code span "`#al-diff`", and a fenced block that holds "#al-diff"
// When the user opens the card "doc-card" in the map
// Then the heading shows the text "al-diff" with no link
// And the URL fragment "#al-diff" is not a card link
// And the fenced block shows "#al-diff" as code with no link
// But the code span "#al-diff" shows as a link to the card "al-diff"
test('71.3 headings, URL fragments and fences keep their own form', async ({ page, werk }) => {
  knownCards(werk)
  const body = [
    '# al-diff',
    '',
    'Docs: https://example.com/page#al-diff',
    '',
    'The span `#al-diff` names it.',
    '',
    '```',
    '#al-diff',
    '```',
  ].join('\n')
  werk.cli(['add', 'doc-card', '--title', 'A card with a doc', '--parent', 'werk', '--body', body])
  await openFromMap(page, werk, 'doc-card')

  const b = page.getByTestId('card').locator('.body')
  const heading = b.getByRole('heading', { name: 'al-diff' })
  await expect(heading).toHaveText('al-diff')
  await expect(heading.locator('a')).toHaveCount(0)

  await expect(b).toContainText('https://example.com/page#al-diff')
  const urlPara = b.locator('p', { hasText: 'example.com' })
  await expect(urlPara.locator('a[href="#al-diff"]')).toHaveCount(0)

  const pre = b.locator('pre')
  await expect(pre).toContainText('#al-diff')
  await expect(pre.locator('a')).toHaveCount(0)

  const cardLinks = b.locator('a[href="#al-diff"]')
  await expect(cardLinks).toHaveCount(1)
  await expect(cardLinks).toHaveText('#al-diff')
  // The link is the code span.
  expect(await cardLinks.evaluate((a) => a.querySelector('code') !== null || a.closest('code') !== null)).toBe(true)
})

// 71.4
// Scenario: A grid tile summary with a card id holds no link, but a note on the open card does
// Given the map holds a card "al-diff"
// And a card "ref-card" has the summary "Follows up on #al-diff"
// And the card "ref-card" has a note that says "See al-diff first"
// When the user looks at the grid
// Then the tile for "ref-card" shows the text "Follows up on #al-diff" with no link in it
// When the user clicks the tile for "ref-card"
// Then the map opens the card "ref-card"
// And the notes thread shows "al-diff" as a link
test('71.4 a tile title with an id holds no link, a note does', async ({ page, werk }) => {
  knownCards(werk)
  werk.cli(['add', 'ref-card', '--title', 'Follows up on #al-diff', '--parent', 'werk'])
  werk.cli(['say', 'ref-card', '--text', 'See al-diff first'])
  await page.goto(werk.url)
  const tile = page.locator(`${card('ref-card')} > a`)
  await expect(tile).toContainText('Follows up on #al-diff')
  await expect(tile.locator('a')).toHaveCount(0)

  await tile.click()
  await expect(page).toHaveURL(/#ref-card$/)
  await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'ref-card')
  const notes = page.getByRole('region', { name: 'notes' })
  await expect(notes).toContainText('See al-diff first')
  await expect(notes.locator('a')).toHaveText(['al-diff'])
  await expect(notes.locator('a')).toHaveAttribute('href', '#al-diff')
})

// 71.5
// Scenario: Fenced code in a card shows boxed, highlighted, and with its own indentation
// Given a card "code-card" has a body with a fenced "json" block
// And the block holds a nested object with four-space indentation and one line longer than the card is wide
// When the user opens the card "code-card" in the map
// Then the code shows inside a box with syntax highlighting
// And every line keeps the indentation the writer gave it
// And the user can scroll the box sideways to read the end of the long line
// And the rest of the card body does not grow wider than the card
test('71.5 fenced code is boxed, highlighted, indented and scrolls sideways', async ({ page, werk }) => {
  const LONG = `        "tail": "${'y'.repeat(380)}END"`
  const lines = ['{', '    "outer": {', '        "inner": 1,', LONG, '    }', '}']
  const body = ['Some text before the code.', '', '```json', ...lines, '```', '', 'Some text after the code.'].join('\n')
  werk.cli(['add', 'code-card', '--title', 'A card with code', '--parent', 'werk', '--body', body])
  await openFromMap(page, werk, 'code-card')

  const article = page.getByTestId('card')
  const pre = article.locator('.body pre')
  await expect(pre).toHaveCount(1)
  await expect(pre).toHaveCSS('border-top-style', 'solid')
  expect(await pre.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)')
  // Syntax highlighting: token spans with a colour other than the text colour.
  const tokens = pre.locator('[class^="tok-"], [class*=" tok-"]')
  expect(await tokens.count()).toBeGreaterThan(0)
  const preColour = await pre.evaluate((el) => getComputedStyle(el).color)
  const tokColours = await tokens.evaluateAll((els) => els.map((e) => getComputedStyle(e).color))
  expect(tokColours.some((c) => c !== preColour)).toBe(true)

  expect(await pre.evaluate((el) => el.textContent)).toBe(lines.join('\n'))

  expect(await pre.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
  await pre.hover()
  await page.mouse.wheel(5000, 0)
  await expect.poll(() => pre.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0)
  const endVisible = await pre.evaluate((el) => el.scrollLeft + el.clientWidth >= el.scrollWidth - 2)
  expect(endVisible).toBe(true)

  const widths = await article.evaluate((a) => {
    const body = a.querySelector('.body') as HTMLElement
    return { body: body.scrollWidth, card: a.clientWidth, doc: document.documentElement.scrollWidth, win: window.innerWidth }
  })
  console.log('71.5 widths', widths)
  expect(widths.body).toBeLessThanOrEqual(widths.card)
  expect(widths.doc).toBeLessThanOrEqual(widths.win)
})
