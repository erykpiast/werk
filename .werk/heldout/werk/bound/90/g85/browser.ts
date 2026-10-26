/** Shared setup for the g85 browser specs: replace the fixture's map and board with a plan run. */
import type { Page } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BoardEvent, TicketFields } from '../../src/board/events.ts'
import { foldBoard } from '../../src/board/fold.ts'
import type { FakeReply, FakeStep } from '../../src/test/fake-agent.ts'
import { accepted, logOf, proposed } from '../../src/test/map-events.ts'
import { expect, type Werk } from '../../e2e/harness.ts'

export const ticketOf = (number: number, fields: Partial<TicketFields> = {}): TicketFields => ({
  number,
  title: `Ticket ${number}`,
  cites: ['loop'],
  blockedBy: [],
  stories: [],
  touches: [`module ${number}`],
  checks: ['true'],
  brief: '## What to build\n\nThe feature works.\n\n## Acceptance criteria\n\n- The feature works.',
  root: 'root',
  ...fields,
})

/** Writes a map with the subtree root and a board with the tickets in ready, then opens the board. */
export async function planRun(page: Page, werk: Werk, tickets: TicketFields[]) {
  const log = logOf(proposed('root', { status: 'decided' }), proposed('loop', { status: 'decided', parent: 'root' }), accepted('loop'))
  writeFileSync(join(werk.dir, '.werk', 'log.jsonl'), log.map((e) => JSON.stringify(e)).join('\n') + '\n')
  writeFileSync(
    join(werk.dir, '.werk', 'board.jsonl'),
    tickets.map((t, i) => JSON.stringify({ seq: i + 1, at: '2026-10-21T00:00:00.000Z', actor: 'agent', type: 'ticket.planned', payload: t })).join('\n') + '\n',
  )
  await page.goto(`${werk.url}#/board`)
  for (const t of tickets) await expect(ticket(page, t.number)).toBeVisible()
}

export const ticket = (page: Page, n: number) => page.locator(`li[data-ticket="${n}"]`)
export const column = (page: Page, name: string) => page.getByRole('region', { name, exact: true })
export const inColumn = (page: Page, name: string, n: number) => column(page, name).locator(`li[data-ticket="${n}"]`)
export const said = (text: string): FakeStep => ({ event: { type: 'assistant', message: { content: [{ type: 'text', text }] } } })
export const result: FakeStep = { event: { type: 'result', subtype: 'success', total_cost_usd: 0.01, num_turns: 1 } }
export const reply = (object: unknown): FakeReply => ({
  steps: [{ event: { type: 'result', subtype: 'success', total_cost_usd: 0.01, num_turns: 1, result: `Done.\n${JSON.stringify(object)}` } }],
})
export const judges = (): Record<string, FakeReply> => ({
  grader: reply({ lines: ['ac-1', '#loop'].map((id) => ({ id, score: 4, gap: 'none' })) }),
  ...Object.fromEntries(['design', 'maintainability', 'tests', 'security', 'performance'].map((a) => [`reviewer-${a}`, reply({ findings: [] })])),
})
/** A step author that writes no usable step, so the held-out run after a merge has nothing to bind. */
export const noSteps = reply({ steps: [] })

export const gate = (werk: Werk, name: string) => join(werk.dir, '..', `gate-${name}`)
export const open = (werk: Werk, name: string) => writeFileSync(gate(werk, name), '')

export const boardEvents = (werk: Werk): BoardEvent[] => {
  const f = join(werk.dir, '.werk', 'board.jsonl')
  return existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []
}
/** The board after each event, in order. */
export const boardHistory = (werk: Werk) => {
  const events = boardEvents(werk)
  return events.map((_, i) => foldBoard(events.slice(0, i + 1)))
}
export const columnIn = (board: ReturnType<typeof foldBoard>, n: number) => board.columns.find((c) => c.tickets.some((t) => t.number === n))?.name
export const git = (werk: Werk, ...args: string[]) => spawnSync('git', args, { cwd: werk.dir, encoding: 'utf8' }).stdout.trim()
