# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: .werk-heldout/g10/board.spec.ts >> 87.2 a ticket red on the merged tree goes back to building and the main line stays
- Location: .werk-heldout/g10/board.spec.ts:108:1

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: getByRole('region', { name: 'drawer' })
Timeout: 5000ms
- Expected substring  - 1
+ Received string     + 7

- MERGE-RED-MARK
+ log of the last session · no session runs now6:55:17 AMresult: success, $0.01ticket 2 · closeTicket two## What to build
+
+ The feature of ticket 2 works.
+
+ ## Acceptance criteria
+
+ - The feature works.columnbuildingcites#loopblocked bynoneretries0storiesnonetouchesmodule 2checksmake check

Call log:
  - Expect "toContainText" getByRole('region', { name: 'drawer' }) with timeout 5000ms
  - waiting for getByRole('region', { name: 'drawer' })
    14 × locator resolved to <section class="drawer" data-ticket="2" aria-label="drawer">…</section>
       - unexpected value "log of the last session · no session runs now6:55:17 AMresult: success, $0.01ticket 2 · closeTicket two## What to build

The feature of ticket 2 works.

## Acceptance criteria

- The feature works.columnbuildingcites#loopblocked bynoneretries0storiesnonetouchesmodule 2checksmake check"

```

```yaml
- region "drawer":
  - region "agent log":
    - paragraph: log of the last session · no session runs now
    - list:
      - listitem:
        - time: 6:55:17 AM
        - text: "result: success, $0.01"
  - article "slice":
    - paragraph:
      - text: ticket 2 ·
      - link "close":
        - /url: "#/board"
    - heading "Ticket two" [level=2]
    - text: "## What to build The feature of ticket 2 works. ## Acceptance criteria - The feature works."
  - complementary "metadata":
    - term: column
    - definition: building
    - term: cites
    - definition:
      - list "cited cards":
        - listitem:
          - link "#loop":
            - /url: "#loop"
    - term: blocked by
    - definition: none
    - term: retries
    - definition: "0"
    - term: stories
    - definition: none
    - term: touches
    - definition: module 2
    - term: checks
    - definition:
      - list "checks":
        - listitem:
          - code: make check
```

# Test source

```ts
  37  |   { type: 'node.proposed', payload: { id: 'root', kind: 'card', title: 'The root', status: 'decided' } },
  38  |   { type: 'node.proposed', payload: { id: 'loop', kind: 'card', title: 'The loop', status: 'decided', parent: 'root' } },
  39  |   { type: 'node.accepted', payload: { id: 'loop' } },
  40  | ]
  41  | 
  42  | /** The project as a plan run left it: a main line with the Makefile, a decided subtree, and the tickets in ready. */
  43  | function plan(werk: Werk, makefile: string, tickets: Ticket[], extra: (string | object)[] = []) {
  44  |   git(werk, 'rm', '-r', '-q', '--cached', '.werk')
  45  |   appendFileSync(join(werk.dir, '.git', 'info', 'exclude'), '.werk/\n')
  46  |   writeFileSync(join(werk.dir, 'Makefile'), makefile)
  47  |   git(werk, 'add', '-A')
  48  |   git(werk, 'commit', '-q', '-m', 'Add the check')
  49  |   writeFileSync(
  50  |     join(werk.dir, '.werk', 'log.jsonl'),
  51  |     LOG.map((e, i) => JSON.stringify({ ...e, seq: i + 1, at: '2026-10-21T00:00:00.000Z', actor: 'agent' })).join('\n') + '\n',
  52  |   )
  53  |   const lines = [
  54  |     ...tickets.map((t) => ({
  55  |       type: 'ticket.planned',
  56  |       payload: {
  57  |         cites: ['loop'],
  58  |         blockedBy: [],
  59  |         stories: [],
  60  |         checks: ['make check'],
  61  |         brief: `## What to build\n\nThe feature of ticket ${t.number} works.\n\n## Acceptance criteria\n\n- The feature works.`,
  62  |         root: 'root',
  63  |         ...t,
  64  |       },
  65  |     })),
  66  |     ...extra,
  67  |   ]
  68  |   writeFileSync(
  69  |     join(werk.dir, '.werk', 'board.jsonl'),
  70  |     lines.map((e, i) => JSON.stringify({ ...(e as object), seq: i + 1, at: '2026-10-21T00:00:00.000Z', actor: 'agent' })).join('\n') + '\n',
  71  |   )
  72  | }
  73  | 
  74  | const column = (page: Page, name: string) => page.locator(`section.column[data-column="${name}"]`)
  75  | const card = (page: Page, n: number) => page.locator(`li.ticket[data-ticket="${n}"]`)
  76  | 
  77  | test('87.1 two green tickets merge onto the main line one after the other', async ({ page, werk }) => {
  78  |   test.setTimeout(120_000)
  79  |   plan(werk, 'check:\n\t@true\n', [
  80  |     { number: 3, title: 'Ticket three', touches: ['module 3'] },
  81  |     { number: 4, title: 'Ticket four', touches: ['module 4'] },
  82  |   ])
  83  |   werk.scriptAgent({
  84  |     steps: [],
  85  |     roles: { ...judges(), builder: [writes('t3.txt'), writes('t4.txt')], 'heldout-author': author, 'heldout-binder': binder({ '3.1': 'true', '4.1': 'true' }) },
  86  |   })
  87  |   const before = git(werk, 'branch', '--format=%(refname:short)').split('\n')
  88  |   await page.goto(`${werk.url}#/board`)
  89  |   await page.getByRole('button', { name: 'Start the run of root' }).click()
  90  | 
  91  |   await expect(column(page, 'done').locator('li.ticket')).toHaveCount(2, { timeout: 90_000 })
  92  |   expect(movesOf(werk, 3)).toEqual(['building', 'merging', 'done'])
  93  |   expect(movesOf(werk, 4)).toEqual(['building', 'merging', 'done'])
  94  |   // The first ticket to reach done merged first on the main line.
  95  |   const doneOrder = boardLog(werk).flatMap((e) => (e.type === 'ticket.moved' && e.payload.to === 'done' ? [e.payload.number as number] : []))
  96  |   const merges = git(werk, 'log', '--first-parent', '--reverse', '--format=%s', 'main')
  97  |     .split('\n')
  98  |     .flatMap((s) => (/^werk: merge ticket (\d+) /.exec(s) ? [Number(/^werk: merge ticket (\d+) /.exec(s)![1])] : []))
  99  |   expect(merges).toEqual(doneOrder)
  100 |   // No new branch besides the main line and the ticket branches.
  101 |   const after = git(werk, 'branch', '--format=%(refname:short)').split('\n')
  102 |   const added = after.filter((b) => !before.includes(b))
  103 |   expect(added.every((b) => b.startsWith('werk-build/'))).toBe(true)
  104 |   expect(added).toHaveLength(2)
  105 |   await expect(page.locator('[data-badge="heldout"]')).toHaveCount(0)
  106 | })
  107 | 
  108 | test('87.2 a ticket red on the merged tree goes back to building and the main line stays', async ({ page, werk }) => {
  109 |   test.setTimeout(180_000)
  110 |   // Green on a branch, and red on the merge queue's detached tree when both tickets' files are there.
  111 |   const makefile = 'check:\n\t@if [ -f a.txt ] && [ -f b.txt ] && ! git symbolic-ref -q HEAD >/dev/null; then echo "MERGE-RED-MARK"; exit 1; fi\n'
  112 |   plan(werk, makefile, [
  113 |     { number: 1, title: 'Ticket one', touches: ['module 1'] },
  114 |     { number: 2, title: 'Ticket two', touches: ['module 2'] },
  115 |   ], [
  116 |     { type: 'ticket.moved', payload: { number: 1, to: 'building' } },
  117 |     { type: 'ticket.moved', payload: { number: 1, to: 'merging' } },
  118 |     { type: 'ticket.moved', payload: { number: 1, to: 'done' } },
  119 |   ])
  120 |   // The first ticket is already merged on the main line.
  121 |   writeFileSync(join(werk.dir, 'a.txt'), 'a\n')
  122 |   git(werk, 'add', 'a.txt')
  123 |   git(werk, 'commit', '-q', '-m', 'werk: merge ticket 1 (werk-build/one)')
  124 |   const tip = git(werk, 'rev-parse', 'main')
  125 |   werk.scriptAgent({ steps: [], roles: { ...judges(), builder: [writes('b.txt')], 'heldout-author': author, 'heldout-binder': binder({ '1.1': 'true', '2.1': 'true' }) } })
  126 | 
  127 |   await page.goto(`${werk.url}#/board`)
  128 |   await page.getByRole('button', { name: 'Start the run of root' }).click()
  129 |   await expect.poll(() => movesOf(werk, 2).join(','), { timeout: 60_000 }).toContain('merging,building')
  130 |   await expect(page.getByRole('button', { name: 'Start the run of root' })).toBeVisible({ timeout: 150_000 })
  131 |   await expect(card(page, 2)).toBeVisible()
  132 |   expect(git(werk, 'rev-parse', 'main')).toBe(tip)
  133 | 
  134 |   await card(page, 2).getByRole('link', { name: 'Ticket two' }).click()
  135 |   const drawer = page.getByRole('region', { name: 'drawer' })
  136 |   await expect(drawer).toContainText('make check')
> 137 |   await expect(drawer).toContainText('MERGE-RED-MARK')
      |                        ^ Error: expect(locator).toContainText(expected) failed
  138 | })
  139 | 
  140 | test('87.4 a red held-out step after a merge files a follow-up ticket and shows a badge on the done ticket', async ({ page, werk }) => {
  141 |   test.setTimeout(120_000)
  142 |   plan(werk, 'check:\n\t@true\n', [{ number: 3, title: 'Ticket three', touches: ['module 3'] }])
  143 |   // The follow-up's builder works for a long time, so the follow-up is not done during the test.
  144 |   werk.scriptAgent({
  145 |     steps: [],
  146 |     roles: {
  147 |       ...judges(),
  148 |       builder: [writes('t3.txt'), { steps: [{ sleep: 40_000 }, result({})] }],
  149 |       'heldout-author': author,
  150 |       'heldout-binder': binder({ '3.1': 'false' }),
  151 |     },
  152 |   })
  153 |   await page.goto(`${werk.url}#/board`)
  154 |   await page.getByRole('button', { name: 'Start the run of root' }).click()
  155 | 
  156 |   await expect(column(page, 'done').locator('li.ticket[data-ticket="3"]')).toBeVisible({ timeout: 90_000 })
  157 |   expect(git(werk, 'log', '--format=%s', 'main')).toMatch(/werk: merge ticket 3 /)
  158 |   // The follow-up appeared in ready, naming the failed step.
  159 |   const log = boardLog(werk)
  160 |   const filed = log.findIndex((e) => e.type === 'heldout.followup')
  161 |   expect(filed).toBeGreaterThan(-1)
  162 |   const followUp = log[filed]!.payload.number as number
  163 |   const planned = log.find((e) => e.type === 'ticket.planned' && e.payload.number === followUp)!
  164 |   expect(planned.payload.brief as string).toContain(STEP)
  165 |   expect(log.slice(0, filed + 1).some((e) => e.type === 'ticket.moved' && e.payload.number === followUp)).toBe(false)
  166 |   await expect(card(page, followUp)).toBeVisible()
  167 | 
  168 |   // The done ticket's card shows a held-out badge.
  169 |   const badge = card(page, 3).locator('[data-badge="heldout"]')
  170 |   await expect(badge).toBeVisible()
  171 |   // The drawer of the done ticket shows the same badge in its metadata.
  172 |   await card(page, 3).getByRole('link', { name: 'Ticket three' }).click()
  173 |   const drawer = page.getByRole('region', { name: 'drawer' })
  174 |   const drawerBadge = drawer.getByRole('complementary', { name: 'metadata' }).locator('[data-badge="heldout"]')
  175 |   await expect(drawerBadge).toBeVisible()
  176 |   await expect(drawerBadge).toHaveText(await badge.innerText())
  177 |   // A click on the badge opens the follow-up ticket.
  178 |   await drawerBadge.click()
  179 |   await expect(page).toHaveURL(new RegExp(`#/board/${followUp}$`))
  180 |   await expect(drawer).toHaveAttribute('data-ticket', String(followUp))
  181 |   await expect(drawer).toContainText('STEP-MARK')
  182 | })
  183 | 
  184 | test('88.1 nothing builds before the person starts the run', async ({ page, werk }) => {
  185 |   test.setTimeout(90_000)
  186 |   plan(werk, 'check:\n\t@true\n', [
  187 |     { number: 1, title: 'Ticket one', touches: ['module 1'] },
  188 |     { number: 2, title: 'Ticket two', touches: ['module 2'] },
  189 |     { number: 3, title: 'Ticket three', touches: ['module 3'] },
  190 |   ])
  191 |   werk.scriptAgent({ steps: [], roles: { ...judges(), builder: [{ steps: [{ sleep: 15_000 }, result({})] }], 'heldout-author': author } })
  192 |   await page.goto(`${werk.url}#/board`)
  193 |   await expect(column(page, 'ready').locator('li.ticket')).toHaveCount(3)
  194 |   // The person waits.
  195 |   await page.waitForTimeout(3000)
  196 |   await expect(column(page, 'ready').locator('li.ticket')).toHaveCount(3)
  197 |   await expect(column(page, 'building').locator('li.ticket')).toHaveCount(0)
  198 |   expect(werk.agentLaunches()).toEqual([])
  199 | 
  200 |   await page.getByRole('button', { name: 'Start the run of root' }).click()
  201 |   await expect(column(page, 'building').locator('li.ticket')).toHaveCount(3, { timeout: 30_000 })
  202 |   await expect(column(page, 'ready').locator('li.ticket')).toHaveCount(0)
  203 | })
  204 | 
```