import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { appendBoard, foldBoard, readBoard } from './board.ts'
import { fold } from './fold.ts'
import { fakeClaude, makeRepo, readJsonl, runCli, writeLog } from './testing/fixture.ts'
import type { FakeRule } from './testing/fake-claude.ts'
import { SPEC, ticket } from './testing/samples.ts'

const DECISION = JSON.stringify([{ id: 'root-store', title: 'Items are kept in one JSON file', why: 'No card says where.', body: 'One file.' }])

function plannerRules(tickets: Record<string, string>): FakeRule[] {
  return [
    { match: 'You are the spec writer', files: { '.werk/specs/root.md': SPEC, '.werk/specs/root.decisions.json': DECISION } },
    { match: 'You are the ticket writer', files: { ...Object.fromEntries(Object.entries(tickets).map(([n, t]) => [`.werk/tickets/root/${n}.md`, t])), '.werk/specs/root.ticket-decisions.json': '[]' } },
  ]
}

describe('werk plan', () => {
  test('writes a spec, then tickets from it, and puts each valid ticket on the board', async () => {
    const repo = makeRepo()
    writeLog(repo, [{ id: 'root' }, { id: 'kid', parent: 'root', dependsOn: ['root'] }])
    const fake = fakeClaude(
      plannerRules({
        '01': ticket({ title: 'List', cites: 'root', stories: '1' }),
        '02': ticket({ title: 'Add', cites: 'kid', blocked: '01', stories: '2' }),
      }),
    )
    const r = await runCli(repo, fake, ['plan', 'root'])
    expect(r.code).toBe(0)
    const out = JSON.parse(r.stdout)
    expect(out.ok).toBe(true)
    expect(out.planned).toEqual(['root/01', 'root/02'])
    expect(out.checks.find((c: { file: string }) => c.file === '(stories)').detail).toBe('every one of 2 stories is delivered')

    const board = readJsonl(join(repo, '.werk', 'board.jsonl'))
    expect(board.filter((e) => e.type === 'ticket.planned').map((e) => e.payload)).toEqual([
      { id: 'root/01', run: 'root', file: '.werk/tickets/root/01.md', title: 'List', blockedBy: [] },
      { id: 'root/02', run: 'root', file: '.werk/tickets/root/02.md', title: 'Add', blockedBy: ['root/01'] },
    ])
    // #vi-board-plan: the plan's start, each step with its agent log, and its end.
    expect(board.filter((e) => e.type.startsWith('plan.')).map((e) => [e.type, (e.payload as { step?: string; result?: string; log?: string })])).toEqual([
      ['plan.started', expect.objectContaining({ run: 'root' })],
      ['plan.step', { run: 'root', step: 'spec', log: '.werk/plans/root/1/spec-writer.jsonl' }],
      ['plan.step', { run: 'root', step: 'tickets', log: '.werk/plans/root/1/ticket-writer.jsonl' }],
      ['plan.step', { run: 'root', step: 'checks' }],
      ['plan.ended', { run: 'root', result: 'ok', planned: ['root/01', 'root/02'], archived: [] }],
    ])
    // #st-ticket-watch: each ticket's cited cards, as the plan read them.
    const cites = board.filter((e) => e.type === 'ticket.cites').map((e) => e.payload as { id: string; cards: Record<string, { deps: string[] }> })
    expect(cites.map((c) => [c.id, Object.keys(c.cards)])).toEqual([['root/01', ['root']], ['root/02', ['kid']]])
    expect(cites[1].cards.kid.deps).toEqual(['root'])

    // The ticket writer works from the spec, with the story numbers it must cover.
    const [specCall, ticketCall] = fake.calls()
    expect(specCall.prompt).toContain('<spec-template>')
    expect(ticketCall.prompt).toContain('People lose track.')
    expect(ticketCall.prompt).toContain('delivered by at least one ticket: 1, 2')
    // #st-build-parallel, #werk-stack-modules: the writer names the modules, small ones, and
    // knows that a shared one keeps two tickets from building at once.
    expect(ticketCall.prompt).toContain('touches: <comma-separated names of the modules this ticket changes')
    expect(ticketCall.prompt).toContain('Two tickets that share a module never build at the same time')
    expect(ticketCall.prompt).toContain('small, single-purpose modules')

    // #st-spec: an answer no card gives becomes a proposed card under the subtree.
    const g = fold(readJsonl(join(repo, '.werk', 'log.jsonl')))
    expect(g.proposed.has('root-store')).toBe(true)
    expect(g.nodes.get('root-store')).toMatchObject({ title: 'Items are kept in one JSON file', who: 'me' })
    expect(g.ghostEdges).toContainEqual({ from: 'root-store', to: 'root', type: 'refines' })
    expect(out.proposed).toEqual([{ id: 'root-store', ok: true, detail: expect.stringContaining('proposed card root-store') }])

    // #st-ticket-own-checks: one record per ticket file, with one named result per check.
    const record = JSON.parse(readFileSync(join(repo, '.werk', 'tickets', 'root', 'checks.json'), 'utf8'))
    expect(record.map((r: { file: string }) => r.file)).toEqual(['01.md', '02.md'])
    expect(record[0].chars).toBeGreaterThan(0)
    expect(record[0].checks.map((c: { check: string; ok: boolean }) => [c.check, c.ok])).toEqual([
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

  test('checks.json records a failed ticket too; one with no title has only the title result', async () => {
    const repo = makeRepo()
    writeLog(repo, [{ id: 'root' }])
    const fake = fakeClaude(
      plannerRules({ '01': ticket({ title: 'List', cites: 'root', stories: '1, 2' }) + 'Edit src/list.ts.\n', '02': 'no title\n' }),
    )
    const r = await runCli(repo, fake, ['plan', 'root'])
    expect(r.code).toBe(1)
    const record = JSON.parse(readFileSync(join(repo, '.werk', 'tickets', 'root', 'checks.json'), 'utf8'))
    expect(record[0].checks.find((c: { check: string }) => c.check === 'no-file-paths')).toMatchObject({ ok: false, detail: expect.stringContaining('src/list.ts (line') })
    expect(record[1]).toEqual({ file: '02.md', chars: 9, checks: [{ check: 'title', ok: false, detail: 'no title line' }] })
    expect(JSON.parse(r.stdout).planned).toEqual([])
  })

  test('a second plan of the subtree extends the first: open tickets in place, a started one untouched, an unneeded one archived (#st-plan-extend)', async () => {
    const repo = makeRepo()
    writeLog(repo, [{ id: 'root' }, { id: 'kid', parent: 'root' }])
    const first = fakeClaude(
      plannerRules({
        '01': ticket({ title: 'List', cites: 'root', stories: '1' }),
        '02': ticket({ title: 'Add', cites: 'kid', stories: '2' }),
        '03': ticket({ title: 'Extra', cites: 'kid', stories: '' }),
      }),
    )
    expect((await runCli(repo, first, ['plan', 'root'])).code).toBe(0)
    const boardPath = join(repo, '.werk', 'board.jsonl')
    appendBoard('ticket.moved', { id: 'root/01', to: 'building' }, { path: boardPath })
    const started = readFileSync(join(repo, '.werk', 'tickets', 'root', '01.md'), 'utf8')

    const second = fakeClaude([
      { match: 'You are the spec writer', files: { '.werk/specs/root.md': SPEC, '.werk/specs/root.decisions.json': '[]' } },
      {
        match: 'You are the ticket writer',
        files: {
          '.werk/specs/root.ticket-decisions.json': '[]',
          '.werk/tickets/root/01.md': ticket({ title: 'Changed while building', cites: 'root', stories: '1' }),
          '.werk/tickets/root/02.md': ticket({ title: 'Add an item', cites: 'kid', stories: '2' }),
          '.werk/tickets/root/04.md': ticket({ title: 'Edit', cites: 'kid', blocked: '02', stories: '' }),
          '.werk/tickets/root/archive.json': '[3, 1]',
        },
      },
    ])
    const r = await runCli(repo, second, ['plan', 'root'])
    expect(r.code).toBe(0)
    const out = JSON.parse(r.stdout)
    expect(out.run).toBe('root')
    expect(out.planned).toEqual(['root/02', 'root/04'])
    expect(out.archived).toEqual(['root/03'])

    // Both writers saw what the first plan left.
    const [specCall, ticketCall] = second.calls()
    expect(specCall.prompt).toContain('## The current spec of this subtree')
    expect(ticketCall.prompt).toContain('Started to build (building, merging, done): 01.')
    expect(ticketCall.prompt).toContain('Open (ready, blocked): 02, 03.')
    expect(ticketCall.prompt).toContain('from 04 up')

    // The ticket that started to build keeps its text; the archive list is consumed.
    expect(readFileSync(join(repo, '.werk', 'tickets', 'root', '01.md'), 'utf8')).toBe(started)
    expect(existsSync(join(repo, '.werk', 'tickets', 'root', 'archive.json'))).toBe(false)

    const b = foldBoard(readBoard(boardPath))
    expect([...b.tickets.keys()]).toEqual(['root/01', 'root/02', 'root/03', 'root/04'])
    expect(b.tickets.get('root/01')).toMatchObject({ title: 'List', column: 'building' })
    expect(b.tickets.get('root/02')).toMatchObject({ title: 'Add an item', column: 'ready' })
    expect(b.tickets.get('root/03')).toMatchObject({ archived: true, reason: 'the current spec of #root no longer needs it' })
    expect(b.tickets.get('root/04')).toMatchObject({ column: 'blocked', blockedBy: ['root/02'] })

    // #ms-store-scope: each plan's start lists the cards it read, with tier and log position.
    const pipeline = readJsonl(join(repo, '.werk', 'pipeline.jsonl'))
    expect(pipeline.map((e) => [e.seq, e.type, e.payload.step, e.payload.name])).toEqual([
      [1, 'step.started', 'plan', undefined],
      [2, 'step.ended', 'session', 'spec-writer'],
      [3, 'step.ended', 'session', 'ticket-writer'],
      [4, 'step.ended', 'plan', undefined],
      [5, 'step.started', 'plan', undefined],
      [6, 'step.ended', 'session', 'spec-writer'],
      [7, 'step.ended', 'session', 'ticket-writer'],
      [8, 'step.ended', 'plan', undefined],
    ])
    // #ms-cost, #ms-store-files: each writer session names its own transcript and the spec.
    expect(pipeline[5].payload).toMatchObject({ build: 'root@5', ticket: 'root', result: 'ok', file: '.werk/plans/root/5/spec-writer.jsonl' })
    expect(pipeline[4].payload).toMatchObject({
      subtree: 'root',
      scope: [
        { id: 'root', tier: 1, seq: expect.any(Number) },
        { id: 'kid', tier: 1, seq: expect.any(Number) },
      ],
      size: { tier1: 2, tier2: 0, chars: expect.any(Number) },
    })
    // #ms-store-plancopy: each plan's end names its copy, which holds only what it changed.
    expect(pipeline[3].payload).toMatchObject({ plan: 1, result: 'ok', file: '.werk/plans/root/1' })
    expect(pipeline[7].payload).toMatchObject({ plan: 5, result: 'ok', file: '.werk/plans/root/5' })
    const first1 = join(repo, '.werk', 'plans', 'root', '1')
    expect(JSON.parse(readFileSync(join(first1, 'copy.json'), 'utf8'))).toEqual({ spec: 'new', tickets: { '01': 'new', '02': 'new', '03': 'new' } })
    const copy3 = join(repo, '.werk', 'plans', 'root', '5')
    expect(JSON.parse(readFileSync(join(copy3, 'copy.json'), 'utf8'))).toEqual({ spec: 'kept', tickets: { '02': 'changed', '03': 'archived', '04': 'new' } })
    expect(readFileSync(join(copy3, '02.md'), 'utf8')).toContain('Add an item')
    expect(existsSync(join(copy3, 'spec.md'))).toBe(false)
    expect(existsSync(join(copy3, '01.md'))).toBe(false)
  })

  test('plan refuses --run: the subtree id is the key', async () => {
    const repo = makeRepo()
    writeLog(repo, [{ id: 'root' }])
    const r = await runCli(repo, fakeClaude([]), ['plan', 'root', '--run', 'x'])
    expect(r.code).not.toBe(0)
    expect(r.stderr).toContain('plan takes no --run')
  })

  test('a failed blocked_by check puts the tickets it names in blocked, with the check as the reason', async () => {
    const repo = makeRepo()
    writeLog(repo, [{ id: 'root' }, { id: 'kid', parent: 'root', dependsOn: ['root'] }, { id: 'other', parent: 'root' }])
    const fake = fakeClaude(
      plannerRules({
        '01': ticket({ title: 'List', cites: 'root', stories: '1' }),
        '02': ticket({ title: 'Add', cites: 'kid', stories: '2', blocked: '7' }),
        '03': ticket({ title: 'Other', cites: 'other', stories: '' }),
      }),
    )
    const r = await runCli(repo, fake, ['plan', 'root'])
    expect(r.code).toBe(1)
    expect(JSON.parse(r.stdout).planned).toEqual(['root/01', 'root/02', 'root/03'])
    const moved = readJsonl(join(repo, '.werk', 'board.jsonl')).filter((e) => e.type === 'ticket.moved')
    // Only the ticket with the blocker that is not in the set: the others are not wrong.
    expect(moved.map((e) => e.payload)).toEqual([
      { id: 'root/02', to: 'blocked', reason: expect.stringContaining('set check blocked_by failed: no such ticket: 02.md → 7'), check: 'blocked_by' },
    ])
  })

  test('a stale or postponed card is out of the scope: not shown, not required to be cited', async () => {
    const repo = makeRepo()
    writeLog(
      repo,
      [
        { id: 'root' },
        { id: 'base' },
        { id: 'mid', dependsOn: ['base'] },
        { id: 'kid', parent: 'root', dependsOn: ['mid'], body: 'the stale body' },
        { id: 'pbase' },
        { id: 'pmid', dependsOn: ['pbase'] },
        { id: 'pkid', parent: 'root', dependsOn: ['pmid'], body: 'the postponed body' },
      ],
      [
        // A stale mark goes one hop (#vi-prop), so the reopen is on the card kid depends on.
        { type: 'reopened', payload: { id: 'mid', reason: 'invalidated' } },
        { type: 'reopened', payload: { id: 'pbase', reason: 'postponed' } },
      ],
    )
    const g = fold(readJsonl(join(repo, '.werk', 'log.jsonl')))
    expect([g.stale.has('kid'), g.postponed.has('pkid')]).toEqual([true, true])
    const fake = fakeClaude(plannerRules({ '01': ticket({ title: 'List', cites: 'root', stories: '1, 2' }) }))
    const r = await runCli(repo, fake, ['plan', 'root'])
    expect(r.code).toBe(0)
    expect(JSON.parse(r.stdout).checks).toContainEqual({ file: '(coverage)', check: 'cards-cited', ok: true, detail: 'every decided card is cited' })
    const [specCall] = fake.calls()
    expect(specCall.prompt).not.toContain('the stale body')
    expect(specCall.prompt).not.toContain('the postponed body')
  })

  test('the spec writer runs under the silence limit (#lp-overseer)', async () => {
    const repo = makeRepo()
    writeLog(repo, [{ id: 'root' }])
    const fake = fakeClaude([{ match: 'You are the spec writer', hangMs: 5000 }])
    const r = await runCli(repo, fake, ['plan', 'root', '--silence', '0.3'])
    expect(r.code).toBe(1)
    expect(JSON.parse(r.stdout)).toMatchObject({ ok: false, reason: 'agent-error', step: 'spec', error: expect.stringContaining('no event') })
  })

  test('an undelivered story fails the run, but a valid ticket still goes on the board', async () => {
    const repo = makeRepo()
    writeLog(repo, [{ id: 'root' }])
    const fake = fakeClaude(
      plannerRules({
        '01': ticket({ title: 'List', cites: 'root', stories: '1' }),
        '02': ticket({ title: 'Bad', cites: 'root', stories: '', checks: '- `bun test`' }),
      }),
    )
    const r = await runCli(repo, fake, ['plan', 'root'])
    expect(r.code).toBe(1)
    expect(r.stderr).toContain('FAIL  (stories)  not delivered: 2')
    expect(r.stderr).toContain('FAIL  02.md  not a make target')
    expect(JSON.parse(r.stdout).planned).toEqual(['root/01'])
  })

  test('a ticket that fails its own checks is out of the set: its stories do not count, and as a blocker it dangles', async () => {
    const repo = makeRepo()
    writeLog(repo, [{ id: 'root' }])
    const fake = fakeClaude(
      plannerRules({
        '01': ticket({ title: 'Bad', cites: 'root', stories: '1', checks: '- `bun test`' }),
        '02': ticket({ title: 'Add', cites: 'root', blocked: '01', stories: '2' }),
      }),
    )
    const r = await runCli(repo, fake, ['plan', 'root'])
    expect(r.code).toBe(1)
    expect(r.stderr).toContain('FAIL  (stories)  not delivered: 1')
    expect(r.stderr).toContain('02.md → 1')
  })

  test('a spec with no user stories stops the run before the ticket writer', async () => {
    const repo = makeRepo()
    writeLog(repo, [{ id: 'root' }])
    const fake = fakeClaude([{ match: 'You are the spec writer', files: { '.werk/specs/root.md': '## Problem Statement\n\nx\n', '.werk/specs/root.decisions.json': '[]' } }])
    const r = await runCli(repo, fake, ['plan', 'root'])
    expect(r.code).toBe(1)
    expect(JSON.parse(r.stdout)).toMatchObject({ ok: false, reason: 'spec-invalid' })
    expect(fake.calls()).toHaveLength(1)
  })

  test('stops before any agent call when the subtree holds an open card', async () => {
    const repo = makeRepo()
    writeLog(repo, [{ id: 'root' }, { id: 'kid', parent: 'root', status: 'open' }])
    const fake = fakeClaude([])
    const r = await runCli(repo, fake, ['plan', 'root'])
    expect(JSON.parse(r.stdout)).toEqual({ ok: false, reason: 'blocked', blockedBy: ['kid'] })
    expect(fake.calls()).toHaveLength(0)
    // The plan still records its start and end, with no copy: no writer ran.
    const pipeline = readJsonl(join(repo, '.werk', 'pipeline.jsonl'))
    expect(pipeline.map((e) => [e.type, e.payload.result, e.payload.file])).toEqual([
      ['step.started', undefined, undefined],
      ['step.ended', 'blocked', undefined],
    ])
  })
  test('a card the subtree links is in scope: read in full and cited like a subtree card', async () => {
    const repo = makeRepo()
    writeLog(repo, [
      { id: 'root', body: 'Builds #ref.' },
      { id: 'dep', body: 'the dep body' },
      { id: 'ref', body: 'the ref body' },
      { id: 'far', body: 'two hops out' },
      { id: 'kid', parent: 'root', dependsOn: ['dep'] },
      { id: 'other', dependsOn: ['far'] },
    ])
    const fake = fakeClaude(plannerRules({ '01': ticket({ title: 'List', cites: 'root, kid', stories: '1, 2' }) }))
    const r = await runCli(repo, fake, ['plan', 'root'])
    const out = JSON.parse(r.stdout)
    expect(out.checks).toContainEqual({ file: '(coverage)', check: 'cards-cited', ok: false, detail: 'not cited: ref, dep' })
    const [specCall] = fake.calls()
    expect(specCall.prompt).toContain('## Cards the subtree links')
    expect(specCall.prompt).toContain('the dep body')
    expect(specCall.prompt).toContain('the ref body')
    expect(specCall.prompt).not.toContain('two hops out')
  })

  test('an open card the subtree links stops the run before any agent call', async () => {
    const repo = makeRepo()
    writeLog(repo, [{ id: 'root', dependsOn: ['dep'] }, { id: 'dep', status: 'open' }])
    const fake = fakeClaude([])
    const r = await runCli(repo, fake, ['plan', 'root'])
    expect(JSON.parse(r.stdout)).toEqual({ ok: false, reason: 'blocked', blockedBy: ['dep'] })
    expect(fake.calls()).toHaveLength(0)
  })

  test('an agent error at the spec step stops the run before the ticket writer', async () => {
    const repo = makeRepo()
    writeLog(repo, [{ id: 'root' }])
    const fake = fakeClaude([{ match: 'You are the spec writer', exitCode: 1, stderr: 'spec writer crashed' }])
    const r = await runCli(repo, fake, ['plan', 'root'])
    expect(r.code).toBe(1)
    expect(JSON.parse(r.stdout)).toEqual({ ok: false, reason: 'agent-error', step: 'spec', error: 'spec writer crashed' })
    expect(fake.calls()).toHaveLength(1)
    // #vi-board-plan: the board shows the plan stopped, with the failed step. No ticket.
    const board = readJsonl(join(repo, '.werk', 'board.jsonl'))
    expect(board.filter((e) => !e.type.startsWith('plan.'))).toEqual([])
    expect(board.at(-1)).toMatchObject({ type: 'plan.ended', payload: { run: 'root', result: 'agent-error', step: 'spec', detail: 'spec writer crashed' } })
  })

  test('an agent error at the ticket step puts nothing on the board', async () => {
    const repo = makeRepo()
    writeLog(repo, [{ id: 'root' }])
    const fake = fakeClaude([
      plannerRules({})[0],
      { match: 'You are the ticket writer', files: { '.werk/tickets/root/01.md': ticket({ title: 'List', cites: 'root', stories: '1, 2' }) }, exitCode: 1, stderr: 'ticket writer crashed' },
    ])
    const r = await runCli(repo, fake, ['plan', 'root'])
    expect(r.code).toBe(1)
    expect(JSON.parse(r.stdout)).toEqual({ ok: false, reason: 'agent-error', step: 'tickets', error: 'ticket writer crashed' })
    expect(fake.calls()).toHaveLength(2)
    // The ticket it wrote before it failed is not planned.
    const board = readJsonl(join(repo, '.werk', 'board.jsonl'))
    expect(board.filter((e) => !e.type.startsWith('plan.'))).toEqual([])
    expect(board.at(-1)).toMatchObject({ type: 'plan.ended', payload: { result: 'agent-error', step: 'tickets' } })
  })

  // #st-spec-decisions-answers-file: a missing or malformed answers file stops the plan before
  // the next writer starts.
  test('a malformed answers file of the spec writer stops the plan before the ticket writer', async () => {
    const repo = makeRepo()
    writeLog(repo, [{ id: 'root' }])
    const fake = fakeClaude([
      { match: 'You are the spec writer', files: { '.werk/specs/root.md': SPEC, '.werk/specs/root.decisions.json': '[{"id": "root-x",' } },
    ])
    await runCli(repo, fake, ['plan', 'root'])
    const board = readJsonl(join(repo, '.werk', 'board.jsonl'))
    expect(board.at(-1)).toMatchObject({ type: 'plan.ended', payload: { result: 'agent-error', step: 'spec' } })
    expect(board.at(-1).payload.detail).toMatch(/root\.decisions\.json is not valid JSON: /)
    expect(fold(readJsonl(join(repo, '.werk', 'log.jsonl'))).proposed.size).toBe(0)
  })

  test('a ticket writer that writes no answers file fails the plan, and an empty list does not', async () => {
    const repo = makeRepo()
    writeLog(repo, [{ id: 'root' }])
    const fake = fakeClaude([
      { match: 'You are the spec writer', files: { '.werk/specs/root.md': SPEC, '.werk/specs/root.decisions.json': '[]' } },
      { match: 'You are the ticket writer', files: { '.werk/tickets/root/01.md': ticket({ title: 'List', cites: 'root', stories: '1, 2' }) } },
    ])
    await runCli(repo, fake, ['plan', 'root'])
    const board = readJsonl(join(repo, '.werk', 'board.jsonl'))
    expect(board.at(-1)).toMatchObject({ type: 'plan.ended', payload: { result: 'agent-error', step: 'tickets' } })
    expect(board.at(-1).payload.detail).toMatch(/wrote no answers file/)
  })
})
