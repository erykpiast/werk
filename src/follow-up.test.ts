import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { appendBoard, foldBoard, readBoard } from './board.ts'
import { fileDecisionFollowUp } from './follow-up.ts'
import { extendFollowUp, fileFollowUp } from './heldout.ts'
import { openFollowUp } from './run-state.ts'

describe('fileDecisionFollowUp (#st-followup-one-open)', () => {
  const setup = () => {
    const cwd = mkdtempSync(join(tmpdir(), 'werk-followup-'))
    mkdirSync(join(cwd, '.werk', 'tickets', 'r1'), { recursive: true })
    const boardPath = join(cwd, '.werk', 'board.jsonl')
    writeFileSync(join(cwd, '.werk', 'tickets', 'r1', '01.md'), 'title: T\ncites: a\nblocked_by:\nstories:\ntouches: x\n\n## What to build\n\nBuild.\n\n## Acceptance criteria\n\n- [ ] ok\n\n## Checks\n\n- `make test`\n')
    appendBoard('ticket.planned', { id: 'r1/01', run: 'r1', file: '.werk/tickets/r1/01.md', title: 'T', blockedBy: [] }, { path: boardPath })
    appendBoard('ticket.moved', { id: 'r1/01', to: 'done' }, { path: boardPath })
    const board = () => foldBoard(readBoard(boardPath))
    return { cwd, boardPath, board }
  }

  test('a second change files no second ticket while the first has not started', () => {
    const { cwd, boardPath, board } = setup()
    const live = () => true
    const first = fileDecisionFollowUp(cwd, { of: board().tickets.get('r1/01')!, changes: ['#a removed'], live, boardPath })
    const open = openFollowUp([...board().tickets.values()], 'r1/01', 'rework')!
    const second = fileDecisionFollowUp(cwd, { of: board().tickets.get('r1/01')!, changes: ['#a removed', '#b reworded'], live, boardPath, open: open.ticket })
    expect(second).toBe(first)
    expect([...board().tickets.keys()]).toEqual(['r1/01', first])
    const text = readFileSync(join(cwd, board().tickets.get(first)!.file), 'utf8')
    expect(text).toContain('#a removed')
    expect(text).toContain('#b reworded')
  })

  test('a rework that has started is left alone, and the next change files a new ticket', () => {
    const { cwd, boardPath, board } = setup()
    const live = () => true
    const first = fileDecisionFollowUp(cwd, { of: board().tickets.get('r1/01')!, changes: ['#a removed'], live, boardPath })
    appendBoard('ticket.moved', { id: first, to: 'building' }, { path: boardPath })
    expect(openFollowUp([...board().tickets.values()], 'r1/01', 'rework')?.started).toBe(true)
    const second = fileDecisionFollowUp(cwd, { of: board().tickets.get('r1/01')!, changes: ['#b reworded'], live, boardPath })
    expect(second).not.toBe(first)
  })
})

describe('extendFollowUp (#st-followup-one-open)', () => {
  test('a later red step joins the open follow-up: its file and its steps hold both', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'werk-extend-'))
    mkdirSync(join(cwd, '.werk', 'tickets', 'r1'), { recursive: true })
    const boardPath = join(cwd, '.werk', 'board.jsonl')
    writeFileSync(join(cwd, '.werk', 'tickets', 'r1', '01.md'), 'title: T\n')
    const step = (id: string) => ({ id, ticket: 'r1/01', text: `Scenario: path ${id}\nGiven a\nWhen b\nThen c` })
    appendBoard('ticket.planned', { id: 'r1/01', run: 'r1', file: 'x', title: 'T', blockedBy: [] }, { path: boardPath })
    const of = foldBoard(readBoard(boardPath)).tickets.get('r1/01')!
    const id = fileFollowUp(cwd, { run: 'r1', of, steps: [step('01.1')], cites: ['a'], checks: ['make test'], boardPath })
    const open = foldBoard(readBoard(boardPath)).tickets.get(id)!
    expect(extendFollowUp(cwd, { open, of, steps: [step('01.1'), step('01.2')], cites: ['a'], checks: ['make test'], boardPath })).toBe(id)
    const after = foldBoard(readBoard(boardPath)).tickets
    expect([...after.keys()]).toEqual(['r1/01', id])
    expect(after.get(id)).toMatchObject({ steps: ['01.1', '01.2'], title: 'Follow-up for r1/01: 01.1, 01.2' })
    const text = readFileSync(join(cwd, open.file), 'utf8')
    expect(text).toContain('path 01.1')
    expect(text).toContain('path 01.2')
  })
})
