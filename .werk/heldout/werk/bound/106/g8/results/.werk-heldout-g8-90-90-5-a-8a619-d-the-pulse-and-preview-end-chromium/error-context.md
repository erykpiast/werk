# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: .werk-heldout/g8/90.spec.ts >> 90.5 a person stops the build by hand and the pulse and preview end
- Location: .werk-heldout/g8/90.spec.ts:130:1

# Error details

```
Error: expect(locator).not.toHaveAttribute(expected) failed

Locator:  locator('li[data-ticket="1"]')
Expected: not "true"
Received: "true"
Timeout:  5000ms

Call log:
  - Expect "soft not toHaveAttribute" locator('li[data-ticket="1"]') with timeout 5000ms
  - waiting for locator('li[data-ticket="1"]')
    14 × locator resolved to <li class="ticket" data-ticket="1" data-live="true" draggable="true" title="a builder session runs now">…</li>
       - unexpected value "true"

```

```yaml
- listitem "a builder session runs now":
  - link "Stop me":
    - /url: "#/board/1"
  - button "Archive ticket 1": 🗄
```

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('region', { name: 'ready', exact: true }).locator('li[data-ticket="1"]')
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "soft toBeVisible" getByRole('region', { name: 'ready', exact: true }).locator('li[data-ticket="1"]') with timeout 5000ms
  - waiting for getByRole('region', { name: 'ready', exact: true }).locator('li[data-ticket="1"]')

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
    - listitem:
      - button "Start the run of werk"
  - alert: "werk: a build cannot be stopped in place; archive ticket 1 to end its build"
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
        - link "Stop me":
          - /url: "#/board/1"
        - button "Archive ticket 1": 🗄
  - region "merging":
    - heading "merging 0" [level=2]
    - list
  - region "done":
    - heading "done 0" [level=2]
    - list
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
  45  | 
  46  |     const log = drawer.getByRole('region', { name: 'agent log' })
  47  |     await expect(log).toBeVisible()
  48  |     const slice = drawer.getByRole('article', { name: 'slice' })
  49  |     expect((await log.boundingBox())!.y).toBeLessThan((await slice.boundingBox())!.y)
  50  | 
  51  |     const lines = log.getByRole('listitem')
  52  |     await expect(lines.first()).toContainText('event 1')
  53  |     const height = (await log.boundingBox())!.height
  54  |     const count = await lines.count()
  55  |     // The next event comes with no reload.
  56  |     await expect.poll(() => lines.count(), { timeout: 5_000 }).toBeGreaterThan(count)
  57  |     await expect(log).toContainText(`event ${count + 1}`)
  58  | 
  59  |     // Many events later, the log is the same height and its content scrolls.
  60  |     await expect(log).toContainText('event 14', { timeout: 20_000 })
  61  |     expect((await log.boundingBox())!.height).toBe(height)
  62  |     const viewport = log.locator('ol')
  63  |     const { scrollHeight, clientHeight } = await viewport.evaluate((el) => ({ scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }))
  64  |     expect(scrollHeight).toBeGreaterThan(clientHeight)
  65  |   } finally {
  66  |     await release(werk, [])
  67  |   }
  68  | })
  69  | 
  70  | test('90.3 the log preview is gone after the ticket moves to merging', async ({ page, werk }) => {
  71  |   const exit = gate(werk, 'exit')
  72  |   const merge = gate(werk, 'merge')
  73  |   try {
  74  |     // The check waits for a gate on the merge queue's tree (a detached HEAD), so merging lasts until the test opens it.
  75  |     board(werk, [{ number: 1, title: 'Merge me' }], [], `\t@if ! git symbolic-ref -q HEAD >/dev/null; then while [ ! -f ${merge} ]; do sleep 0.2; done; fi`)
  76  |     werk.scriptAgent({ steps: [], roles: { ...judges(), builder: { steps: [said('Working.'), { waitFor: exit }, { edit: { path: 'a.txt', content: 'a\n' } }, ...reply().steps] } } })
  77  |     await openBoard(page)
  78  |     werk.start(['run', 'werk'])
  79  |     await expect(inColumn(page, 'building', 1)).toHaveAttribute('data-live', 'true', { timeout: 20_000 })
  80  |     await inColumn(page, 'building', 1).getByRole('link').click()
  81  |     const drawer = page.getByRole('region', { name: 'drawer' })
  82  |     await expect(drawer.getByRole('region', { name: 'agent log' })).toBeVisible()
  83  | 
  84  |     open(exit)
  85  |     await expect(inColumn(page, 'merging', 1)).toBeVisible({ timeout: 60_000 })
  86  |     await expect(ticket(page, 1)).not.toHaveAttribute('data-live', 'true')
  87  |     await expect(drawer).toHaveAttribute('data-ticket', '1')
  88  |     await expect(drawer.getByRole('article', { name: 'slice' })).toBeVisible()
  89  |     await expect(drawer.getByRole('complementary', { name: 'metadata' })).toBeVisible()
  90  |     await expect(drawer.getByRole('region', { name: 'agent log' })).toHaveCount(0)
  91  |   } finally {
  92  |     await release(werk, [exit, merge])
  93  |   }
  94  | })
  95  | 
  96  | test('90.4 a failed attempt stops the pulse while the ticket waits for its retry', async ({ page, werk }) => {
  97  |   const first = gate(werk, 'first')
  98  |   const checks = gate(werk, 'checks')
  99  |   const second = gate(werk, 'second')
  100 |   try {
  101 |     // The check waits for a gate, then passes only when the second pass wrote ok.txt.
  102 |     board(werk, [{ number: 1, title: 'Retry me' }], [], `\t@while [ ! -f ${checks} ]; do sleep 0.2; done; test -f ok.txt`)
  103 |     werk.scriptAgent({
  104 |       steps: [],
  105 |       roles: {
  106 |         ...judges(),
  107 |         builder: [
  108 |           { steps: [said('First pass.'), { waitFor: first }, { event: { type: 'result', subtype: 'error_during_execution', is_error: true } }], exit: 1 },
  109 |           { steps: [said('Second pass.'), { waitFor: second }, { edit: { path: 'ok.txt', content: 'ok\n' } }, ...reply().steps] },
  110 |         ],
  111 |       },
  112 |     })
  113 |     await openBoard(page)
  114 |     werk.start(['build', '1', '--cap', '2'])
  115 |     await expect(inColumn(page, 'building', 1)).toBeVisible({ timeout: 20_000 })
  116 |     await expect(ticket(page, 1)).toHaveAttribute('data-live', 'true')
  117 | 
  118 |     open(first)
  119 |     await expect(ticket(page, 1)).not.toHaveAttribute('data-live', 'true', { timeout: 20_000 })
  120 |     await expect(inColumn(page, 'building', 1)).toBeVisible()
  121 |     await page.waitForTimeout(1_000)
  122 |     await expect(inColumn(page, 'building', 1)).toBeVisible()
  123 |     await expect(ticket(page, 1)).not.toHaveAttribute('data-live', 'true')
  124 |     expect(movesOf(werk, 1)).toEqual(['building'])
  125 |   } finally {
  126 |     await release(werk, [first, checks, second])
  127 |   }
  128 | })
  129 | 
  130 | test('90.5 a person stops the build by hand and the pulse and preview end', async ({ page, werk }) => {
  131 |   const never = gate(werk, 'never')
  132 |   try {
  133 |     board(werk, [{ number: 1, title: 'Stop me' }])
  134 |     werk.scriptAgent({ steps: [], roles: { ...judges(), builder: { steps: [said('Working.'), { waitFor: never }, ...reply().steps] } } })
  135 |     await openBoard(page)
  136 |     werk.start(['build', '1', '--cap', '1'])
  137 |     await expect(inColumn(page, 'building', 1)).toBeVisible({ timeout: 20_000 })
  138 |     await expect(ticket(page, 1)).toHaveAttribute('data-live', 'true')
  139 | 
  140 |     // The person stops the build by hand: a drag of the card back to ready.
  141 |     await ticket(page, 1).dragTo(column(page, 'ready'))
  142 |     const alert = page.getByRole('alert')
  143 |     if (await alert.count()) console.log(`90.5 alert: ${await alert.textContent()}`)
  144 |     await expect.soft(ticket(page, 1)).not.toHaveAttribute('data-live', 'true')
> 145 |     await expect.soft(inColumn(page, 'ready', 1)).toBeVisible()
      |                                                   ^ Error: expect(locator).toBeVisible() failed
  146 |     await ticket(page, 1).getByRole('link').click()
  147 |     await expect.soft(page.getByRole('region', { name: 'drawer' }).getByRole('region', { name: 'agent log' })).toHaveCount(0)
  148 |   } finally {
  149 |     await release(werk, [never])
  150 |   }
  151 | })
  152 | 
```