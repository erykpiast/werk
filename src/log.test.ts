import { describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { appendBoard, foldBoard, readBoard } from './board.ts'
import { fold } from './fold.ts'
import { append, appendMany, readEvents } from './log.ts'
import { paths } from './project.ts'
import { citePrints } from './ticket-watch.ts'

const scratch = () => join(mkdtempSync(join(tmpdir(), 'werk-log-')), 'nested', 'log.jsonl')

describe('the log', () => {
  test('reads the scratch WERK_LOG the preload set, never the repository log', () => {
    expect(paths.log).toBe(process.env.WERK_LOG!)
  })

  test('a missing file is an empty log', () => {
    expect(readEvents(scratch())).toEqual([])
  })

  test('append numbers events from 1, stamps them, and creates the directory', () => {
    const path = scratch()
    const a = append('node.added', { id: 'a' }, { path })
    const b = append('note.added', { node: 'a', text: 'hi' }, { path, actor: 'you', at: '2026-01-01T00:00:00.000Z' })
    expect([a.seq, a.actor, b.seq, b.actor, b.at]).toEqual([1, 'agent', 2, 'you', '2026-01-01T00:00:00.000Z'])
    expect(readEvents(path).map((e) => e.type)).toEqual(['node.added', 'note.added'])
  })

  test('appendMany continues the sequence and keeps a given timestamp', () => {
    const path = scratch()
    expect(appendMany([{ type: 'node.added', payload: { id: 'a' } }], path)).toBe(1)
    appendMany([{ type: 'node.added', payload: { id: 'b' }, actor: 'you', at: 'then' }, { type: 'node.added', payload: { id: 'c' } }], path)
    const events = readEvents(path)
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3])
    expect([events[1].actor, events[1].at]).toEqual(['you', 'then'])
  })

  test('blank lines are skipped, and a broken line names its file and line number', () => {
    const path = scratch()
    append('node.added', { id: 'a' }, { path })
    writeFileSync(path, readFileSync(path, 'utf8') + '\n\n{not json\n')
    expect(() => readEvents(path)).toThrow(`${path}:2 is not valid JSON`)
  })

  test('append defaults to the project log', () => {
    const before = readEvents().length
    append('note.added', { node: 'x', text: 'default path' })
    expect(readEvents()).toHaveLength(before + 1)
  })
})

describe('the ticket watch on each append (#st-ticket-watch)', () => {
  /** A log with one decided card x, and a board beside it whose ticket cites x as it is now. */
  function project() {
    const path = scratch()
    append('node.added', { id: 'x', kind: 'card', title: 'x', status: 'decided' }, { path })
    const boardPath = join(dirname(path), 'board.jsonl')
    appendBoard('ticket.planned', { id: 'x/01', run: 'x', file: 'f', title: 't', blockedBy: [] }, { path: boardPath })
    appendBoard('ticket.cites', { id: 'x/01', cards: citePrints(fold(readEvents(path)), ['x']) }, { path: boardPath })
    return { path, boardPath }
  }

  test('a change to a cited card holds the ticket, once; a comment does not', () => {
    const { path, boardPath } = project()
    append('note.added', { node: 'x', text: 'a comment' }, { path })
    expect(readBoard(boardPath)).toHaveLength(2)
    append('node.retitled', { id: 'x', title: 'new' }, { path })
    append('note.added', { node: 'x', text: 'another' }, { path })
    const moved = readBoard(boardPath).slice(2)
    expect(moved.map((e) => [e.type, (e.payload as { check?: string }).check])).toEqual([['ticket.moved', 'cited-changed']])
    expect(foldBoard(readBoard(boardPath)).tickets.get('x/01')!.column).toBe('blocked')
  })

  test('appendMany runs the watch once, on the whole batch', () => {
    const { path, boardPath } = project()
    appendMany([{ type: 'node.retitled', payload: { id: 'x', title: 'new' } }, { type: 'node.retitled', payload: { id: 'x', title: 'x' } }], path)
    expect(readBoard(boardPath)).toHaveLength(2)
  })

  test('a discarded proposal a merged ticket was built on files one follow-up beside the .werk directory (#st-build-missing-decision)', () => {
    const { path, boardPath } = project()
    const cwd = dirname(dirname(boardPath))
    mkdirSync(join(cwd, '.werk', 'tickets', 'x'), { recursive: true })
    writeFileSync(join(cwd, '.werk', 'tickets', 'x', '01.md'), 'title: T\ncites: x\nblocked_by:\nstories:\ntouches: server\n\n## What to build\n\nIt.\n\n## Acceptance criteria\n\n- [ ] It works\n\n## Checks\n\n- `make test`\n')
    append('obligation.created', { id: 'build-b1', ticket: 'x/01', cites: ['x'] }, { path })
    append('node.proposed', { id: 'p', kind: 'card', title: 'P', status: 'decided', obligation: 'build-b1' }, { path })
    appendBoard('ticket.planned', { id: 'x/01', run: 'x', file: '.werk/tickets/x/01.md', title: 't', blockedBy: [] }, { path: boardPath })
    appendBoard('ticket.proposals', { id: 'x/01', cards: citePrints(fold(readEvents(path)), ['p'], { held: true }) }, { path: boardPath })
    appendBoard('ticket.moved', { id: 'x/01', to: 'done' }, { path: boardPath })

    append('change.discarded', { id: 'p' }, { path })
    append('note.added', { node: 'x', text: 'a later write runs the watch again' }, { path })

    const b = foldBoard(readBoard(boardPath))
    expect(b.tickets.get('x/01')).toMatchObject({ column: 'done', decisionChanged: 'a decision it was built on changed: #p removed' })
    const followUps = [...b.tickets.values()].filter((t) => t.followUpOf === 'x/01')
    // One follow-up, in ready, though the watch ran twice after the discard.
    expect(followUps).toHaveLength(1)
    expect(followUps[0]).toMatchObject({ column: 'ready' })
    const text = readFileSync(join(cwd, followUps[0]!.file), 'utf8')
    // The gone proposal is not cited; the merged ticket's own cites and checks carry over.
    expect(text).toContain('cites: x\n')
    expect(text).toContain('touches: server')
    expect(text).toContain('- #p removed')
    expect(text).toContain('- `make test`')
  })

  test('a log with no board beside it gets none', () => {
    const path = scratch()
    append('node.added', { id: 'x', kind: 'card', title: 'x' }, { path })
    expect(existsSync(join(dirname(path), 'board.jsonl'))).toBe(false)
  })

  test('a broken board keeps the log write and reports the failure', () => {
    const { path, boardPath } = project()
    writeFileSync(boardPath, '{not json\n')
    const errors: string[] = []
    const was = console.error
    console.error = (m: string) => errors.push(m)
    try {
      expect(append('node.retitled', { id: 'x', title: 'new' }, { path }).seq).toBe(2)
    } finally {
      console.error = was
    }
    expect(errors[0]).toContain('the ticket watch failed')
  })
})
