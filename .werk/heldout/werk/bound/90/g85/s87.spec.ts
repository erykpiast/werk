/** Held-out steps 87.2 and 87.4: the merge loop, seen on the board. */
import { expect, test } from '../../e2e/harness.ts'
import type { FakeReply } from '../../src/test/fake-agent.ts'
import { boardEvents, gate, git, inColumn, judges, open, planRun, reply, result, said, ticket, ticketOf } from './browser.ts'

test.setTimeout(120_000)

const writes = (path: string, extra: FakeReply['steps'] = []): FakeReply => ({ steps: [...extra, { edit: { path, content: `${path}\n` } }, result] })

test('87.2 a ticket that is red on the merged tree goes back to building and the main line stays where it was', async ({ page, werk }) => {
  // Green alone, red when a.txt and b.txt are both in the tree.
  const check = 'if test -f a.txt && test -f b.txt; then echo "BOTH-FILES-$(echo RED)-MARK"; exit 1; fi'
  await planRun(page, werk, [ticketOf(3, { checks: [check] }), ticketOf(4, { checks: [check] })])
  werk.scriptAgent({
    steps: [],
    roles: {
      ...judges(),
      'heldout-author': reply({ steps: [] }),
      // The first launch merges first. The second waits, so its build starts from the same tip.
      builder: [writes('a.txt'), writes('b.txt', [{ sleep: 3000 }])],
    },
  })
  const run = werk.start(['run', 'root', '--cap', '2'])
  await run.exited
  const events = boardEvents(werk)
  const moves = (n: number) => events.flatMap((e) => (e.type === 'ticket.moved' && e.payload.number === n ? [e.payload.to] : []))
  const second = [3, 4].find((n) => moves(n).includes('done')) === 3 ? 4 : 3
  const m = moves(second)
  const at = m.indexOf('merging')
  expect(at).toBeGreaterThanOrEqual(0)
  expect(m[at + 1]).toBe('building')
  // The main line tip is the merge of the first ticket.
  const tip = git(werk, 'rev-parse', 'main')
  expect(git(werk, 'log', '-1', '--format=%s', tip)).toContain(`merge ticket ${second === 4 ? 3 : 4}`)

  await expect(inColumn(page, 'building', second)).toBeVisible()
  await ticket(page, second).getByRole('link').click()
  const drawer = page.getByRole('region', { name: 'drawer' })
  await expect(drawer).toBeVisible()
  await expect(drawer).toContainText(check)
  await expect(drawer).toContainText('BOTH-FILES-RED-MARK')
})

test('87.4 a red held-out step after a merge files a follow-up ticket and shows a badge on the done ticket', async ({ page, werk }) => {
  const STEP = 'Given the product is installed\nWhen the user opens the feature\nThen the user sees FOLLOW-STEP-MARK'
  await planRun(page, werk, [ticketOf(3)])
  werk.scriptAgent({
    steps: [],
    roles: {
      ...judges(),
      'heldout-author': reply({ steps: [{ text: STEP }] }),
      'heldout-binder': reply({ steps: [{ id: '3.1', cmd: 'false' }] }),
      // The follow-up's build waits, so the person can look at the board.
      builder: [writes('t3.txt'), { steps: [said('Follow-up.'), { waitFor: gate(werk, 'hold') }, result] }],
    },
  })
  werk.start(['run', 'root'])
  await expect(inColumn(page, 'done', 3)).toBeVisible({ timeout: 30_000 })
  expect(git(werk, 'log', '--first-parent', '--format=%s', 'main')).toContain('werk: merge ticket 3 ')
  await expect.poll(() => boardEvents(werk).some((e) => e.type === 'heldout.followup'), { timeout: 30_000 }).toBe(true)
  const events = boardEvents(werk)
  const follow = events.find((e) => e.type === 'heldout.followup')!.payload as { after: number; number: number }
  expect(follow.after).toBe(3)
  const planned = events.find((e) => e.type === 'ticket.planned' && e.payload.number === follow.number)!.payload as { brief: string }
  expect(planned.brief).toContain('FOLLOW-STEP-MARK')
  // The follow-up joined the board in ready: no move came before its planned event.
  await expect(ticket(page, follow.number)).toBeVisible()

  const badge = ticket(page, 3).locator('[data-badge="heldout"]')
  await expect(badge).toBeVisible()
  await ticket(page, 3).getByRole('link').first().click()
  const metadata = page.getByRole('complementary', { name: 'metadata' })
  const drawerBadge = metadata.locator('[data-badge="heldout"]')
  await expect(drawerBadge).toHaveText((await badge.textContent())!)
  await drawerBadge.click()
  await expect(page.getByRole('region', { name: 'drawer' })).toHaveAttribute('data-ticket', String(follow.number))
  open(werk, 'hold')
})
