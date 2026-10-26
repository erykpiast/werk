/** Held-out step 87.4 in a browser: the held-out badge on the done ticket, in its drawer, and its link. */
import type { Page } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { expect, test } from '../e2e/harness.ts'

const ROOT = join(import.meta.dirname, '..')
const MAIN = join(ROOT, 'src', 'cli', 'main.ts')
const AT = '2026-10-21T00:00:00.000Z'
const STEP = 'Given the product is installed\nWhen the user opens the feature\nThen the user sees MARK-874'

const result = (object: unknown) => ({
  event: { type: 'result', subtype: 'success', total_cost_usd: 0.01, num_turns: 1, result: `Done.\n${JSON.stringify(object)}` },
})
const reply = (object: unknown) => ({ steps: [result(object)] })
const writes = (path: string) => ({ steps: [{ edit: { path, content: `${path}\n` } }, result({})] })

const ticket = (page: Page, n: number) => page.locator(`li[data-ticket="${n}"]`)

test('87.4 a red held-out step after a merge shows a badge on the done ticket, in its drawer, and links the follow-up', async ({ page, werk }) => {
  const root = dirname(werk.dir)
  const env = {
    PATH: `${join(root, 'bin')}:${process.env.PATH ?? ''}`,
    HOME: root,
    TMPDIR: process.env.TMPDIR ?? '/tmp',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    WERK_FAKE_AGENT_SCRIPT: join(root, 'agent-script.json'),
  }
  const run = (cmd: string, args: string[]) => spawnSync(cmd, args, { cwd: werk.dir, env, encoding: 'utf8' })

  // A project with one ready ticket that passes its checks, in the subtree "root".
  const log = [
    { type: 'node.proposed', payload: { id: 'root', kind: 'card', title: 'title of root', status: 'decided' } },
    { type: 'node.proposed', payload: { id: 'loop', kind: 'card', title: 'title of loop', status: 'decided', parent: 'root' } },
    { type: 'node.accepted', payload: { id: 'loop' } },
  ]
  writeFileSync(join(werk.dir, '.werk', 'log.jsonl'), log.map((e, i) => JSON.stringify({ actor: 'agent', ...e, seq: i + 1, at: AT })).join('\n') + '\n')
  const fields = {
    number: 3,
    title: 'Ticket three',
    cites: ['loop'],
    blockedBy: [],
    stories: [],
    touches: ['module 3'],
    checks: ['make check'],
    brief: '## What to build\n\nThe feature works.\n\n## Acceptance criteria\n\n- The feature works.',
    root: 'root',
  }
  writeFileSync(join(werk.dir, '.werk', 'board.jsonl'), JSON.stringify({ type: 'ticket.planned', payload: fields, seq: 1, at: AT, actor: 'agent' }) + '\n')
  // The check is red only when bad.txt is there: the follow-up's builder writes it, so the follow-up stays open.
  writeFileSync(join(werk.dir, 'Makefile'), 'check:\n\t@if [ -f bad.txt ]; then echo bad; exit 1; fi\n')
  for (const args of [
    ['config', 'user.name', 'werk test'],
    ['config', 'user.email', 'test@werk.invalid'],
    ['config', 'commit.gpgsign', 'false'],
    ['add', '-A'],
    ['commit', '--quiet', '-m', 'The project'],
  ]) {
    expect(run('git', args).status).toBe(0)
  }
  const judges = {
    grader: reply({ lines: ['ac-1', '#loop'].map((id) => ({ id, score: 4, gap: 'none' })) }),
    ...Object.fromEntries(['design', 'maintainability', 'tests', 'security', 'performance'].map((a) => [`reviewer-${a}`, reply({ findings: [] })])),
  }
  writeFileSync(
    env.WERK_FAKE_AGENT_SCRIPT,
    JSON.stringify({
      steps: [],
      roles: {
        ...judges,
        builder: [writes('t3.txt'), writes('bad.txt')],
        'heldout-author': reply({ steps: [{ text: STEP }] }),
        'heldout-binder': reply({ steps: [{ id: '3.1', cmd: 'false' }] }),
      },
    }),
  )

  // The person starts the run, and the ticket merges.
  const r = run('bun', [MAIN, 'run', 'root', '--cap', '1'])
  expect(r.stdout).toContain('merged 3 Ticket three onto main')
  expect(r.stdout).toContain('held-out: filed follow-up ticket 4 in ready for 3.1')
  expect(run('git', ['log', '--format=%s', 'main']).stdout).toContain('werk: merge ticket 3 ')

  await page.getByRole('navigation', { name: 'views' }).getByRole('link', { name: 'Board' }).click()
  await expect(page).toHaveURL(/#\/board$/)
  const done = page.getByRole('region', { name: 'done', exact: true })
  await expect(done.locator('li[data-ticket="3"]')).toBeVisible()
  // The done ticket's card shows a held-out badge.
  const badge = ticket(page, 3).locator('[data-badge="heldout"]')
  await expect(badge).toHaveCount(1)
  await expect(badge).toBeVisible()

  // The person opens the done ticket's drawer and sees the same badge in its metadata.
  await ticket(page, 3).getByRole('link', { name: 'Ticket three' }).click()
  await expect(page).toHaveURL(/#\/board\/3$/)
  const metadata = page.getByRole('region', { name: 'drawer' }).getByRole('complementary', { name: 'metadata' })
  const drawerBadge = metadata.locator('[data-badge="heldout"]')
  await expect(drawerBadge).toHaveCount(1)
  await expect(drawerBadge).toHaveText((await badge.textContent())!)

  // The person clicks the badge and the follow-up ticket opens.
  await drawerBadge.click()
  await expect(page).toHaveURL(/#\/board\/4$/)
  const drawer = page.getByRole('region', { name: 'drawer' })
  await expect(drawer).toHaveAttribute('data-ticket', '4')
  await expect(drawer.getByRole('article', { name: 'slice' })).toContainText('MARK-874')
})
