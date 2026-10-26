/** Shared helpers for the held-out tests of steps 86, 87, 88 and 98. */
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
  werk: () => string
  board: () => string
  git: (...args: string[]) => string
  appendBoard: (...events: NewBoardEvent[]) => void
  person: (...events: NewBoardEvent[]) => void
  events: () => BoardEvent[]
  columnOf: (n: number, upTo?: BoardEvent[]) => string | undefined
  movesOf: (n: number) => string[]
  gates: () => string[]
  mainLine: () => string[]
  prompts: (role: string) => string[]
  launches: () => { role?: string; pid: number; argv: string[] }[]
}

export function project(tickets: number[], opts: { makefile: string; files?: Record<string, string>; fields?: Record<number, Partial<TicketFields>> }): Ctx {
  const p = makeProject()
  writeFileSync(join(p.dir, 'Makefile'), opts.makefile)
  const files = opts.files ?? { 'notes.txt': 'notes\n' }
  for (const [f, c] of Object.entries(files)) writeFileSync(join(p.dir, f), c)
  p.run(['git', 'add', 'Makefile', ...Object.keys(files)])
  p.run(['git', 'commit', '--quiet', '-m', 'Add the check'])
  const werk = () => join(p.dir, '.werk')
  const board = () => join(werk(), 'board.jsonl')
  mkdirSync(join(werk(), 'plans', 'root'), { recursive: true })
  const log = logOf(proposed('root', { status: 'decided' }), proposed('loop', { status: 'decided', parent: 'root' }), accepted('loop'))
  writeFileSync(join(werk(), 'log.jsonl'), log.map((e) => JSON.stringify(e)).join('\n') + '\n')
  writeFileSync(board(), '')
  const add = (actor: string) => (...events: NewBoardEvent[]) => {
    for (const e of events) appendFileSync(board(), JSON.stringify({ ...e, seq: 0, at: new Date().toISOString(), actor }) + '\n')
  }
  const appendBoard = add('agent')
  appendBoard(...tickets.map((n): NewBoardEvent => ({ type: 'ticket.planned', payload: ticketOf(n, opts.fields?.[n]) })))
  const git = (...args: string[]) => p.run(['git', ...args]).stdout.trim()
  const events = () => readLog<BoardEvent>(board())
  const launches = () =>
    readFileSync(p.env.WERK_FAKE_AGENT_LOG!, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { role?: string; pid: number; argv: string[] })
  return {
    p,
    werk,
    board,
    git,
    appendBoard,
    person: add('you'),
    events,
    columnOf: (n, upTo = events()) => foldBoard(upTo).columns.find((c) => c.tickets.some((t) => t.number === n))?.name,
    movesOf: (n) => events().flatMap((e) => (e.type === 'ticket.moved' && e.payload.number === n ? [e.payload.to] : [])),
    gates: () => events().flatMap((e) => (e.type === 'gate.opened' ? [e.payload.commit] : [])),
    mainLine: () => git('log', '--first-parent', '--format=%s', 'main').split('\n'),
    prompts: (role) => {
      const roles = p.agentRoles()
      return p.agentInputs().flatMap((lines, i) => {
        const user = lines.find((l) => (l as { type?: string }).type === 'user') as { message: { content: unknown } } | undefined
        const c = user?.message.content
        const text = typeof c === 'string' ? c : JSON.stringify(c)
        return roles[i] === role && user ? [text] : []
      })
    },
    launches,
  }
}

export const reply = (object: unknown): FakeReply => ({
  steps: [{ event: { type: 'result', subtype: 'success', total_cost_usd: 0.01, num_turns: 1, result: `Done.\n${JSON.stringify(object)}` } }],
})
export const writes = (path: string, content = `${path}\n`): FakeReply => ({ steps: [{ edit: { path, content } }, ...reply({}).steps] })
export const binder = (bindings: Record<string, string>, extra: FakeReply['steps'] = []): FakeReply => ({
  steps: [...extra, ...reply({ steps: Object.entries(bindings).map(([id, cmd]) => ({ id, cmd })) }).steps],
})
export const REVIEW_AREAS = ['design', 'maintainability', 'tests', 'security', 'performance']
export const judges = (lines = ['ac-1', '#loop']): Record<string, FakeReply> => ({
  grader: reply({ lines: lines.map((id) => ({ id, score: 4, gap: 'none' })) }),
  ...Object.fromEntries(REVIEW_AREAS.map((a) => [`reviewer-${a}`, reply({ findings: [] })])),
})

export async function until(what: string, ok: () => boolean, ms = 30_000) {
  for (const end = Date.now() + ms; Date.now() < end; await Bun.sleep(50)) if (ok()) return
  throw new Error(`timed out waiting for ${what}`)
}

export function startWerk(ctx: Ctx, args: string[]) {
  const child = Bun.spawn([process.execPath, MAIN, ...args], { cwd: ctx.p.dir, env: ctx.p.env, stdout: 'pipe', stderr: 'pipe' })
  return {
    pid: child.pid,
    kill: () => child.kill('SIGKILL'),
    done: Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]).then(([code, stdout, stderr]) => ({
      code,
      stdout,
      stderr,
    })),
  }
}
