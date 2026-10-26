import { describe, expect, test } from 'bun:test'
import type { BoardEvent } from './board.ts'
import { isRunId, isTicketId, parseTicketText, plannedFromRun, plannedIds, summarizeLogLine, ticketId } from './board-text.ts'

const TICKET = `title: Show the board
cites: vi-board, #werk-board-columns
blocked_by: 1, 3
stories: 2, 5
touches: board view, ticket drawer

## What to build

The board is a **view**.

## Acceptance criteria

- [ ] it shows

## Checks

- \`bun test src/board.test.ts\`
- bunx tsc --noEmit
`

describe('parseTicketText', () => {
  test('reads the header, the slice, and the checks', () => {
    expect(parseTicketText(TICKET)).toEqual({
      title: 'Show the board',
      cites: ['vi-board', 'werk-board-columns'],
      blockedBy: ['1', '3'],
      stories: ['2', '5'],
      touches: ['board view', 'ticket drawer'],
      body: '## What to build\n\nThe board is a **view**.\n\n## Acceptance criteria\n\n- [ ] it shows',
      checks: ['bun test src/board.test.ts', 'bunx tsc --noEmit'],
    })
  })

  test('a file with no title is not a ticket; missing fields are empty, and checks fall back to the default set', () => {
    expect(parseTicketText('cites: a-b\n\nbody')).toBeUndefined()
    const t = parseTicketText('title: T\n\nbody only')!
    expect(t).toMatchObject({ cites: [], blockedBy: [], stories: [], body: 'body only' })
    expect(t.checks.length).toBeGreaterThan(0)
  })
})

describe('isRunId and isTicketId', () => {
  test('a run id is one plain path segment', () => {
    for (const ok of ['r', 'st-build-steps', '1759500000000', 'a_b.c']) expect(isRunId(ok)).toBe(true)
    for (const bad of ['', '..', '.', '.hidden', '../x', 'a/b', 'a\\b', '/abs', 'a b']) expect(isRunId(bad)).toBe(false)
  })

  test('a ticket id is a run id, a slash, and a number', () => {
    expect([isTicketId('r/01'), isTicketId('st-build-steps/123')]).toEqual([true, true])
    for (const bad of ['r', 'r/', 'r/x', '../r/01', 'r/../01', 'a/b/01', '/01']) expect(isTicketId(bad)).toBe(false)
  })
})

describe('ticketId', () => {
  test('is the run and the ticket number, two digits at least, the way werk plan writes it', () => {
    expect(ticketId('r', 1)).toBe('r/01')
    expect(ticketId('r', '07')).toBe('r/07')
    expect(ticketId('r', 123)).toBe('r/123')
  })
})

describe('plannedFromRun', () => {
  const body = (blocked = '') =>
    `cites:\nblocked_by: ${blocked}\nstories:\ntouches: the module\n## What to build\n\nIt.\n\n## Acceptance criteria\n\n- [ ] works\n\n## Checks\n\n- \`make test\`\n`
  const files = [
    { name: '02.md', path: 'p/02.md', text: `title: Two\n${body('1')}` },
    { name: '01.md', path: 'p/01.md', text: `title: One\n${body()}` },
    { name: '03.md', path: 'p/03.md', text: 'no header' },
    { name: '4.md', path: 'p/4.md', text: `title: Four\n${body('2')}` },
    { name: '05.md', path: 'p/05.md', text: `title: Five\n${body()}Edit src/a.ts.\n` },
  ]

  test('plans every file that passes its own checks, in order, with blockers as ids', () => {
    expect(plannedFromRun('r', files, new Set())).toEqual({
      planned: [
        { id: 'r/01', run: 'r', file: 'p/01.md', title: 'One', blockedBy: [] },
        { id: 'r/02', run: 'r', file: 'p/02.md', title: 'Two', blockedBy: ['r/01'] },
        { id: 'r/04', run: 'r', file: 'p/4.md', title: 'Four', blockedBy: ['r/02'] },
      ],
      // #st-ticket-partial: a ticket that fails its own checks stays off the board.
      failed: [
        { name: '03.md', failures: ['title: no title line'] },
        { name: '05.md', failures: ['no-file-paths: names file paths: src/a.ts (line 17)'] },
      ],
    })
  })

  test('skips a ticket the board already has', () => {
    expect(plannedFromRun('r', files, new Set(['r/01', 'r/02', 'r/03', 'r/04', 'r/05']))).toEqual({ planned: [], failed: [] })
  })
})

describe('plannedIds', () => {
  test('is every planned ticket id, archived ones included, and nothing else', () => {
    const ev = (type: string, payload: unknown, seq: number) => ({ seq, at: '', actor: 'agent', type, payload }) as BoardEvent
    const events = [
      ev('ticket.planned', { id: 'r/01', run: 'r', file: 'f', title: 'One', blockedBy: [] }, 1),
      ev('ticket.planned', { id: 'r/02', run: 'r', file: 'f', title: 'Two', blockedBy: [] }, 2),
      ev('ticket.archived', { id: 'r/02' }, 3),
      ev('ticket.moved', { id: 'r/09', to: 'ready' }, 4),
    ]
    expect([...plannedIds(events)]).toEqual(['r/01', 'r/02'])
    expect(plannedIds([]).size).toBe(0)
  })
})

describe('summarizeLogLine', () => {
  test('reads the rest of the stream-json shapes', () => {
    expect(summarizeLogLine(JSON.stringify({ type: 'user', message: { content: 'go on' } }))).toBe('← go on')
    expect(summarizeLogLine(JSON.stringify({ type: 'assistant', message: { content: 'plain' } }))).toBe('plain')
    const failed = { type: 'user', message: { content: [{ type: 'tool_result', is_error: true, content: [{ text: 'exit 1' }, { type: 'image' }] }] } }
    expect(summarizeLogLine(JSON.stringify(failed))).toBe('✗ exit 1')
    const bare = { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'TodoWrite' }, { type: 'text', text: '  ' }] } }
    expect(summarizeLogLine(JSON.stringify(bare))).toBe('▸ TodoWrite')
    expect(summarizeLogLine(JSON.stringify({ type: 'assistant', message: {} }))).toBeUndefined()
    expect(summarizeLogLine(JSON.stringify({ type: 'system', subtype: 'init', session_id: 's1' }))).toBe('session s1 started')
    expect(summarizeLogLine(JSON.stringify({ type: 'system', subtype: 'init' }))).toBe('session  started')
    expect(summarizeLogLine(JSON.stringify({ type: 'result' }))).toBe('result:')
  })

  test('reads the overseer\'s other acts', () => {
    expect(summarizeLogLine(JSON.stringify({ type: 'werk_overseer', kind: 'progress', looping: false }))).toBe('overseer: progress ok')
    expect(summarizeLogLine(JSON.stringify({ type: 'werk_overseer', kind: 'progress', looping: true }))).toBe('overseer: looping —')
    expect(summarizeLogLine(JSON.stringify({ type: 'werk_overseer', kind: 'frozen' }))).toBe('overseer: stopped: used no CPU')
    expect(summarizeLogLine(JSON.stringify({ type: 'werk_overseer', kind: 'ask', allow: true }))).toBe('overseer: allowed')
    expect(summarizeLogLine(JSON.stringify({ type: 'werk_overseer', kind: 'budget', reason: 'cap reached' }))).toBe('overseer: budget — cap reached')
    expect(summarizeLogLine(JSON.stringify({ type: 'werk_overseer' }))).toBe('overseer:')
  })

  test('shows a JSON value that is not an event as itself', () => {
    expect(summarizeLogLine('42')).toBe('42')
    expect(summarizeLogLine('null')).toBe('null')
    expect(summarizeLogLine(JSON.stringify({ kind: 'other', n: 1 }))).toBe('{"kind":"other","n":1}')
    expect(summarizeLogLine('   ')).toBeUndefined()
  })

  test('reads Claude Code stream-json', () => {
    const asst = { type: 'assistant', message: { content: [{ type: 'text', text: 'Reading the board.' }, { type: 'tool_use', name: 'Bash', input: { command: 'bun test' } }] } }
    expect(summarizeLogLine(JSON.stringify(asst))).toBe('Reading the board.\n▸ Bash bun test')
    const user = { type: 'user', message: { content: [{ type: 'tool_result', content: '3 pass', is_error: false }] } }
    expect(summarizeLogLine(JSON.stringify(user))).toBe('← 3 pass')
    expect(summarizeLogLine(JSON.stringify({ type: 'result', subtype: 'success', result: 'done' }))).toBe('result: success — done')
    expect(summarizeLogLine(JSON.stringify({ type: 'system', subtype: 'hook' }))).toBeUndefined()
  })

  test('reads the overseer\'s lines', () => {
    expect(summarizeLogLine(JSON.stringify({ type: 'werk_overseer', kind: 'progress', looping: true, reason: 'same edit 3 times' }))).toBe('overseer: looping — same edit 3 times')
    expect(summarizeLogLine(JSON.stringify({ type: 'werk_overseer', kind: 'ask', tool: 'Bash', allow: false, comment: 'outside the tree' }))).toBe('overseer: denied Bash — outside the tree')
    expect(summarizeLogLine(JSON.stringify({ type: 'werk_overseer', kind: 'frozen', tool: 'Bash', act: 'kill the call' }))).toBe('overseer: kill the call: Bash used no CPU')
  })

  test('keeps a line it does not know, clipped', () => {
    expect(summarizeLogLine('plain text')).toBe('plain text')
    expect(summarizeLogLine('')).toBeUndefined()
    expect(summarizeLogLine(JSON.stringify({ text: 'builder note' }))).toBe('builder note')
    expect(summarizeLogLine('x'.repeat(500))!.length).toBe(240)
  })
})
