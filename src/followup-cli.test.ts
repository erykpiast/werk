// `werk followup <ticket>`: the chat agent's record of a request after a finished build
// (#werk-cli-followup). The tests call followupCommand on a scratch board; one runs the real
// command line to show the verb is registered.
import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { appendBoard, readBoard } from './board.ts'
import { followupCommand } from './followup-cli.ts'
import { cli, scratchDir } from './test/harness.ts'

/** A scratch board with app/01 done and app/02 still building. */
function scratch() {
  const dir = scratchDir('werk-followup-')
  const board = join(dir, '.werk', 'board.jsonl')
  appendBoard('ticket.planned', { id: 'app/01', run: 'app', file: '01.md', title: 'Login by magic link', blockedBy: [] }, { path: board })
  appendBoard('ticket.planned', { id: 'app/02', run: 'app', file: '02.md', title: 'Add an item', blockedBy: [] }, { path: board })
  appendBoard('ticket.moved', { id: 'app/01', to: 'done' }, { path: board })
  appendBoard('ticket.moved', { id: 'app/02', to: 'building' }, { path: board })
  const run = (id: string, flags: Record<string, string | true>) => followupCommand([id], flags, 'agent', { board })
  const records = () => readBoard(board).filter((e) => e.type === 'ticket.followup').map((e) => e.payload)
  return { dir, board, run, records }
}

const BUILD = { class: 'build', found: 'after-merge', why: 'the link lasts 1 minute; the card says 15', catchable: 'yes' }

describe('followup', () => {
  test('a build miss on a done ticket is one board record, with whether a check could catch it', () => {
    const s = scratch()
    expect(s.run('app/01', BUILD)).toEqual(['recorded follow-up on app/01:', '  1. build miss, found after-merge, a check could catch it — the link lasts 1 minute; the card says 15'])
    expect(s.records()).toEqual([{ id: 'app/01', class: 'build', found: 'after-merge', why: BUILD.why, catchable: true }])
  })

  test('a correction names its record, and the list shows the correction in force', () => {
    const s = scratch()
    s.run('app/01', BUILD)
    s.run('app/01', { class: 'plan', found: 'after-merge', why: 'no card said 15 minutes', of: '1' })
    expect(s.run('app/01', { list: true })).toEqual(['app/01 — Login by magic link', '  1. plan miss, found after-merge (corrected 1x) — no card said 15 minutes'])
  })

  test('refuses what the record cannot hold', () => {
    const s = scratch()
    expect(() => s.run('app/02', BUILD)).toThrow('app/02 is in building, not done')
    expect(() => s.run('app/99', BUILD)).toThrow('no ticket "app/99"')
    expect(() => s.run('app/01', { ...BUILD, class: 'other' })).toThrow('--class must be plan or build')
    expect(() => s.run('app/01', { ...BUILD, found: 'later' })).toThrow('--found must be review or after-merge')
    expect(() => s.run('app/01', { class: 'build', found: 'review', catchable: 'yes' })).toThrow('--why needs one line')
    expect(() => s.run('app/01', { ...BUILD, catchable: 'maybe' })).toThrow('a build miss needs --catchable yes|no')
    expect(() => s.run('app/01', { class: 'plan', found: 'review', why: 'x', catchable: 'no' })).toThrow('--catchable is for a build miss only')
    expect(() => s.run('app/01', { ...BUILD, of: '1' })).toThrow('--of must name one of app/01\'s records, 1 to 0')
    expect(() => followupCommand([], {}, 'agent', { board: s.board })).toThrow('followup needs a ticket id')
    expect(s.records()).toEqual([])
    expect(s.run('app/01', { list: true })).toEqual(['app/01 has no follow-up'])
  })

  test('the command line has the verb', () => {
    const s = scratch()
    expect(cli(['help'], { cwd: s.dir, log: join(s.dir, 'log.jsonl') }).stdout).toContain('werk followup <ticket>')
  })
})
