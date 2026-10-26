import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Werk } from '../../e2e/harness.ts'
import { spawnSync } from 'node:child_process'
import { accepted, logOf, proposed } from '../../src/test/map-events.ts'

const STEP = 'Given the product is installed\nWhen the user opens the feature\nThen the user sees UI-STEP-MARK'
const reply = (object: unknown) => ({
  steps: [{ event: { type: 'result', subtype: 'success', total_cost_usd: 0.01, num_turns: 1, result: `Done.\n${JSON.stringify(object)}` } }],
})
const writes = (path: string) => ({ steps: [{ edit: { path, content: `${path}\n` } }, ...reply({}).steps] })
const judges = {
  grader: reply({ lines: ['ac-1', 'ac-2', '#loop'].map((id) => ({ id, score: 4, gap: 'none' })) }),
  ...Object.fromEntries(['design', 'maintainability', 'tests', 'security', 'performance'].map((a) => [`reviewer-${a}`, reply({ findings: [] })])),
}
const binder = (b: Record<string, string>) => reply({ steps: Object.entries(b).map(([id, cmd]) => ({ id, cmd })) })
const ticketOf = (number: number) => ({
  number, title: `Ticket ${number}`, cites: ['loop'], blockedBy: [], stories: [], touches: [`module ${number}`], checks: ['make check'],
  brief: '## What to build\n\nThe feature works.\n\n## Acceptance criteria\n\n- [ ] The feature works.\n- [ ] The user sees it.', root: 'root',
})
const boardLine = (e: unknown) => JSON.stringify({ ...(e as object), seq: 0, at: '2026-10-21T00:00:00.000Z', actor: 'agent' }) + '\n'

function prepare(werk: Werk, makefile: string, numbers: number[]) {
  const git = (...a: string[]) => spawnSync('git', a, { cwd: werk.dir, encoding: 'utf8' })
  writeFileSync(join(werk.dir, 'Makefile'), makefile)
  git('add', 'Makefile')
  git('commit', '--quiet', '-m', 'Add the check')
  const log = logOf(proposed('root', { status: 'decided' }), proposed('loop', { status: 'decided', parent: 'root' }), accepted('loop'))
  writeFileSync(join(werk.dir, '.werk', 'log.jsonl'), log.map((e) => JSON.stringify(e)).join('\n') + '\n')
  writeFileSync(join(werk.dir, '.werk', 'board.jsonl'), numbers.map((n) => boardLine({ type: 'ticket.planned', payload: ticketOf(n) })).join(''))
}

test('87.2 the drawer of a ticket red on the merged tree shows the failed check and its output', async ({ page, werk }) => {
  prepare(werk, 'check:\n\t@if [ -f a.txt ] && [ -f b.txt ] && ! git symbolic-ref -q HEAD >/dev/null; then echo "PAIR-RED-MARK"; exit 1; fi\n', [3])
  werk.scriptAgent({ steps: [], roles: { ...judges, builder: [writes('a.txt')], 'heldout-author': reply({ steps: [{ text: STEP }] }), 'heldout-binder': binder({ '3.1': 'true' }) } })
  werk.cli(['run', 'root'])
  const { appendFileSync } = await import('node:fs')
  appendFileSync(join(werk.dir, '.werk', 'board.jsonl'), boardLine({ type: 'ticket.planned', payload: ticketOf(4) }))
  werk.scriptAgent({ steps: [], roles: { ...judges, builder: [writes('b.txt')], 'heldout-author': reply({ steps: [{ text: STEP }] }), 'heldout-binder': binder({ '3.1': 'true', '4.1': 'true' }) } })
  try { werk.cli(['run', 'root', '--cap', '1']) } catch {}
  await page.goto(`${werk.url}#/board`)
  await expect(page.getByRole('region', { name: 'building', exact: true }).locator('li[data-ticket="4"]')).toBeVisible()
  await page.locator('li[data-ticket="4"]').getByRole('link', { name: 'Ticket 4' }).click()
  const drawer = page.getByRole('region', { name: 'drawer' })
  await expect(drawer).toBeVisible()
  await expect(drawer).toContainText('make check')
  await expect(drawer).toContainText('PAIR-RED-MARK')
})

test('87.4 the done ticket shows a held-out badge on its card and in its drawer, and the badge opens the follow-up', async ({ page, werk }) => {
  prepare(werk, 'check:\n\t@true\n', [3])
  const flag = join(werk.dir, '..', 'go')
  werk.scriptAgent({
    steps: [],
    roles: {
      ...judges,
      builder: [writes('t3.txt'), { steps: [{ waitFor: flag }, ...writes('fix.txt').steps] }],
      'heldout-author': reply({ steps: [{ text: STEP }] }),
      'heldout-binder': [binder({ '3.1': 'false' }), binder({ '3.1': 'true', '4.1': 'true' })],
    },
  })
  const run = werk.start(['run', 'root'])
  await page.goto(`${werk.url}#/board`)
  const done = page.getByRole('region', { name: 'done', exact: true }).locator('li[data-ticket="3"]')
  await expect(done).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('li[data-ticket="4"]')).toBeVisible({ timeout: 30_000 })
  const badge = done.locator('[data-badge="heldout"]')
  await expect(badge).toBeVisible()
  await done.getByRole('link', { name: 'Ticket 3' }).click()
  const drawer = page.getByRole('region', { name: 'drawer' })
  await expect(drawer.getByRole('complementary', { name: 'metadata' }).locator('[data-badge="heldout"]')).toBeVisible()
  await drawer.getByRole('complementary', { name: 'metadata' }).locator('[data-badge="heldout"]').click()
  await expect(page.getByRole('region', { name: 'drawer' })).toHaveAttribute('data-ticket', '4')
  await expect(page.getByRole('region', { name: 'drawer' })).toContainText('UI-STEP-MARK')
  writeFileSync(flag, '')
  await run.exited
  expect(existsSync(flag)).toBe(true)
})
