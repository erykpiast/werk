/** Held-out step 87.4 in a browser: the held-out badge on the done ticket and in its drawer. */
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '../../e2e/harness.ts'

const reply = (object: unknown) => ({
  steps: [{ event: { type: 'result', subtype: 'success', total_cost_usd: 0.01, num_turns: 1, result: `Done.\n${JSON.stringify(object)}` } }],
})
const STEP = 'Given the product is installed\nWhen the user opens the feature\nThen the user sees STEP-MARK'

test('87.4 a red held-out step after a merge files a follow-up and shows a held-out badge on the done ticket', async ({ page, werk }) => {
  test.setTimeout(120_000)
  const git = (...args: string[]) => spawnSync('git', args, { cwd: werk.dir, encoding: 'utf8' })
  writeFileSync(join(werk.dir, 'Makefile'), 'check:\n\t@if [ -f red.txt ]; then echo red; exit 1; fi\n')
  mkdirSync(join(werk.dir, '.werk', 'plans', 'root'), { recursive: true })
  const at = '2026-10-21T00:00:00.000Z'
  const log = [
    { type: 'node.proposed', payload: { id: 'root', kind: 'card', title: 'Root', status: 'decided' } },
    { type: 'node.proposed', payload: { id: 'loop', kind: 'card', title: 'Loop', status: 'decided', parent: 'root' } },
    { type: 'node.accepted', payload: { id: 'loop' } },
  ].map((e, i) => JSON.stringify({ ...e, seq: i + 1, at, actor: 'agent' }))
  writeFileSync(join(werk.dir, '.werk', 'log.jsonl'), log.join('\n') + '\n')
  const ticket = {
    number: 3,
    title: 'Ticket 3',
    cites: ['loop'],
    blockedBy: [],
    stories: [],
    touches: ['module 3'],
    checks: ['make check'],
    brief: '## What to build\n\nThe feature works.\n\n## Acceptance criteria\n\n- The feature works.',
    root: 'root',
  }
  writeFileSync(join(werk.dir, '.werk', 'board.jsonl'), JSON.stringify({ type: 'ticket.planned', payload: ticket, seq: 1, at, actor: 'agent' }) + '\n')
  git('add', '-A')
  git('commit', '--quiet', '-m', 'A plan run with one ready ticket')

  werk.scriptAgent({
    steps: [],
    roles: {
      grader: reply({ lines: ['ac-1', '#loop'].map((id) => ({ id, score: 4, gap: 'none' })) }),
      ...Object.fromEntries(['design', 'maintainability', 'tests', 'security', 'performance'].map((a) => [`reviewer-${a}`, reply({ findings: [] })])),
      // The ticket's pass is green. The follow-up's pass fails, so the follow-up stays open.
      builder: [{ steps: [{ edit: { path: 't3.txt', content: 't3\n' } }, ...reply({}).steps] }, { steps: [{ edit: { path: 'red.txt', content: 'red\n' } }, ...reply({}).steps] }],
      'heldout-author': reply({ steps: [{ text: STEP }] }),
      'heldout-binder': reply({ steps: [{ id: '3.1', cmd: 'false' }] }),
    },
  })
  const code = await werk.start(['run', 'root', '--cap', '1']).exited
  console.log('87.4 run exit', code, readFileSync(join(werk.dir, '.werk', 'board.jsonl'), 'utf8').split('\n').length)

  await page.getByRole('navigation', { name: 'views' }).getByRole('link', { name: 'Board' }).click()
  const done = page.getByRole('region', { name: 'done', exact: true })
  const card = done.locator('li[data-ticket="3"]')
  await expect(card).toBeVisible()
  const badge = card.locator('[data-badge="heldout"]')
  await expect(badge).toBeVisible()
  await card.getByRole('link').first().click()
  const drawer = page.getByRole('region', { name: 'drawer' })
  const metaBadge = drawer.getByRole('complementary', { name: 'metadata' }).locator('[data-badge="heldout"]')
  await expect(metaBadge).toBeVisible()
  await expect(metaBadge).toHaveText((await badge.textContent())!)
  await metaBadge.click()
  await expect(page).toHaveURL(/#\/board\/4$/)
  await expect(page.getByRole('region', { name: 'drawer' }).getByRole('article', { name: 'slice' })).toContainText('Make a failed user path work')
})
