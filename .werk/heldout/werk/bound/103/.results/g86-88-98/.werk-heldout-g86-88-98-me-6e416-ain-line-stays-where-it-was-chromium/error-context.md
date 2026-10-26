# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: .werk-heldout/g86-88-98/merge.spec.ts >> 87.2 a ticket red on the merged tree goes back to building and the main line stays where it was
- Location: .werk-heldout/g86-88-98/merge.spec.ts:85:1

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: getByRole('region', { name: 'drawer' })
Timeout: 5000ms
- Expected substring  - 1
+ Received string     + 7

- BOTH-FILES-RED
+ log of the last session · no session runs now7:30:16 AMresult: success, $0.01ticket 1 · closeTicket 1## What to build
+
+ The feature works.
+
+ ## Acceptance criteria
+
+ - The feature works.columnbuildingcites#loopblocked bynoneretries0storiesnonetouchesmodule 1checksmake check

Call log:
  - Expect "toContainText" getByRole('region', { name: 'drawer' }) with timeout 5000ms
  - waiting for getByRole('region', { name: 'drawer' })
    14 × locator resolved to <section class="drawer" data-ticket="1" aria-label="drawer">…</section>
       - unexpected value "log of the last session · no session runs now7:30:16 AMresult: success, $0.01ticket 1 · closeTicket 1## What to build

The feature works.

## Acceptance criteria

- The feature works.columnbuildingcites#loopblocked bynoneretries0storiesnonetouchesmodule 1checksmake check"

```

```yaml
- region "drawer":
  - region "agent log":
    - paragraph: log of the last session · no session runs now
    - list:
      - listitem:
        - time: 7:30:16 AM
        - text: "result: success, $0.01"
  - article "slice":
    - paragraph:
      - text: ticket 1 ·
      - link "close":
        - /url: "#/board"
    - heading "Ticket 1" [level=2]
    - text: "## What to build The feature works. ## Acceptance criteria - The feature works."
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
    - definition: module 1
    - term: checks
    - definition:
      - list "checks":
        - listitem:
          - code: make check
```

# Test source

```ts
  7   | import { accepted, logOf, proposed } from '../../src/test/map-events.ts'
  8   | import { expect, test, type Werk } from '../../e2e/harness.ts'
  9   | 
  10  | const reply = (object: unknown): FakeReply => ({
  11  |   steps: [{ event: { type: 'result', subtype: 'success', total_cost_usd: 0.01, num_turns: 1, result: `Done.\n${JSON.stringify(object)}` } }],
  12  | })
  13  | const writes = (path: string, pre: FakeReply['steps'] = []): FakeReply => ({ steps: [...pre, { edit: { path, content: `${path}\n` } }, ...reply({}).steps] })
  14  | const judges = {
  15  |   grader: reply({ lines: ['ac-1', '#loop'].map((id) => ({ id, score: 4, gap: 'none' })) }),
  16  |   ...Object.fromEntries(['design', 'maintainability', 'tests', 'security', 'performance'].map((a) => [`reviewer-${a}`, reply({ findings: [] })])),
  17  | }
  18  | const STEP = 'Given the product is installed\nWhen the user opens the feature\nThen the user sees STEP-MARK'
  19  | const author = reply({ steps: [{ text: STEP }] })
  20  | const binder = (bindings: Record<string, string>): FakeReply => reply({ steps: Object.entries(bindings).map(([id, cmd]) => ({ id, cmd })) })
  21  | 
  22  | const ticket = (number: number, extra: object = {}) => ({
  23  |   number,
  24  |   title: `Ticket ${number}`,
  25  |   cites: ['loop'],
  26  |   blockedBy: [],
  27  |   stories: [],
  28  |   touches: [`module ${number}`],
  29  |   checks: ['make check'],
  30  |   brief: '## What to build\n\nThe feature works.\n\n## Acceptance criteria\n\n- The feature works.',
  31  |   root: 'root',
  32  |   ...extra,
  33  | })
  34  | 
  35  | function setup(werk: Werk, makefile: string, tickets: number[]) {
  36  |   const git = (...args: string[]) => {
  37  |     const r = spawnSync('git', args, { cwd: werk.dir, encoding: 'utf8' })
  38  |     return r.stdout.trim()
  39  |   }
  40  |   writeFileSync(join(werk.dir, 'Makefile'), makefile)
  41  |   const log = logOf(proposed('root', { status: 'decided' }), proposed('loop', { status: 'decided', parent: 'root' }), accepted('loop'))
  42  |   writeFileSync(join(werk.dir, '.werk', 'log.jsonl'), log.map((e) => JSON.stringify(e)).join('\n') + '\n')
  43  |   writeFileSync(
  44  |     join(werk.dir, '.werk', 'board.jsonl'),
  45  |     tickets.map((n, i) => JSON.stringify({ type: 'ticket.planned', payload: ticket(n), seq: i + 1, at: new Date().toISOString(), actor: 'agent' })).join('\n') + '\n',
  46  |   )
  47  |   git('add', '-A')
  48  |   git('commit', '--quiet', '-m', 'the check and a plan')
  49  |   const events = () =>
  50  |     readFileSync(join(werk.dir, '.werk', 'board.jsonl'), 'utf8')
  51  |       .split('\n')
  52  |       .filter(Boolean)
  53  |       .map((l) => JSON.parse(l) as { type: string; payload: { number?: number; to?: string } })
  54  |   const movesOf = (n: number) => events().flatMap((e) => (e.type === 'ticket.moved' && e.payload.number === n ? [e.payload.to] : []))
  55  |   return { git, events, movesOf }
  56  | }
  57  | 
  58  | const openBoard = async (page: Page, werk: Werk) => {
  59  |   await page.goto(werk.url)
  60  |   await page.getByRole('navigation', { name: 'views' }).getByRole('link', { name: 'Board' }).click()
  61  | }
  62  | const card = (page: Page, n: number) => page.locator(`li[data-ticket="${n}"]`)
  63  | const column = (page: Page, name: string) => page.getByRole('region', { name, exact: true })
  64  | 
  65  | test('87.1 two green tickets merge onto the main line one after the other', async ({ page, werk }) => {
  66  |   test.setTimeout(120_000)
  67  |   const s = setup(werk, 'check:\n\t@true\n', [1, 2])
  68  |   werk.scriptAgent({ steps: [], roles: { ...judges, builder: [writes('t1.txt'), writes('t2.txt')], 'heldout-author': author, 'heldout-binder': binder({ '1.1': 'true', '2.1': 'true' }) } })
  69  |   const branchesBefore = s.git('branch', '--format=%(refname:short)').split('\n')
  70  |   await openBoard(page, werk)
  71  |   const code = await werk.start(['run', 'root']).exited
  72  |   expect(code).toBe(0)
  73  |   expect(s.movesOf(1)).toEqual(['building', 'merging', 'done'])
  74  |   expect(s.movesOf(2)).toEqual(['building', 'merging', 'done'])
  75  |   const merges = s.git('log', '--first-parent', '--reverse', '--format=%s', 'main').split('\n').filter((l) => l.startsWith('werk: merge'))
  76  |   expect(merges).toHaveLength(2)
  77  |   const branches = s.git('branch', '--format=%(refname:short)').split('\n')
  78  |   const added = branches.filter((b) => !branchesBefore.includes(b))
  79  |   expect(added.every((b) => b.startsWith('werk-build/'))).toBe(true)
  80  |   expect(added).toHaveLength(2)
  81  |   await expect(column(page, 'done').locator('li[data-ticket]')).toHaveCount(2)
  82  |   await expect(page.locator('[data-badge="heldout"]')).toHaveCount(0)
  83  | })
  84  | 
  85  | test('87.2 a ticket red on the merged tree goes back to building and the main line stays where it was', async ({ page, werk }) => {
  86  |   test.setTimeout(120_000)
  87  |   // Red when both a.txt and b.txt are there: each ticket alone is green, both together are red.
  88  |   const s = setup(werk, 'check:\n\t@if test -f a.txt && test -f b.txt; then echo "BOTH-FILES-RED"; exit 1; fi\n', [1, 2])
  89  |   werk.scriptAgent({
  90  |     steps: [],
  91  |     roles: { ...judges, builder: [writes('a.txt'), writes('b.txt', [{ sleep: 4000 }])], 'heldout-author': author, 'heldout-binder': binder({ '1.1': 'true', '2.1': 'true' }) },
  92  |   })
  93  |   const code = await werk.start(['run', 'root', '--cap', '1']).exited
  94  |   expect(code).not.toBe(0)
  95  |   // The builds run at the same time, so either ticket may merge first: the other is the second ticket.
  96  |   const first = s.movesOf(1).at(-1) === 'done' ? 1 : 2
  97  |   const second = first === 1 ? 2 : 1
  98  |   expect(s.movesOf(first)).toEqual(['building', 'merging', 'done'])
  99  |   expect(s.movesOf(second)).toEqual(['building', 'merging', 'building'])
  100 |   // The main line tip is the merge of the first ticket: the tip before the second reached merging.
  101 |   expect(s.git('log', '-1', '--format=%s', 'main')).toMatch(new RegExp(`^werk: merge ticket ${first}`))
  102 |   await openBoard(page, werk)
  103 |   await expect(column(page, 'building').locator(`li[data-ticket="${second}"]`)).toBeVisible()
  104 |   await card(page, second).getByRole('link').first().click()
  105 |   const drawer = page.getByRole('region', { name: 'drawer' })
  106 |   await expect(drawer).toContainText('make check')
> 107 |   await expect(drawer).toContainText('BOTH-FILES-RED', { timeout: 5000 })
      |                        ^ Error: expect(locator).toContainText(expected) failed
  108 | })
  109 | 
  110 | test('87.4 a red held-out step after a merge files a follow-up ticket and shows a badge on the done ticket', async ({ page, werk }) => {
  111 |   test.setTimeout(120_000)
  112 |   const s = setup(werk, 'check:\n\t@true\n', [1])
  113 |   // The held-out step of ticket 1 is red on the first run; the follow-up's builder makes it green.
  114 |   werk.scriptAgent({
  115 |     steps: [],
  116 |     roles: { ...judges, builder: [writes('t1.txt'), { steps: [{ sleep: 60_000 }] }], 'heldout-author': author, 'heldout-binder': [binder({ '1.1': 'false' })] },
  117 |   })
  118 |   const run = werk.start(['run', 'root', '--poll-every', '50'])
  119 |   await expect.poll(() => s.events().some((e) => e.type === 'heldout.followup'), { timeout: 60_000 }).toBe(true)
  120 |   expect(s.movesOf(1)).toEqual(['building', 'merging', 'done'])
  121 |   expect(s.git('log', '--first-parent', '--format=%s', 'main')).toMatch(/werk: merge ticket 1/)
  122 |   const followup = s.events().find((e) => e.type === 'heldout.followup')!.payload as unknown as { number: number; steps: string[] }
  123 |   expect(followup.steps).toContain('1.1')
  124 |   await openBoard(page, werk)
  125 |   const fresh = card(page, followup.number)
  126 |   await expect(fresh).toBeVisible()
  127 |   // The follow-up names the failed step (its title, or its drawer).
  128 |   await fresh.getByRole('link').first().click()
  129 |   await expect(page.getByRole('region', { name: 'drawer' })).toContainText(/1\.1|STEP-MARK/)
  130 |   await openBoard(page, werk)
  131 |   await expect(card(page, 1).locator('[data-badge="heldout"]')).toBeVisible()
  132 |   await card(page, 1).getByRole('link').first().click()
  133 |   const metadata = page.getByRole('region', { name: 'drawer' }).getByRole('complementary', { name: 'metadata' })
  134 |   const badge = metadata.locator('[data-badge="heldout"]')
  135 |   await expect(badge).toBeVisible()
  136 |   await badge.click()
  137 |   await expect(page.getByRole('region', { name: 'drawer' })).toHaveAttribute('data-ticket', String(followup.number))
  138 |   void run
  139 | })
  140 | 
```