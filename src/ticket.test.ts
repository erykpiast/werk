import { describe, expect, test } from 'bun:test'
import { checkTicket, checkTicketFile, checkTicketSet, filePaths, parseTicket, ticketChecks, touchesOverlap } from './ticket.ts'
import { PRODUCTION_RUBRIC } from './rubric.ts'
import type { ParsedTicket } from './ticket.ts'

const text = (over: Partial<Record<'cites' | 'blocked' | 'stories' | 'touches' | 'extra' | 'checks', string>> = {}) => `title: Show the balance
cites: ${over.cites ?? 'a, #b'}
blocked_by: ${over.blocked ?? ''}
stories: ${over.stories ?? '1, 3'}
touches: ${over.touches ?? 'balance view, Payment ledger'}
${over.extra ?? ''}
## What to build

A customer opens the app and sees the balance.

## Acceptance criteria

- [ ] The balance shows on open
- [x] It updates after a payment

## Checks

${over.checks ?? '- `make test`'}
`

const ticket = (file: string, over: Parameters<typeof text>[0] = {}) => parseTicket(file, text(over))!

describe('parseTicket', () => {
  test('reads every #st-ticket field', () => {
    const t = ticket('01.md', { blocked: '02, #03' })
    expect(t).toMatchObject({
      num: 1,
      title: 'Show the balance',
      cites: ['a', 'b'],
      blockedBy: [2, 3],
      stories: [1, 3],
      touches: ['balance view', 'Payment ledger'],
      whatToBuild: 'A customer opens the app and sees the balance.',
      acceptance: ['The balance shows on open', 'It updates after a payment'],
      checks: ['make test'],
      namesFiles: false,
    })
  })

  test('no title is no ticket', () => {
    expect(parseTicket('01.md', 'cites: a')).toBeUndefined()
  })

  test('a ticket with no checks gets the rubric default: the rubric check list', () => {
    expect(ticketChecks(ticket('01.md', { checks: '' }))).toEqual([...PRODUCTION_RUBRIC.checks])
  })

  test('an empty stories line is an empty list, not an invented story', () => {
    expect(ticket('01.md', { stories: '' }).stories).toEqual([])
  })
})

describe('checkTicket', () => {
  const failing = (over: Parameters<typeof text>[0] = {}, pad = 0) => {
    const body = text(over) + 'x'.repeat(pad)
    return checkTicket(parseTicket('01.md', body)!, body).filter((c) => !c.ok).map((c) => `${c.check}: ${c.detail}`)
  }

  test('a well-formed ticket passes every check, each result named', () => {
    const body = text()
    expect(checkTicket(parseTicket('01.md', body)!, body).map((c) => [c.check, c.ok])).toEqual([
      ['title', true],
      ['shape', true],
      ['size', true],
      ['what-to-build', true],
      ['acceptance', true],
      ['no-file-paths', true],
      ['make-targets', true],
      ['touches', true],
    ])
  })

  test('a files: line, a tool call as a check, and a long ticket fail', () => {
    const over = { extra: 'files: src/a.ts', checks: '- `bun test`' }
    const pad = 4001 - text(over).length
    expect(failing(over, pad)).toEqual([
      'size: 4001 chars',
      'no-file-paths: names file paths: a "files:" line (line 6), src/a.ts (line 6)',
      'make-targets: not a make target (#lp-checks-scripts): bun test',
    ])
  })

  test('a ticket with no touches line, or an empty one, fails the touches check (#st-build-parallel)', () => {
    expect(failing({ touches: '' })).toEqual(['touches: no "touches:" module names (#st-build-parallel)'])
    const body = text().replace(/^touches:.*\n/m, '')
    expect(checkTicket(parseTicket('01.md', body)!, body).find((c) => c.check === 'touches')).toMatchObject({ ok: false })
  })

  test('a module name that reads as a file path fails the touches check, a folder or a file name included', () => {
    expect(failing({ touches: 'balance view, src/gridsys, run.ts' })).toEqual(['touches: a module name is a file path: src/gridsys, run.ts'])
  })

  test('a missing header line or section heading fails the shape check, and each one is named (#st-ticket-shape)', () => {
    const body = text()
      .replace(/^blocked_by:.*\n/m, '')
      .replace(/^stories:.*\n/m, '')
      .replace('## Checks', '')
    const shape = checkTicket(parseTicket('01.md', body)!, body).find((c) => c.check === 'shape')
    expect(shape).toEqual({ file: '01.md', check: 'shape', ok: false, detail: 'missing (#st-ticket-shape): blocked_by:, stories:, ## Checks' })
  })

  test('an empty header line passes the shape check, and a heading matches in any case', () => {
    const body = text({ cites: '', stories: '' }).replace('## What to build', '## what to build')
    expect(failing({ cites: '', stories: '' })).toEqual([])
    expect(checkTicket(parseTicket('01.md', body)!, body).find((c) => c.check === 'shape')!.ok).toBe(true)
  })

  test('an empty Checks section passes; the ticket then uses the default checks', () => {
    expect(failing({ checks: '' })).toEqual([])
  })

  test('a file with no title gets only the title result', () => {
    expect(checkTicketFile('01.md', 'cites: a').checks).toEqual([{ file: '01.md', check: 'title', ok: false, detail: 'no title line' }])
  })
})

describe('filePaths (#st-ticket-own-checks no-file-paths)', () => {
  test('finds a path or a glob in the body, with its line number', () => {
    expect(filePaths('Change the loop.\nEdit `src/loop.ts` and every src/*.ts file.')).toEqual([
      { path: 'src/loop.ts', line: 2 },
      { path: 'src/*.ts', line: 2 },
    ])
  })

  test('a URL, a bare file name, a slash command, a card id, a make target, and a folder do not count', () => {
    expect(filePaths('See https://example.com/a/b.html and Makefile. Run /implement for #st-ticket via make test in src/gridsys.')).toEqual([])
  })

  test('a path in the body fails the ticket, and the failure lists it with its line', () => {
    const body = text({ extra: 'Touch web/app.js.' })
    const c = checkTicket(parseTicket('01.md', body)!, body).find((x) => x.check === 'no-file-paths')!
    expect(c).toMatchObject({ ok: false, detail: 'names file paths: web/app.js (line 6)' })
  })
})

describe('checkTicketSet', () => {
  const ctx = { cardIds: ['a', 'b'], stories: [1, 2, 3] }
  const failing = (tickets: ParsedTicket[], c = ctx) => checkTicketSet(tickets, c).filter((x) => !x.ok).map((x) => x.detail)

  test('every card cited and every story delivered passes', () => {
    expect(failing([ticket('01.md'), ticket('02.md', { stories: '2' })])).toEqual([])
  })

  test('an undelivered story fails, and so does a story the spec does not have', () => {
    expect(failing([ticket('01.md')])).toEqual(['not delivered: 2'])
    expect(failing([ticket('01.md', { stories: '1, 2, 3, 9' })])).toEqual(['not in the spec: 9'])
  })

  test('an uncited card fails', () => {
    expect(failing([ticket('01.md', { cites: 'a', stories: '1,2,3' })])).toEqual(['not cited: b'])
  })

  test('blocked_by must name tickets in the set and have no cycle', () => {
    const cyc1 = ticket('01.md', { cites: 'a', stories: '1,2,3', blocked: '2' })
    const cyc2 = ticket('02.md', { cites: 'b', stories: '', blocked: '1' })
    expect(failing([cyc1, cyc2])).toEqual(['blocked_by has a cycle'])
    expect(failing([ticket('01.md', { stories: '1,2,3', blocked: '7' })])).toEqual(['no such ticket: 01.md → 7'])
  })

  test('the order is the planner’s: no blocker, or a blocker no card edge explains, passes', () => {
    const one = ticket('01.md', { cites: 'a', stories: '1,2,3' })
    expect(failing([one, ticket('02.md', { cites: 'b', stories: '' })])).toEqual([])
    expect(failing([one, ticket('02.md', { cites: 'b', stories: '', blocked: '1' })])).toEqual([])
  })

  test('only a failed blocked_by check names tickets (#st-ticket-partial)', () => {
    const named = (tickets: ParsedTicket[], c = ctx) => checkTicketSet(tickets, c).filter((x) => !x.ok).map((x) => [x.check, x.tickets])
    // The tickets in a cycle, not the one outside it.
    const cyc1 = ticket('01.md', { cites: 'a', stories: '1,2,3', blocked: '2' })
    const cyc2 = ticket('02.md', { cites: 'b', stories: '', blocked: '1' })
    const tail = ticket('04.md', { cites: 'b', stories: '', blocked: '1' })
    expect(named([cyc1, cyc2, tail])).toEqual([['blocked_by', [1, 2]]])
    // The ticket with a blocker that is not in the set.
    expect(named([ticket('01.md', { stories: '1,2,3', blocked: '7' })])).toEqual([['blocked_by', [1]]])
    // Cards and stories name no ticket.
    expect(named([ticket('01.md', { cites: 'a', stories: '1' })])).toEqual([
      ['cards-cited', undefined],
      ['stories', undefined],
    ])
  })
})

describe('touchesOverlap (#st-build-parallel)', () => {
  test('two tickets overlap only on a shared module name, after trim and case-folding', () => {
    expect(touchesOverlap(['merge queue', 'board'], ['Ticket drawer'])).toBe(false)
    expect(touchesOverlap(['merge queue', 'board'], [' Board '])).toBe(true)
    // An exact name, not a part of one.
    expect(touchesOverlap(['board'], ['board view'])).toBe(false)
  })

  test('a ticket that names no module overlaps every ticket, so it builds alone', () => {
    expect(touchesOverlap([], ['board'])).toBe(true)
    expect(touchesOverlap(['board'], [])).toBe(true)
  })
})
