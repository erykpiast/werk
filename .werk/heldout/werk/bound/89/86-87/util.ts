/** Shared setup for the 86-87 held-out tests. Patterns copied from src/cli/heldout.test.ts and src/cli/run.test.ts. */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BoardEvent, NewBoardEvent, TicketFields } from '../../src/board/events.ts'
import { foldBoard } from '../../src/board/fold.ts'
import { readLog } from '../../src/map/log.ts'
import type { FakeReply } from '../../src/test/fake-agent.ts'
import { makeProject, type Project } from '../../src/test/harness.ts'
import { accepted, logOf, proposed } from '../../src/test/map-events.ts'

export const MAIN = join(import.meta.dir, '..', '..', 'src', 'cli', 'main.ts')

export const ticketOf = (number: number, extra: Partial<TicketFields> = {}): TicketFields => ({
  number,
  title: `Ticket ${number}`,
  cites: ['loop'],
  blockedBy: [],
  stories: [],
  touches: [`module ${number}`],
  checks: ['make check'],
  brief: '## What to build\n\nThe feature works.\n\n## Acceptance criteria\n\n- The feature works.',
  root: 'root',
  ...extra,
})

export type Ctx = {
  p: Project
  board: () => string
  store: () => string
  git: (...args: string[]) => string
  appendBoard: (...events: NewBoardEvent[]) => void
  events: () => BoardEvent[]
  columnOf: (n: number, upTo?: BoardEvent[]) => string | undefined
  movesOf: (n: number) => string[]
  gates: () => string[]
  promptsOf: (role: string) => string[]
  commit: (file: string, text: string, msg?: string) => void
}

/** A project with a Makefile and files on the main line, a decided subtree "root", and the tickets in ready. */
export function project(opts: { makefile: string; files?: Record<string, string>; tickets: TicketFields[] }): Ctx {
  const p = makeProject()
  const git = (...args: string[]) => p.run(['git', ...args]).stdout.trim()
  writeFileSync(join(p.dir, 'Makefile'), opts.makefile)
  for (const [f, c] of Object.entries(opts.files ?? {})) writeFileSync(join(p.dir, f), c)
  p.run(['git', 'add', '-A'])
  p.run(['git', 'commit', '--quiet', '-m', 'Add the check'])
  const werk = join(p.dir, '.werk')
  const board = () => join(werk, 'board.jsonl')
  mkdirSync(join(werk, 'plans', 'root'), { recursive: true })
  const log = logOf(proposed('root', { status: 'decided' }), proposed('loop', { status: 'decided', parent: 'root' }), accepted('loop'))
  writeFileSync(join(werk, 'log.jsonl'), log.map((e) => JSON.stringify(e)).join('\n') + '\n')
  writeFileSync(board(), '')
  const appendBoard = (...events: NewBoardEvent[]) => {
    for (const e of events) appendFileSync(board(), JSON.stringify({ ...e, seq: 0, at: '2026-10-21T00:00:00.000Z', actor: 'agent' }) + '\n')
  }
  appendBoard(...opts.tickets.map((t): NewBoardEvent => ({ type: 'ticket.planned', payload: t })))
  const events = () => readLog<BoardEvent>(board())
  return {
    p,
    board,
    store: () => join(werk, 'heldout', 'root'),
    git,
    appendBoard,
    events,
    columnOf: (n, upTo = events()) => foldBoard(upTo).columns.find((c) => c.tickets.some((t) => t.number === n))?.name,
    movesOf: (n) => events().flatMap((e) => (e.type === 'ticket.moved' && e.payload.number === n ? [e.payload.to] : [])),
    gates: () => events().flatMap((e) => (e.type === 'gate.opened' ? [e.payload.commit] : [])),
    promptsOf: (role) => {
      const roles = p.agentRoles()
      return p.agentInputs().flatMap((lines, i) => {
        const user = lines.find((l) => (l as { type?: string }).type === 'user') as { message: { content: string } } | undefined
        return roles[i] === role && user ? [typeof user.message.content === 'string' ? user.message.content : JSON.stringify(user.message.content)] : []
      })
    },
    commit: (file, text, msg = `change ${file}`) => {
      writeFileSync(join(p.dir, file), text)
      p.run(['git', 'add', file])
      p.run(['git', 'commit', '--quiet', '-m', msg])
    },
  }
}

export const reply = (object: unknown): FakeReply => ({
  steps: [{ event: { type: 'result', subtype: 'success', total_cost_usd: 0.01, num_turns: 1, result: `Done.\n${JSON.stringify(object)}` } }],
})
export const writes = (path: string, content = `${path}\n`): FakeReply => ({ steps: [{ edit: { path, content } }, ...reply({}).steps] })
export const judges = (): Record<string, FakeReply> => ({
  grader: reply({ lines: ['ac-1', 'ac-2', '#loop'].map((id) => ({ id, score: 4, gap: 'none' })) }),
  ...Object.fromEntries(['design', 'maintainability', 'tests', 'security', 'performance'].map((a) => [`reviewer-${a}`, reply({ findings: [] })])),
})
export const binderOf = (bindings: Record<string, string>, steps: FakeReply['steps'] = []): FakeReply => ({
  steps: [...steps, ...reply({ steps: Object.entries(bindings).map(([id, cmd]) => ({ id, cmd })) }).steps],
})

export const readText = (path: string) => readFileSync(path, 'utf8')

/** Waits for a condition the test observes (not a product retry). */
export async function until(what: string, ok: () => boolean, ms = 30_000) {
  for (const end = Date.now() + ms; Date.now() < end; await Bun.sleep(50)) if (ok()) return
  throw new Error(`timed out waiting for ${what}`)
}
