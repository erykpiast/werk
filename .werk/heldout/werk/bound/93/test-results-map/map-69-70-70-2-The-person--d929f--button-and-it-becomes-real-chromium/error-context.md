# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: map-69-70.spec.ts >> 70.2 The person accepts one ghost with the ✓ button and it becomes real
- Location: .werk-heldout/e2e/map-69-70.spec.ts:136:1

# Error details

```
Test timeout of 60000ms exceeded.
```

```
Error: locator.click: Test timeout of 60000ms exceeded.
Call log:
  - waiting for getByRole('button', { name: '✓' })

```

# Page snapshot

```yaml
- generic [ref=e2]:
  - navigation "views" [ref=e3]:
    - link "Map" [ref=e4] [cursor=pointer]:
      - /url: "#"
    - link "Board" [ref=e5] [cursor=pointer]:
      - /url: "#/board"
  - main [ref=e6]:
    - navigation "breadcrumbs" [ref=e7]:
      - link "The map" [ref=e8] [cursor=pointer]:
        - /url: "#"
      - generic [ref=e9]:
        - text: /
        - link "Payments" [ref=e10] [cursor=pointer]:
          - /url: "#payments"
    - article [ref=e11]:
      - paragraph [ref=e12]: "#refunds proposed — not a real card until you accept it"
      - paragraph [ref=e13]:
        - 'button "Accept #refunds" [ref=e14] [cursor=pointer]': ✓
      - heading "Refunds" [level=1] [ref=e15]
      - generic [ref=e17]:
        - term [ref=e18]: kind
        - definition [ref=e19]: card
    - region "sub-cards" [ref=e20]:
      - heading "Sub-cards" [level=2] [ref=e21]
      - paragraph [ref=e22]: No sub-cards.
```

# Test source

```ts
  45  |       out += c.toString()
  46  |       if (sawWaitAt < 0 && /wait/i.test(out)) sawWaitAt = Date.now() - started
  47  |     })
  48  |     const code = await new Promise<number | null>((resolve) => {
  49  |       const t = setTimeout(() => {
  50  |         second.kill('SIGKILL')
  51  |         resolve(-999)
  52  |       }, 15_000)
  53  |       second.on('exit', (c) => {
  54  |         clearTimeout(t)
  55  |         resolve(c)
  56  |       })
  57  |     })
  58  |     const elapsed = Date.now() - started
  59  |     console.log(`69.4 second server: code=${code} elapsed=${elapsed}ms waitSeenAt=${sawWaitAt}ms output:\n${out}`)
  60  | 
  61  |     expect(out).toMatch(new RegExp(`wait[^\\n]*\\b${lock.pid}\\b`, 'i'))
  62  |     expect(code).not.toBe(0)
  63  |     expect(code).not.toBe(-999)
  64  |     expect(elapsed).toBeLessThan(8_000)
  65  |     const afterWait = out.slice(out.search(/wait/i))
  66  |     expect(afterWait.split('\n').slice(1).join('\n')).toContain(String(lock.pid))
  67  | 
  68  |     await page.goto(werk.url)
  69  |     await expect(map.locator('li')).toHaveCount(7)
  70  |     expect(await map.innerText()).toBe(before)
  71  |   })
  72  | })
  73  | 
  74  | test('69.2 A card added and accepted from the command line appears with no reload', async ({ page, werk }) => {
  75  |   werk.cli(['add', 'root', '--title', 'The root card'])
  76  |   werk.cli(['accept', 'root', '--actor', 'you'])
  77  |   await page.goto(werk.url)
  78  |   const map = page.getByRole('list', { name: 'map' })
  79  |   await expect(map.locator(`> ${card('root')}`)).toBeVisible()
  80  |   await expect(page.getByText('Use an append-only log')).toHaveCount(0)
  81  | 
  82  |   let navigations = 0
  83  |   page.on('framenavigated', (f) => {
  84  |     if (f === page.mainFrame()) navigations++
  85  |   })
  86  |   werk.cli(['add', 'alog', '--title', 'Use an append-only log', '--parent', 'root'])
  87  |   werk.cli(['accept', 'alog', '--actor', 'you'])
  88  | 
  89  |   const tile = map.locator(`> ${card('root')} > ul > ${card('alog')}`)
  90  |   await expect(tile.locator('> a')).toContainText('Use an append-only log', { timeout: 5_000 })
  91  |   await expect(tile).toHaveAttribute('data-proposed', 'false', { timeout: 5_000 })
  92  |   expect(navigations).toBe(0)
  93  | })
  94  | 
  95  | test('69.3 The open card survives a reload and has no control that edits its text', async ({ page, werk }) => {
  96  |   werk.cli(['add', 'root', '--title', 'The root card'])
  97  |   werk.cli(['add', 'kid', '--title', 'A child card', '--body', 'The body of the child.', '--parent', 'root'])
  98  |   werk.cli(['accept', 'kid', '--actor', 'you'])
  99  |   await page.goto(werk.url)
  100 |   await page.getByRole('list', { name: 'map' }).locator(`${card('kid')} > a`).click()
  101 | 
  102 |   await expect(page).toHaveURL(/#kid$/)
  103 |   const detail = page.getByTestId('card')
  104 |   await expect(detail).toHaveAttribute('data-card-id', 'kid')
  105 |   await expect(detail.getByRole('heading', { name: 'A child card' })).toBeVisible()
  106 |   await expect(detail).toContainText('The body of the child.')
  107 |   await expect(page.getByRole('textbox')).toHaveCount(0)
  108 |   await expect(page.locator('input, textarea, select, [contenteditable=""], [contenteditable="true"]')).toHaveCount(0)
  109 |   await expect(page.getByRole('button')).toHaveCount(0)
  110 | 
  111 |   await page.reload()
  112 |   await expect(page).toHaveURL(/#kid$/)
  113 |   await expect(page.getByTestId('card')).toHaveAttribute('data-card-id', 'kid')
  114 |   await expect(page.getByTestId('card').getByRole('heading', { name: 'A child card' })).toBeVisible()
  115 | })
  116 | 
  117 | async function payments(werk: Werk) {
  118 |   werk.cli(['add', 'payments', '--title', 'Payments'])
  119 |   werk.cli(['accept', 'payments', '--actor', 'you'])
  120 | }
  121 | 
  122 | test('70.1 A proposed card shows as a ghost under its proposed parent', async ({ page, werk }) => {
  123 |   await payments(werk)
  124 |   werk.cli(['add', 'refunds', '--title', 'Refunds', '--parent', 'payments'])
  125 |   await page.goto(werk.url)
  126 |   const map = page.getByRole('list', { name: 'map' })
  127 |   const ghost = map.locator(`> ${card('payments')} > ul > ${card('refunds')} > a`)
  128 |   await expect(ghost).toContainText('Refunds')
  129 |   await expect(ghost).toHaveCSS('border-top-style', 'dashed')
  130 |   await expect(ghost).toHaveCSS('color', GHOST_COLOR)
  131 |   const real = map.locator(`> ${card('payments')} > a`)
  132 |   await expect(real).not.toHaveCSS('border-top-style', 'dashed')
  133 |   await expect(real).not.toHaveCSS('color', GHOST_COLOR)
  134 | })
  135 | 
  136 | test('70.2 The person accepts one ghost with the ✓ button and it becomes real', async ({ page, werk }) => {
  137 |   await payments(werk)
  138 |   werk.cli(['add', 'refunds', '--title', 'Refunds', '--parent', 'payments'])
  139 |   await page.goto(werk.url)
  140 |   const map = page.getByRole('list', { name: 'map' })
  141 |   await expect(map.locator(`> ${card('payments')} > ul > ${card('refunds')} > a`)).toHaveCSS('border-top-style', 'dashed')
  142 | 
  143 |   await map.locator(`${card('refunds')} > a`).click()
  144 |   const before = logLines(werk).length
> 145 |   await page.getByRole('button', { name: '✓' }).click()
      |                                                 ^ Error: locator.click: Test timeout of 60000ms exceeded.
  146 |   await expect(page.getByRole('button', { name: '✓' })).toHaveCount(0)
  147 |   const lines = logLines(werk)
  148 |   expect(lines.length).toBe(before + 1)
  149 |   expect(lines.at(-1)).toMatchObject({ type: 'node.accepted', actor: 'you', payload: { id: 'refunds' } })
  150 | 
  151 |   await page.getByRole('link', { name: 'The map' }).click()
  152 |   const tile = map.locator(`> ${card('payments')} > ul > ${card('refunds')} > a`)
  153 |   await expect(tile).not.toHaveCSS('border-top-style', 'dashed')
  154 |   await expect(tile).not.toHaveCSS('color', GHOST_COLOR)
  155 | })
  156 | 
  157 | test('70.3 Accepting a ghost child under a ghost parent makes both real', async ({ page, werk }) => {
  158 |   await payments(werk)
  159 |   werk.cli(['add', 'refunds', '--title', 'Refunds', '--parent', 'payments'])
  160 |   werk.cli(['add', 'partial', '--title', 'Partial refunds', '--parent', 'refunds'])
  161 |   await page.goto(werk.url)
  162 |   const map = page.getByRole('list', { name: 'map' })
  163 |   await map.locator(`${card('partial')} > a`).click()
  164 |   await page.getByRole('button', { name: '✓' }).click()
  165 |   await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'false')
  166 | 
  167 |   await page.getByRole('link', { name: 'The map' }).click()
  168 |   const r = map.locator(`> ${card('payments')} > ul > ${card('refunds')}`)
  169 |   const p = r.locator(`> ul > ${card('partial')}`)
  170 |   await expect(p.locator('> a')).toContainText('Partial refunds')
  171 |   await expect(p.locator('> a')).not.toHaveCSS('border-top-style', 'dashed')
  172 |   await expect(p).toHaveAttribute('data-proposed', 'false')
  173 |   await expect(r.locator('> a')).not.toHaveCSS('border-top-style', 'dashed')
  174 |   await expect(r).toHaveAttribute('data-proposed', 'false')
  175 | })
  176 | 
  177 | test('70.4 An accept takes only the accepted card\'s branch, not other ghosts', async ({ page, werk }) => {
  178 |   await payments(werk)
  179 |   werk.cli(['add', 'refunds', '--title', 'Refunds', '--parent', 'payments'])
  180 |   werk.cli(['add', 'chargebacks', '--title', 'Chargebacks', '--parent', 'payments'])
  181 |   werk.cli(['add', 'opt', '--kind', 'option', '--title', 'Refund by store credit'])
  182 |   werk.cli(['link', 'opt', 'refunds', '--type', 'alternative_to'])
  183 |   werk.cli(['add', 'src', '--kind', 'source', '--title', 'Card network refund rules'])
  184 |   werk.cli(['link', 'refunds', 'src', '--type', 'supported_by'])
  185 |   await page.goto(werk.url)
  186 |   const map = page.getByRole('list', { name: 'map' })
  187 |   await expect(page.getByRole('button')).toHaveCount(0)
  188 |   await expect(page.getByRole('button', { name: /accept all|accept both/i })).toHaveCount(0)
  189 | 
  190 |   await map.locator(`${card('refunds')} > a`).click()
  191 |   await page.getByRole('button', { name: '✓' }).click()
  192 |   await expect(page.getByTestId('card')).toHaveAttribute('data-proposed', 'false')
  193 | 
  194 |   await page.getByRole('link', { name: 'The map' }).click()
  195 |   await expect(map.locator(card('refunds'))).toHaveAttribute('data-proposed', 'false')
  196 |   await expect(map.locator(`${card('refunds')} > a`)).not.toHaveCSS('border-top-style', 'dashed')
  197 |   await expect(map.locator(card('opt'))).toHaveAttribute('data-proposed', 'false')
  198 |   await expect(map.locator(`${card('opt')} > a`)).not.toHaveCSS('border-top-style', 'dashed')
  199 |   await expect(map.locator(card('src'))).toHaveAttribute('data-proposed', 'false')
  200 |   await expect(map.locator(`${card('src')} > a`)).not.toHaveCSS('border-top-style', 'dashed')
  201 |   const cb = map.locator(`${card('chargebacks')} > a`)
  202 |   await expect(cb).toHaveCSS('border-top-style', 'dashed')
  203 |   await expect(cb).toHaveCSS('color', GHOST_COLOR)
  204 |   await expect(page.getByRole('button')).toHaveCount(0)
  205 | })
  206 | 
  207 | test('70.5 A second view sees the accept because it reads the same log', async ({ page, werk }) => {
  208 |   await payments(werk)
  209 |   werk.cli(['add', 'refunds', '--title', 'Refunds', '--parent', 'payments'])
  210 |   await page.goto(werk.url)
  211 |   const second = await page.context().newPage()
  212 |   await second.goto(werk.url)
  213 |   const map1 = page.getByRole('list', { name: 'map' })
  214 |   const map2 = second.getByRole('list', { name: 'map' })
  215 |   await expect(map1.locator(`${card('refunds')} > a`)).toHaveCSS('border-top-style', 'dashed')
  216 |   await expect(map2.locator(`${card('refunds')} > a`)).toHaveCSS('border-top-style', 'dashed')
  217 | 
  218 |   await map1.locator(`${card('refunds')} > a`).click()
  219 |   await page.getByRole('button', { name: '✓' }).click()
  220 | 
  221 |   await expect(map2.locator(card('refunds'))).toHaveAttribute('data-proposed', 'false', { timeout: 5_000 })
  222 |   await expect(map2.locator(`${card('refunds')} > a`)).not.toHaveCSS('border-top-style', 'dashed')
  223 |   await second.close()
  224 | })
  225 | 
```