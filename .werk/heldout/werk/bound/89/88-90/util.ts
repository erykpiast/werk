/** Shared setup for the 88.x CLI held-out tests: a plan run with ready tickets, a fake builder, and a board poller. */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BoardEvent, Column, NewBoardEvent, TicketFields } from '../../src/board/events.ts'
import { foldBoard } from '../../src/board/fold.ts'
import { readLog } from '../../src/map/log.ts'
import type { FakeReply, FakeStep } from '../../src/test/fake-agent.ts'
import { makeProject, type Project } from '../../src/test/harness.ts'
import { accepted, logOf, proposed } from '../../src/test/map-events.ts'

export const MAIN = join(import.meta.dir, '..', '..', 'src', 'cli', 'main.ts')

export const ticketOf = (number: number, over: Partial<TicketFields> = {}): TicketFields => ({
  number,
  title: `Ticket ${number}`,
  cites: ['loop'],
  blockedBy: [],
  stories: [],
  touches: [`module ${number}`],
  checks: ['make check'],
  brief: '## What to build\n\nThe feature works.\n\n## Acceptance criteria\n\n- The feature works.',
  root: 'root',
  ...over,
})

export type Env = {
  p: Project
  board: string
  gate: (name: string) => string
  open: (name: string) => void
  events: () => BoardEvent[]
  columnOf: (n: number, upTo?: BoardEvent[]) => Column | undefined
  inColumn: (col: Column, upTo?: BoardEvent[]) => number[]
  /** The fold after each prefix of the board log: every state the board went through. */
  history: () => BoardEvent[][]
  git: (...args: string[]) => string
}

/** A project with a green `make check`, a decided subtree root/loop, and the tickets in ready. */
export function project(tickets: TicketFields[]): Env {
  const p = makeProject()
  writeFileSync(join(p.dir, 'Makefile'), 'check:\n\t@true\n')
  writeFileSync(join(p.dir, 'notes.txt'), 'notes\n')
  p.run(['git', 'add', 'Makefile', 'notes.txt'])
  p.run(['git', 'commit', '--quiet', '-m', 'Add the check'])
  const werk = join(p.dir, '.werk')
  mkdirSync(join(werk, 'plans', 'root'), { recursive: true })
  const log = logOf(proposed('root', { status: 'decided' }), proposed('loop', { status: 'decided', parent: 'root' }), accepted('loop'))
  writeFileSync(join(werk, 'log.jsonl'), log.map((e) => JSON.stringify(e)).join('\n') + '\n')
  const board = join(werk, 'board.jsonl')
  writeFileSync(board, '')
  for (const t of tickets) {
    const e: NewBoardEvent = { type: 'ticket.planned', payload: t }
    appendFileSync(board, JSON.stringify({ ...e, seq: 0, at: '2026-10-21T00:00:00.000Z', actor: 'agent' }) + '\n')
  }
  const gates = join(p.dir, '..', 'gates')
  mkdirSync(gates, { recursive: true })
  const events = () => readLog<BoardEvent>(board)
  const inColumn = (col: Column, upTo = events()) => foldBoard(upTo).columns.find((c) => c.name === col)!.tickets.map((t) => t.number)
  return {
    p,
    board,
    gate: (name) => join(gates, name),
    open: (name) => writeFileSync(join(gates, name), ''),
    events,
    columnOf: (n, upTo = events()) => foldBoard(upTo).columns.find((c) => c.tickets.some((t) => t.number === n))?.name,
    inColumn,
    history: () => {
      const all = events()
      return all.map((_, i) => all.slice(0, i + 1))
    },
    git: (...args) => p.run(['git', ...args]).stdout.trim(),
  }
}

export const reply = (object: unknown): FakeReply => ({
  steps: [{ event: { type: 'result', subtype: 'success', total_cost_usd: 0.01, num_turns: 1, result: `Done.\n${JSON.stringify(object)}` } }],
})
/** A builder pass: optional hold on a gate file, then one file edit, then a success result. */
export const builder = (path: string, holdOn?: string): FakeReply => ({
  steps: [...(holdOn ? [{ waitFor: holdOn } as FakeStep] : []), { edit: { path, content: `${path}\n` } }, ...reply({}).steps],
})
const STEP = 'Given the product is installed\nWhen the user opens the feature\nThen the user sees STEP-MARK'
export function script(e: Env, builders: FakeReply[], tickets: number[]) {
  const judges: Record<string, FakeReply> = {
    grader: reply({ lines: ['ac-1', 'ac-2', 'ac-3', '#loop', '#root'].map((id) => ({ id, score: 4, gap: 'none' })) }),
    ...Object.fromEntries(['design', 'maintainability', 'tests', 'security', 'performance'].map((a) => [`reviewer-${a}`, reply({ findings: [] })])),
  }
  e.p.scriptAgent({
    steps: [],
    roles: {
      ...judges,
      builder: builders,
      'heldout-author': reply({ steps: [{ text: STEP }] }),
      'heldout-binder': [reply({ steps: tickets.map((n) => ({ id: `${n}.1`, cmd: 'true' })) })],
    },
  })
}

export function startRun(e: Env, args: string[] = []) {
  const child = Bun.spawn([process.execPath, MAIN, 'run', 'root', '--poll-every', '50', ...args], {
    cwd: e.p.dir,
    env: e.p.env,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  return {
    pid: child.pid,
    kill: () => child.kill(),
    done: Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]).then(([code, stdout, stderr]) => ({
      code,
      stdout,
      stderr,
    })),
  }
}

/** The fake agent launches by role. */
export const launchesOf = (e: Env, role: string) =>
  readFileSync(e.p.env.WERK_FAKE_AGENT_LOG!, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { role?: string; pid: number })
    .filter((l) => l.role === role)

/** Polls the board fold every 50 ms until `ok` holds; records each reading. */
export async function until(what: string, ok: () => boolean, ms = 60_000) {
  for (const end = Date.now() + ms; Date.now() < end; await Bun.sleep(50)) if (ok()) return
  throw new Error(`timed out waiting for ${what}`)
}

export const exists = existsSync
