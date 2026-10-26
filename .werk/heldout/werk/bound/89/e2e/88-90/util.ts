/** Shared setup for the 89.x and 90.x browser held-out specs. */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import type { Werk } from '../../../e2e/harness.ts'
import type { FakeReply, FakeStep } from '../../../src/test/fake-agent.ts'

export const ticket = (page: Page, n: number) => page.locator(`li[data-ticket="${n}"]`)
export const column = (page: Page, name: string) => page.getByRole('region', { name, exact: true })
export const inColumn = (page: Page, name: string, n: number) => column(page, name).locator(`li[data-ticket="${n}"]`)
export const numbers = (page: Page, name: string) =>
  column(page, name)
    .locator('li[data-ticket]')
    .evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-ticket'))))
export const said = (text: string): FakeStep => ({ event: { type: 'assistant', message: { content: [{ type: 'text', text }] } } })

export type T = { number: number; title: string; touches: string[]; blockedBy?: number[] }

export const reply = (object: unknown): FakeReply => ({
  steps: [{ event: { type: 'result', subtype: 'success', total_cost_usd: 0.01, num_turns: 1, result: `Done.\n${JSON.stringify(object)}` } }],
})

export type Setup = {
  gate: (name: string) => string
  open: (name: string) => void
  events: () => { type: string; actor: string; payload: Record<string, unknown> }[]
  cleanup: () => void
}

/**
 * Replaces the fixture board with the given tickets of plan "map" (plus extra events), adds a
 * Makefile whose `make check`:
 *   - on a builder branch: waits for the gate "build-go", then is red when red.txt says red;
 *   - on the merge queue's detached tree: waits for the gate "merge-go" when `mergeHoldIf` is in the tree.
 * The gates are test seams, not user actions. Then scripts the agents and opens the board.
 */
export async function setup(
  page: Page,
  werk: Werk,
  o: { tickets: T[]; extra?: object[]; builders: FakeReply[] | ((gate: (name: string) => string) => FakeReply[]); mergeHoldIf?: string; holdBuildChecks?: boolean },
): Promise<Setup> {
  const gates = join(werk.dir, '..', 'gates')
  mkdirSync(gates, { recursive: true })
  const gate = (name: string) => join(gates, name)
  const open = (name: string) => writeFileSync(gate(name), '')
  if (!o.holdBuildChecks) open('build-go')
  const hold = o.mergeHoldIf ?? '__never__'
  const makefile = [
    'check:',
    `\t@if git symbolic-ref -q HEAD >/dev/null; then while [ ! -f ${gate('build-go')} ]; do sleep 0.1; done; if grep -qs red red.txt; then echo RED-MARK; exit 1; fi; else if [ -f ${hold} ]; then while [ ! -f ${gate('merge-go')} ]; do sleep 0.1; done; fi; fi`,
    '',
  ].join('\n')
  writeFileSync(join(werk.dir, 'Makefile'), makefile)
  const board = join(werk.dir, '.werk', 'board.jsonl')
  let seq = 0
  const line = (e: object) => JSON.stringify({ seq: ++seq, at: '2026-10-21T01:00:00.000Z', actor: 'agent', ...e })
  const planned = o.tickets.map((t) =>
    line({
      type: 'ticket.planned',
      payload: {
        number: t.number,
        title: t.title,
        cites: ['map'],
        blockedBy: t.blockedBy ?? [],
        stories: [],
        touches: t.touches,
        checks: ['make check'],
        brief: `## What to build\n\n${t.title} works.\n\n## Acceptance criteria\n\n- ${t.title} works.`,
        root: 'map',
      },
    }),
  )
  writeFileSync(board, [...planned, ...(o.extra ?? []).map(line)].join('\n') + '\n')
  const git = (...args: string[]) => {
    const r = spawnSync('git', args, { cwd: werk.dir, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } })
    if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`)
  }
  git('add', '.')
  git('commit', '--quiet', '-m', 'Held-out setup')

  const ids = ['ac-1', 'ac-2', 'ac-3', '#map', '#werk', '#log', '#fold', '#map-hash', '#tests']
  werk.scriptAgent({
    steps: [],
    roles: {
      grader: reply({ lines: ids.map((id) => ({ id, score: 4, gap: 'none' })) }),
      ...Object.fromEntries(['design', 'maintainability', 'tests', 'security', 'performance'].map((a) => [`reviewer-${a}`, reply({ findings: [] })])),
      builder: typeof o.builders === 'function' ? o.builders(gate) : o.builders,
      'heldout-author': reply({ steps: [{ text: 'Given the product is installed\nWhen the user opens the feature\nThen the user sees STEP-MARK' }] }),
      'heldout-binder': [reply({ steps: o.tickets.map((t) => ({ id: `${t.number}.1`, cmd: 'true' })) })],
    },
  })

  await page.goto(werk.url + '#/board')
  await page.getByRole('navigation', { name: 'views' }).getByRole('link', { name: 'Board' }).click()

  const events = () =>
    readFileSync(board, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l))
  return {
    gate,
    open,
    events,
    cleanup: () => {
      // Release every hold so no fake agent waits for ever, then stop each run the board started.
      for (const g of ['build-go', 'merge-go', 'g1', 'g2', 'g3', 'exit', 'never']) if (!existsSync(gate(g))) open(g)
      for (const e of events()) {
        if (e.type !== 'run.started') continue
        const pid = e.payload.pid as number
        try {
          process.kill(-pid, 'SIGTERM')
        } catch {}
        try {
          process.kill(pid, 'SIGTERM')
        } catch {}
      }
    },
  }
}
