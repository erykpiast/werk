# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: .werk-heldout/g-board/89-controls.spec.ts >> 89.4 a drag into building starts a ticket, and a drag back into ready stops it
- Location: .werk-heldout/g-board/89-controls.spec.ts:96:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('region', { name: 'ready', exact: true }).locator('li[data-ticket="2"]')
Expected: visible
Timeout: 10000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" getByRole('region', { name: 'ready', exact: true }).locator('li[data-ticket="2"]') with timeout 10000ms
  - waiting for getByRole('region', { name: 'ready', exact: true }).locator('li[data-ticket="2"]')

```

```yaml
- navigation "views":
  - link "Map":
    - /url: "#"
  - link "Board":
    - /url: "#/board"
- main:
  - heading "The board" [level=1]
  - list "plan runs":
    - listitem: the run of dr is active
  - alert: "werk: a build cannot be stopped in place; archive ticket 2 to end its build"
  - region "blocked":
    - heading "blocked 0" [level=2]
    - list
  - region "ready":
    - heading "ready 0" [level=2]
    - list
  - region "building":
    - heading "building 1" [level=2]
    - list:
      - listitem "a builder session runs now":
        - link "Eta":
          - /url: "#/board/2"
        - button "Archive ticket 2": 🗄
  - region "merging":
    - heading "merging 0" [level=2]
    - list
  - region "done":
    - heading "done 1" [level=2]
    - list:
      - listitem:
        - link "First":
          - /url: "#/board/1"
- complementary "chat":
  - list "transcript"
  - textbox "message":
    - /placeholder: Message the agent. Enter sends, Shift+Enter starts a new line.
  - tablist "conversations":
    - tab "the map" [selected]
  - button "Fork at the open card": +
  - button "New empty conversation": ∅
```

# Test source

```ts
  12  |     werk.dir,
  13  |     planned({ number: 1, title: 'Alpha', root: 'pr', touches: ['decision log'], checks: [MERGE_SLOW] }),
  14  |     planned({ number: 2, title: 'Beta', root: 'pr', touches: ['decision log'], checks: [MERGE_SLOW] }),
  15  |   )
  16  |   werk.scriptAgent({ steps: [], roles: { builder: [builderHolds(4_000, 'first.txt'), builderHolds(1_000, 'second.txt')], ...judgesAndHeldout([1, 2]) } })
  17  |   await openBoard(page, werk)
  18  |   try {
  19  |     await expect.poll(() => numbers(page, 'ready')).toEqual([1, 2])
  20  |     await page.waitForTimeout(3_000)
  21  |     await expect.poll(() => numbers(page, 'ready')).toEqual([1, 2])
  22  |     await expect(column(page, 'building').locator('li[data-ticket]')).toHaveCount(0)
  23  | 
  24  |     await ticket(page, 2).dragTo(ticket(page, 1))
  25  |     await expect.poll(() => numbers(page, 'ready')).toEqual([2, 1])
  26  |     await page.reload()
  27  |     await expect.poll(() => numbers(page, 'ready')).toEqual([2, 1])
  28  | 
  29  |     await page.getByRole('button', { name: /start the run of pr/i }).click()
  30  |     await expect(inColumn(page, 'building', 2)).toBeVisible({ timeout: 20_000 })
  31  |     await expect(inColumn(page, 'ready', 1)).toBeVisible()
  32  |     await expect(inColumn(page, 'done', 2)).toBeVisible({ timeout: 60_000 })
  33  |     const moves = boardEvents(werk.dir).filter((e) => e.type === 'ticket.moved').map((e) => `${e.payload.number}:${e.payload.to}`)
  34  |     expect(moves.slice(0, 3)).toEqual(['2:building', '2:merging', '2:done'])
  35  |     await expect.poll(() => boardEvents(werk.dir).some((e) => e.type === 'ticket.moved' && e.payload.number === 1 && e.payload.to === 'building'), { timeout: 30_000 }).toBe(true)
  36  |     const all = boardEvents(werk.dir).filter((e) => e.type === 'ticket.moved').map((e) => `${e.payload.number}:${e.payload.to}`)
  37  |     expect(all.indexOf('1:building')).toBeGreaterThan(all.indexOf('2:done'))
  38  |   } finally {
  39  |     killRuns(werk)
  40  |   }
  41  | })
  42  | 
  43  | test('89.2 a person archives a ready ticket and restores it', async ({ page, werk }) => {
  44  |   replaceBoard(
  45  |     werk.dir,
  46  |     planned({ number: 1, title: 'Gamma' }),
  47  |     planned({ number: 2, title: 'Delta' }),
  48  |     planned({ number: 3, title: 'Epsilon' }),
  49  |     moved(2, 'blocked', 'blocked_by: waits on something'),
  50  |     moved(3, 'building'),
  51  |   )
  52  |   await openBoard(page, werk)
  53  |   await expect(inColumn(page, 'ready', 1)).toBeVisible()
  54  |   await expect(inColumn(page, 'blocked', 2)).toBeVisible()
  55  |   await expect(inColumn(page, 'building', 3)).toBeVisible()
  56  |   await expect(ticket(page, 1).getByRole('button', { name: /archive/i })).toBeVisible()
  57  |   await expect(ticket(page, 2).getByRole('button', { name: /archive/i })).toBeVisible()
  58  |   // The step: Epsilon, a building ticket, shows no archive action.
  59  |   await expect.soft(ticket(page, 3).getByRole('button', { name: /archive/i })).toHaveCount(0)
  60  | 
  61  |   await ticket(page, 1).getByRole('button', { name: /archive/i }).click()
  62  |   const dialog = page.getByRole('alertdialog')
  63  |   await expect(dialog).toContainText(/restore/i)
  64  |   await dialog.getByRole('button', { name: 'Archive' }).click()
  65  |   await expect(ticket(page, 1)).toHaveCount(0)
  66  |   await page.reload()
  67  |   await expect(inColumn(page, 'ready', 2).or(inColumn(page, 'blocked', 2))).toBeVisible()
  68  |   await expect(ticket(page, 1)).toHaveCount(0)
  69  |   werk.cli(['ticket', 'restore', '1'])
  70  |   await expect(inColumn(page, 'ready', 1)).toBeVisible()
  71  |   await expect(ticket(page, 1)).toContainText('Gamma')
  72  | })
  73  | 
  74  | test('89.3 the trigger icon starts a ready ticket early, and it goes through the merge queue', async ({ page, werk }) => {
  75  |   test.setTimeout(120_000)
  76  |   replaceBoard(
  77  |     werk.dir,
  78  |     planned({ number: 1, title: 'First', root: 'tr', checks: [MERGE_SLOW] }),
  79  |     planned({ number: 2, title: 'Zeta', root: 'tr', checks: [MERGE_SLOW] }),
  80  |   )
  81  |   werk.scriptAgent({ steps: [], roles: { builder: [builderHolds(5_000, 'first.txt'), builderHolds(1_000, 'zeta.txt')], ...judgesAndHeldout([1, 2]) } })
  82  |   await openBoard(page, werk)
  83  |   try {
  84  |     werk.start(['run', 'tr', '--parallel', '1', '--poll-every', '100'])
  85  |     await expect(inColumn(page, 'building', 1)).toBeVisible({ timeout: 20_000 })
  86  |     await expect(inColumn(page, 'ready', 2)).toBeVisible()
  87  |     await ticket(page, 2).getByRole('button', { name: /trigger/i }).click()
  88  |     await expect(inColumn(page, 'building', 2)).toBeVisible({ timeout: 10_000 })
  89  |     await expect(inColumn(page, 'merging', 2)).toBeVisible({ timeout: 60_000 })
  90  |     await expect(inColumn(page, 'done', 2)).toBeVisible({ timeout: 30_000 })
  91  |   } finally {
  92  |     killRuns(werk)
  93  |   }
  94  | })
  95  | 
  96  | test('89.4 a drag into building starts a ticket, and a drag back into ready stops it', async ({ page, werk }) => {
  97  |   test.setTimeout(120_000)
  98  |   replaceBoard(werk.dir, planned({ number: 1, title: 'First', root: 'dr' }), planned({ number: 2, title: 'Eta', root: 'dr' }))
  99  |   werk.scriptAgent({
  100 |     steps: [],
  101 |     roles: { builder: [builderHolds(4_000, 'first.txt'), { steps: [said('Eta builds.'), { waitFor: join(werk.dir, '..', 'never') }] }], ...judgesAndHeldout([1, 2]) },
  102 |   })
  103 |   await openBoard(page, werk)
  104 |   try {
  105 |     werk.start(['run', 'dr', '--parallel', '1', '--poll-every', '100'])
  106 |     await expect(inColumn(page, 'building', 1)).toBeVisible({ timeout: 20_000 })
  107 |     await ticket(page, 2).dragTo(column(page, 'building'))
  108 |     await expect(inColumn(page, 'building', 2)).toBeVisible({ timeout: 10_000 })
  109 |     await expect(ticket(page, 2)).toHaveAttribute('data-live', 'true', { timeout: 60_000 })
  110 | 
  111 |     await ticket(page, 2).dragTo(column(page, 'ready'))
> 112 |     await expect(inColumn(page, 'ready', 2)).toBeVisible({ timeout: 10_000 })
      |                                              ^ Error: expect(locator).toBeVisible() failed
  113 |     await expect(ticket(page, 2)).not.toHaveAttribute('data-live', /.*/)
  114 |     await page.waitForTimeout(3_000)
  115 |     expect(boardEvents(werk.dir).some((e) => e.type === 'ticket.moved' && e.payload.number === 2 && e.payload.to === 'merging')).toBe(false)
  116 |     await page.reload()
  117 |     await expect(inColumn(page, 'ready', 2)).toBeVisible()
  118 |   } finally {
  119 |     killRuns(werk)
  120 |   }
  121 | })
  122 | 
  123 | test('89.5 the board refuses every other manual move and has no edit control', async ({ page, werk }) => {
  124 |   replaceBoard(
  125 |     werk.dir,
  126 |     planned({ number: 1, title: 'Theta', root: 'mv' }),
  127 |     planned({ number: 2, title: 'Iota', root: 'mv' }),
  128 |     planned({ number: 3, title: 'Kappa', root: 'mv' }),
  129 |     moved(2, 'blocked', 'blocked_by: waits'),
  130 |     moved(3, 'building'),
  131 |   )
  132 |   // An active run of mv: this test's process stands in for the merge loop.
  133 |   appendBoard(werk.dir, { type: 'run.started', payload: { root: 'mv', pid: process.pid } })
  134 |   await openBoard(page, werk)
  135 |   await expect(page.getByRole('list', { name: 'plan runs' })).toContainText('active')
  136 | 
  137 |   await ticket(page, 1).dragTo(column(page, 'merging'))
  138 |   await expect(page.getByRole('alert')).toBeVisible()
  139 |   await expect(inColumn(page, 'ready', 1)).toBeVisible()
  140 |   await expect(inColumn(page, 'merging', 1)).toHaveCount(0)
  141 | 
  142 |   await ticket(page, 3).dragTo(column(page, 'done'))
  143 |   await expect(page.getByRole('alert')).toContainText('done')
  144 |   await expect(inColumn(page, 'building', 3)).toBeVisible()
  145 |   await expect(inColumn(page, 'done', 3)).toHaveCount(0)
  146 | 
  147 |   await ticket(page, 2).dragTo(column(page, 'building'))
  148 |   await page.waitForTimeout(1_000)
  149 |   await expect(inColumn(page, 'blocked', 2)).toBeVisible()
  150 |   await expect(inColumn(page, 'building', 2)).toHaveCount(0)
  151 | 
  152 |   const views = page.locator('.views-pane')
  153 |   await expect(views.getByRole('textbox')).toHaveCount(0)
  154 |   await expect(views.locator('[contenteditable]')).toHaveCount(0)
  155 |   await expect(views.getByRole('button', { name: /edit/i })).toHaveCount(0)
  156 | })
  157 | 
```