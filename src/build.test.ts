import { describe, expect, test } from 'bun:test'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { foldBoard } from './board.ts'
import { build } from './build.ts'
import { MAX_DIFF_CHARS } from './grade.ts'
import { followUpText } from './heldout-text.ts'
import type { BoardEvent } from './board.ts'
import { fold } from './fold.ts'
import { foldPasses, readPipeline } from './pipeline.ts'
import type { BuildStepEnded, PassFacts, PipelineEvent, StepRef } from './pipeline.ts'
import { stageOf } from './measures.ts'
import { fakeClaude, git, MAKEFILE, makeRepo, planTicket, readJsonl, runCli, startCli, writeLog } from './testing/fixture.ts'
import { JUDGES, SPEC, ticket } from './testing/samples.ts'

import type { FakeRule } from './testing/fake-claude.ts'

const judged = (rules: FakeRule[], judges: FakeRule[] = JUDGES) => fakeClaude([...judges, ...rules])

const FAST = ['--timeout', '20', '--silence', '5', '--check-timeout', '20']

function setup(o: { checks?: string; blockedBy?: string[] } = {}) {
  const repo = makeRepo({ Makefile: MAKEFILE })
  writeLog(
    repo,
    [{ id: 'root', body: 'The root decision.' }, { id: 'kid', parent: 'root', dependsOn: ['base'], body: 'Kid body.' }, { id: 'base', body: 'Base body.' }],
    [
      { type: 'node.added', payload: { id: 'kid:opt0', kind: 'option', title: 'Keep it in memory', why_not: 'it is lost on restart' } },
      { type: 'edge.added', payload: { from: 'kid:opt0', to: 'kid', type: 'alternative_to' } },
    ],
  )
  const id = planTicket(repo, { text: ticket({ title: 'List', cites: 'kid', stories: '2', checks: o.checks }), spec: SPEC, blockedBy: o.blockedBy })
  return { repo, id }
}

/** Append one board event, the way the board's own controls do. */
function appendBoard(repo: string, type: string, payload: Record<string, unknown>) {
  const seq = boardEvents(repo).length + 1
  appendFileSync(join(repo, '.werk', 'board.jsonl'), JSON.stringify({ seq, at: '2026-10-01T10:00:00.000Z', actor: 'you', type, payload }) + '\n')
}

const boardEvents = (repo: string) => readJsonl<BoardEvent>(join(repo, '.werk', 'board.jsonl'))
const boardOf = (repo: string) => foldBoard(boardEvents(repo))
const pipelineOf = (repo: string) => readPipeline(join(repo, '.werk', 'pipeline.jsonl'))
/** The passes, folded back from the pipeline log (#ms-store). Each gate's own record is
 *  untyped in a pass, so a test reads it the way it reads any JSON line. */
const passesOf = (repo: string): Array<PassFacts & Record<string, any>> => foldPasses(pipelineOf(repo))

describe('werk build', () => {
  test('builds a ticket in fresh passes until green, then moves it to merging', async () => {
    const { repo, id } = setup()
    const fake = judged([
      { match: 'You are pass 1 of', result: 'started' },
      { match: 'You are pass 2 of', files: { 'done.txt': 'ok\n' } },
    ])
    const r = await runCli(repo, fake, ['build', id, '--loop-run', 'B1', ...FAST])
    expect(r.code).toBe(0)
    // Two builder sessions, one grader and five reviewers, at the fake's 0.01 each.
    expect(JSON.parse(r.stdout)).toMatchObject({ result: 'green', passes: 2, branch: 'werk-build/B1', obligation: 'build-B1', costUsd: expect.closeTo(0.08, 5) })

    const types = boardEvents(repo).slice(2).map((e) => [e.type, (e.payload as { to?: string; green?: boolean; result?: string }).to ?? (e.payload as { green?: boolean }).green ?? (e.payload as { result?: string }).result])
    expect(types).toEqual([
      ['ticket.moved', 'building'],
      ['ticket.build.started', undefined],
      ['ticket.pass', false],
      ['ticket.pass', true],
      ['ticket.build.ended', 'green'],
      ['ticket.moved', 'merging'],
    ])
    // The verb records its own process, so a stop reaches it after a server restart. Not
    // spawned by the board, so it does not lead a process group of its own.
    const started = boardEvents(repo).find((e) => e.type === 'ticket.build.started')!
    expect(started.payload).toMatchObject({ pid: expect.any(Number), group: false })
    const t = boardOf(repo).tickets.get(id)!
    expect(t).toMatchObject({ column: 'merging', passes: 2, lastEnd: 'green', live: false, log: '.werk/runs/B1/live.jsonl' })

    // The base is the tip of the main line; the ticket branch is kept on top of it, and the
    // main line itself does not move until a merge.
    expect(JSON.parse(r.stdout).base).toBe(git(repo, 'rev-parse', 'main'))
    expect(git(repo, 'rev-parse', 'main')).toBe(git(repo, 'rev-parse', 'werk-build/B1~2'))
    expect(git(repo, 'show', 'werk-build/B1:done.txt')).toBe('ok')
    expect(git(repo, 'worktree', 'list').split('\n')).toHaveLength(1)

    // Every session's events go to the live file the board tails, tagged with the session.
    const live = readJsonl(join(repo, '.werk', 'runs', 'B1', 'live.jsonl'))
    expect(new Set(live.map((e) => e.werk_session))).toEqual(new Set(['pass-1', 'pass-2', 'grade-2', 'review-design-2', 'review-maintainability-2', 'review-tests-2', 'review-security-2', 'review-performance-2']))
    // #vi-board-session-file: each line carries its time.
    expect(live.every((e) => typeof (e.timestamp ?? e.at) === 'string')).toBe(true)
    expect(passesOf(repo).map((x) => x.failure)).toEqual(['check', undefined])
    // #st-build-seam-role-env: every launch carries its role. #lp-prod-judge-read-only: only
    // the judges run with a fixed, read-only tool set.
    const calls = fake.calls()
    expect(calls.map((c) => c.role).slice(0, 3)).toEqual(['builder', 'builder', 'grader'])
    expect(calls.slice(3).map((c) => c.role).sort()).toEqual(['reviewer-design', 'reviewer-maintainability', 'reviewer-performance', 'reviewer-security', 'reviewer-tests'])
    expect(calls.map((c) => c.argv.includes('--restricted'))).toEqual([false, false, true, true, true, true, true, true])
  })

  test('the brief holds the ticket, its stories, the card closure, the rejected options and the last failure', async () => {
    const { repo, id } = setup()
    const fake = judged([{ match: 'You are pass 1 of' }, { match: 'You are pass 2 of', files: { 'done.txt': '' } }])
    await runCli(repo, fake, ['build', id, '--loop-run', 'B1', ...FAST])
    const [first, second] = fake.calls().map((c) => c.prompt).filter((p) => p.includes('You are pass'))
    expect(first).toContain('List, end to end.')
    expect(first).toContain('- It works')
    expect(first).toContain('2. As a user, I want to add an item, so that it is kept.')
    expect(first).not.toContain('1. As a user, I want to see the list')
    expect(first).toContain('Kid body.')
    expect(first).toContain('Base body.')
    expect(first).toContain('Keep it in memory — rejected because it is lost on restart')
    expect(first).toContain('--obligation build-B1')
    // A pipeline prompt is generic: no werk card ids that a builder could mistake for its own.
    expect(first).not.toMatch(/#(st|lp|werk)-/)
    expect(second).not.toContain('You are the grader')
    expect(second).toContain('Command: `make test` (exit 2)')
    expect(second).toContain('done.txt is missing')
  })

  test('a red pass records its gate and whether the check passed on a rerun; the next pass records the cause it names (#ms-fail)', async () => {
    const { repo, id } = setup()
    const fake = judged([
      { match: 'You are pass 1 of', result: 'started' },
      { match: 'You are pass 2 of', files: { 'done.txt': '' }, result: 'Added it.\nCAUSE OF THE LAST FAILURE: builder-error — the first pass never wrote the file' },
    ])
    await runCli(repo, fake, ['build', id, '--loop-run', 'B1', ...FAST])
    const [first, second] = passesOf(repo)
    expect(first).toMatchObject({ cap: 5, green: false, gate: { gate: 'check', name: 'make test' } })
    expect(first.flakyChecks).toBeUndefined()
    expect(first.causeOfLast).toBeUndefined()
    expect(second).toMatchObject({ green: true, causeOfLast: { cause: 'builder-error', why: 'the first pass never wrote the file' } })
    expect(second.gate).toBeUndefined()

    // The report reads the same records back: one fail, by a builder error.
    const report = await runCli(repo, fake, ['fails', '--json'])
    expect(JSON.parse(report.stdout)).toMatchObject({ builds: 1, passes: 2, byGate: [{ key: 'check: make test', total: 1, causes: { 'builder-error': 1 } }] })
  })

  test('a check that is red and then green on its rerun does not fail the pass, and the report still counts it flaky (#ms-fail-cause)', async () => {
    const flaky = 'test -f flaky-ran || (touch flaky-ran && false)'
    const { repo, id } = setup({ checks: `- \`${flaky}\`\n- \`make test\`` })
    const fake = judged([{ match: 'You are pass 1 of', files: { 'done.txt': '' } }])
    const r = await runCli(repo, fake, ['build', id, '--loop-run', 'B1', ...FAST])
    expect(JSON.parse(r.stdout)).toMatchObject({ result: 'green', passes: 1 })
    const [first] = passesOf(repo)
    // The checks after the flaky one ran, and the grader and the review judged the pass.
    expect(first).toMatchObject({ green: true, flakyChecks: [flaky], checks: [{ cmd: flaky, ok: true }, { cmd: 'make test', ok: true }] })
    expect(first.grade).toBeDefined()
    const report = await runCli(repo, fake, ['fails', '--json'])
    expect(JSON.parse(report.stdout)).toMatchObject({ byCause: { 'flaky-check': 1 }, byGate: [{ key: `check: ${flaky}`, total: 1 }] })
  })

  test('every step writes a started and an ended event to the pipeline log, and names its detail file (#ms-store)', async () => {
    const { repo, id } = setup()
    const fake = judged([{ match: 'You are pass 1 of', result: 'started' }, { match: 'You are pass 2 of', files: { 'done.txt': '' } }])
    await runCli(repo, fake, ['build', id, '--loop-run', 'B1', ...FAST])
    const events = pipelineOf(repo)
    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i + 1))
    const steps = events.map((e) => e.payload as StepRef).map((p, i) => `${events[i].type === 'step.started' ? '+' : '-'}${p.step}${p.pass ? ` ${p.pass}` : ''}${p.name ? ` ${p.name}` : ''}`)
    expect(steps.slice(0, 10)).toEqual(['+build', '+pass 1', '+session 1 pass-1', '-session 1 pass-1', '+check 1 make test', '-check 1 make test', '+check 1 make test', '-check 1 make test', '-pass 1', '+pass 2'])
    expect(steps.at(-2)).toBe('-pass 2')
    expect(steps.at(-1)).toBe('-build')
    expect(events[0].payload).toMatchObject({ build: 'B1', ticket: id, cap: 5 })
    expect(events.at(-1)!.payload).toMatchObject({ result: 'green', costUsd: expect.closeTo(0.08, 5) })

    const ends = events.filter((e) => e.type === 'step.ended').map((e) => e.payload as BuildStepEnded)
    // The rerun of the red check is marked, and each check's whole output is a file.
    expect(ends.filter((e) => e.step === 'check').map((e) => [e.pass, e.result, e.rerun ?? false, e.file])).toEqual([
      [1, 'red', false, '.werk/runs/B1/check-1-1.txt'],
      [1, 'red', true, '.werk/runs/B1/check-1-1-rerun.txt'],
      [2, 'ok', false, '.werk/runs/B1/check-2-1.txt'],
    ])
    expect(readFileSync(join(repo, '.werk', 'runs', 'B1', 'check-1-1.txt'), 'utf8')).toContain('done.txt is missing')
    // Each session names its transcript and its cost; a pass costs the sum of its sessions.
    const sessions = ends.filter((e) => e.step === 'session')
    expect(sessions).toHaveLength(8)
    for (const s of sessions) expect(existsSync(join(repo, s.file!))).toBe(true)
    expect(passesOf(repo).map((p) => [p.pass, p.costUsd])).toEqual([
      [1, expect.closeTo(0.01, 5)],
      [2, expect.closeTo(0.07, 5)],
    ])
  })

  test('appends the card obligation before any code, and a card that names it satisfies it', async () => {
    const { repo, id } = setup()
    const add = `werk add kid-file --title "Done is a file" --parent kid --who me --obligation build-B1`
    const fake = judged([{ files: { 'done.txt': '' }, sh: [add] }])
    await runCli(repo, fake, ['build', id, '--loop-run', 'B1', ...FAST])
    const events = readJsonl(join(repo, '.werk', 'log.jsonl'))
    const created = events.findIndex((e) => e.type === 'obligation.created')
    const proposed = events.findIndex((e) => e.type === 'node.proposed')
    expect(created).toBeGreaterThan(-1)
    expect(created).toBeLessThan(proposed)
    expect(fold(events).obligations.get('build-B1')).toMatchObject({ ticket: id, cites: ['kid'], cards: ['kid-file'] })
  })

  test('a "no new decision" record closes the obligation, and the grader checks the diff against the named cards (#st-build-card)', async () => {
    const { repo, id } = setup()
    const follow = `werk followed build-B1 --cards kid`
    const lines = (unrecorded: number) =>
      JSON.stringify(['criterion-1', 'scope-line', 'unrecorded-decision', 'kid', 'base'].map((card) => ({ card, score: card === 'unrecorded-decision' ? unrecorded : 4, gap: card === 'unrecorded-decision' && unrecorded < 4 ? 'picked a file format no named card gives' : '' })))
    // Pass 1 records "no new decision" and the grader finds an unrecorded choice. Pass 2 is green.
    const fake = judged(
      [
        { match: 'You are pass 1 of', files: { 'done.txt': 'ok\n' }, sh: [follow] },
        { match: 'You are pass 2 of', files: { 'done2.txt': 'ok\n' } },
      ],
      [{ match: 'You are the grader', times: 1, result: lines(2) }, { match: 'You are the grader', result: lines(4) }, JUDGES[1]],
    )
    const r = await runCli(repo, fake, ['build', id, '--loop-run', 'B1', ...FAST])
    expect(JSON.parse(r.stdout)).toMatchObject({ result: 'green', passes: 2 })
    const o = fold(readJsonl(join(repo, '.werk', 'log.jsonl'))).obligations.get('build-B1')!
    expect(o).toMatchObject({ followed: ['kid'], cards: [] })
    const graders = fake.calls().filter((c) => c.prompt.includes('You are the grader'))
    expect(graders[0]!.prompt).toContain('"unrecorded-decision"')
    expect(graders[0]!.prompt).toContain('## Cards the builder named')
    expect(fake.calls().find((c) => c.prompt.includes('You are pass 2 of'))!.prompt).toContain('an unrecorded decision (propose a card for it), score 2/5: picked a file format no named card gives')
  })

  test('a build with no record gets no unrecorded-decision line', async () => {
    const { repo, id } = setup()
    const fake = judged([{ match: 'You are pass 1 of', files: { 'done.txt': 'ok\n' } }])
    await runCli(repo, fake, ['build', id, '--loop-run', 'B1', ...FAST])
    expect(fake.calls().find((c) => c.prompt.includes('You are the grader'))!.prompt).not.toContain('unrecorded-decision')
  })

  test('stops at the cap, and the ticket stays in building', async () => {
    const { repo, id } = setup()
    const fake = judged([{ result: 'no luck' }])
    const r = await runCli(repo, fake, ['build', id, '--loop-run', 'B1', '--cap', '2', ...FAST])
    expect(r.code).toBe(1)
    expect(JSON.parse(r.stdout)).toMatchObject({ result: 'cap', passes: 2 })
    expect(boardOf(repo).tickets.get(id)).toMatchObject({ column: 'ready', reason: 'red at the retry cap', lastEnd: 'cap', passes: 2 })
  })

  test('the checks stop at the first red one, and the grader does not run', async () => {
    const { repo, id } = setup({ checks: '- `true`\n- `false`\n- `touch third-ran`' })
    const fake = judged([{ result: 'done' }])
    const r = await runCli(repo, fake, ['build', id, '--loop-run', 'B1', '--cap', '1', ...FAST])
    expect(JSON.parse(r.stdout)).toMatchObject({ result: 'cap', passes: 1 })
    const [record] = passesOf(repo)
    expect(record).toMatchObject({ green: false, failure: 'check' })
    expect(record.checks.map((c: { cmd: string; ok: boolean }) => [c.cmd, c.ok])).toEqual([
      ['true', true],
      ['false', false],
    ])
    expect(fake.calls().some((c) => c.prompt.includes('You are the grader'))).toBe(false)
  })

  test('builds on what the main line holds, not on uncommitted files (#st-plan-main)', async () => {
    const { repo, id } = setup()
    await Bun.write(join(repo, 'done.txt'), 'from an earlier ticket\n')
    git(repo, 'add', 'done.txt')
    git(repo, 'commit', '-q', '-m', 'earlier ticket')
    // An uncommitted file in the checkout never reaches the build.
    await Bun.write(join(repo, 'scratch.txt'), 'not committed\n')
    const fake = judged([{ result: 'nothing to do' }])
    const r = await runCli(repo, fake, ['build', id, '--loop-run', 'B1', ...FAST])
    expect(JSON.parse(r.stdout)).toMatchObject({ result: 'green', passes: 1, base: git(repo, 'rev-parse', 'main') })
    expect(git(repo, 'ls-tree', '--name-only', 'werk-build/B1')).not.toContain('scratch.txt')
  })

  test('refuses before any event or agent call when there is no main line (#werk-base-branch)', async () => {
    const { repo, id } = setup()
    git(repo, 'branch', '-m', 'main', 'trunk')
    const fake = fakeClaude([])
    const r = await runCli(repo, fake, ['build', id, ...FAST])
    expect(r.code).toBe(1)
    expect(JSON.parse(r.stdout)).toMatchObject({ result: 'refused', passes: 0, error: 'no main line branch main' })
    expect(r.stderr).toContain('no main line branch main')
    expect(boardEvents(repo)).toHaveLength(2)
    expect(readJsonl(join(repo, '.werk', 'log.jsonl')).some((e) => e.type === 'obligation.created')).toBe(false)
    expect(fake.calls()).toHaveLength(0)
    expect(git(repo, 'branch', '--format=%(refname:short)')).toBe('trunk')
  })

  test('refuses a blocked ticket before any event or agent call', async () => {
    const { repo } = setup()
    const blocked = planTicket(repo, { num: '02', text: ticket({ title: 'Later', cites: 'root', stories: '1' }), blockedBy: ['r1/01'] })
    const fake = fakeClaude([])
    const before = boardEvents(repo).length
    const r = await runCli(repo, fake, ['build', blocked, ...FAST])
    expect(r.code).toBe(1)
    expect(r.stderr).toContain('blocked by r1/01')
    expect(boardEvents(repo)).toHaveLength(before)
    expect(fake.calls()).toHaveLength(0)
  })

  describe('refused before any event or agent call', () => {
    const refused = async (repo: string, id: string, why: string) => {
      const fake = fakeClaude([])
      const board = boardEvents(repo).length
      const log = readJsonl(join(repo, '.werk', 'log.jsonl')).length
      const r = await runCli(repo, fake, ['build', id, ...FAST])
      expect(r.code).toBe(1)
      expect(JSON.parse(r.stdout)).toMatchObject({ result: 'refused', passes: 0, costUsd: 0 })
      expect(r.stderr).toContain(why)
      expect(boardEvents(repo)).toHaveLength(board)
      // No card obligation either: the log is untouched.
      expect(readJsonl(join(repo, '.werk', 'log.jsonl'))).toHaveLength(log)
      expect(fake.calls()).toHaveLength(0)
      expect(git(repo, 'branch', '--format=%(refname:short)')).toBe('main')
    }

    test('an archived ticket', async () => {
      const { repo, id } = setup()
      appendBoard(repo, 'ticket.archived', { id })
      await refused(repo, id, `ticket "${id}" is archived`)
    })

    test('a ticket in a column other than ready or building', async () => {
      const { repo, id } = setup()
      appendBoard(repo, 'ticket.moved', { id, to: 'merging' })
      await refused(repo, id, `ticket "${id}" is in merging, not ready or building`)
    })

    test('a ticket whose file is gone', async () => {
      const { repo, id } = setup()
      rmSync(join(repo, '.werk', 'tickets', 'r1', '01.md'))
      await refused(repo, id, 'no ticket file at .werk/tickets/r1/01.md')
    })
  })

  test('the worktree is removed on the error path too', async () => {
    const { repo, id } = setup()
    // A directory where the first check's output goes makes its write throw, after the
    // worktree exists and a pass has run in it.
    mkdirSync(join(repo, '.werk', 'runs', 'B1', 'check-1-1.txt'), { recursive: true })
    const tmp = mkdtempSync(join(tmpdir(), 'werk-build-tmp-'))
    const fake = judged([{ files: { 'done.txt': '' } }])
    const r = await runCli(repo, fake, ['build', id, '--loop-run', 'B1', ...FAST], { TMPDIR: tmp })
    expect(r.code).toBe(1)
    expect(JSON.parse(r.stdout)).toMatchObject({ result: 'error', branch: 'werk-build/B1', error: expect.stringContaining('EISDIR') })
    expect(fake.calls().some((c) => c.prompt.includes('You are pass 1'))).toBe(true)
    expect(git(repo, 'worktree', 'list').split('\n')).toHaveLength(1)
    expect(readdirSync(tmp).filter((f) => f.startsWith('werk-build-wt-'))).toEqual([])
    expect(boardOf(repo).tickets.get(id)).toMatchObject({ lastEnd: 'error', live: false })
  })

  test('a sent-back ticket whose old branch is not on the main line starts fresh from the main line', async () => {
    const { repo, id } = setup()
    // The main line has moved on since the old branch was cut: the old work is not on top of it.
    git(repo, 'branch', 'old-work')
    git(repo, 'checkout', '-q', 'old-work')
    writeFileSync(join(repo, 'old.txt'), 'old\n')
    git(repo, 'add', 'old.txt')
    git(repo, 'commit', '-q', '-m', 'old work')
    git(repo, 'checkout', '-q', 'main')
    writeFileSync(join(repo, 'later.txt'), 'later\n')
    git(repo, 'add', 'later.txt')
    git(repo, 'commit', '-q', '-m', 'a later merge')
    const fake = judged([{ files: { 'done.txt': '' } }])
    const PATH = process.env.PATH
    process.env.PATH = `${fake.bin}:${PATH}`
    process.env.FAKE_CLAUDE_SCRIPT = fake.script
    try {
      const g = fold(readJsonl(join(repo, '.werk', 'log.jsonl')))
      const r = await build(repo, g, id, {
        cap: 1,
        passTimeoutMs: 20_000,
        silenceMs: 5000,
        loopRun: 'B2',
        startFrom: 'old-work',
        logPath: join(repo, '.werk', 'log.jsonl'),
        boardPath: join(repo, '.werk', 'board.jsonl'),
      })
      expect(r).toMatchObject({ result: 'green', passes: 1, base: git(repo, 'rev-parse', 'main') })
    } finally {
      process.env.PATH = PATH
      delete process.env.FAKE_CLAUDE_SCRIPT
    }
    expect(git(repo, 'rev-parse', 'werk-build/B2~1')).toBe(git(repo, 'rev-parse', 'main'))
    expect(git(repo, 'ls-tree', '--name-only', 'werk-build/B2')).not.toContain('old.txt')
    const pass1 = fake.calls().find((c) => c.prompt.includes('You are pass 1'))!
    expect(pass1.prompt).toContain('You are the first pass. Nothing has been done yet.')
  })

  test('a sent-back ticket whose old branch sits on the main line resumes from that work', async () => {
    const { repo, id } = setup()
    writeFileSync(join(repo, 'run.txt'), 'run\n')
    git(repo, 'add', 'run.txt')
    git(repo, 'commit', '-q', '-m', 'an earlier merge')
    git(repo, 'checkout', '-q', '-b', 'old-work')
    writeFileSync(join(repo, 'old.txt'), 'old\n')
    git(repo, 'add', 'old.txt')
    git(repo, 'commit', '-q', '-m', 'old work')
    git(repo, 'checkout', '-q', 'main')
    const fake = judged([{ files: { 'done.txt': '' } }])
    const PATH = process.env.PATH
    process.env.PATH = `${fake.bin}:${PATH}`
    process.env.FAKE_CLAUDE_SCRIPT = fake.script
    try {
      const g = fold(readJsonl(join(repo, '.werk', 'log.jsonl')))
      const r = await build(repo, g, id, {
        cap: 1,
        passTimeoutMs: 20_000,
        silenceMs: 5000,
        loopRun: 'B2',
        startFrom: 'old-work',
        logPath: join(repo, '.werk', 'log.jsonl'),
        boardPath: join(repo, '.werk', 'board.jsonl'),
      })
      expect(r).toMatchObject({ result: 'green', passes: 1, base: git(repo, 'rev-parse', 'main') })
    } finally {
      process.env.PATH = PATH
      delete process.env.FAKE_CLAUDE_SCRIPT
    }
    expect(git(repo, 'rev-parse', 'werk-build/B2~1')).toBe(git(repo, 'rev-parse', 'old-work'))
    expect(git(repo, 'ls-tree', '--name-only', 'werk-build/B2')).toContain('old.txt')
    const pass1 = fake.calls().find((c) => c.prompt.includes('You are pass 1'))!
    expect(pass1.prompt).not.toContain('You are the first pass.')
    expect(pass1.prompt).toContain('Earlier passes worked on this ticket.')
  })

  test('after a conflict, the build keeps its old branch, merges the main line into it, and the first pass resolves the files git names (#st-build-conflict-resolve)', async () => {
    const { repo, id } = setup()
    writeFileSync(join(repo, 'list.txt'), 'a\n')
    git(repo, 'add', 'list.txt')
    git(repo, 'commit', '-q', '-m', 'the list')
    git(repo, 'checkout', '-q', '-b', 'old-work')
    writeFileSync(join(repo, 'list.txt'), 'a\nold\n')
    git(repo, 'commit', '-q', '-am', 'old work')
    git(repo, 'checkout', '-q', 'main')
    writeFileSync(join(repo, 'list.txt'), 'a\nmain\n')
    git(repo, 'commit', '-q', '-am', 'another ticket merged first')
    const fake = judged([{ files: { 'done.txt': '', 'list.txt': 'a\nmain\nold\n' } }])
    const PATH = process.env.PATH
    process.env.PATH = `${fake.bin}:${PATH}`
    process.env.FAKE_CLAUDE_SCRIPT = fake.script
    try {
      const g = fold(readJsonl(join(repo, '.werk', 'log.jsonl')))
      const r = await build(repo, g, id, {
        cap: 1,
        passTimeoutMs: 20_000,
        silenceMs: 5000,
        loopRun: 'B2',
        resolveFrom: 'old-work',
        lastFailure: { kind: 'merge', cmd: 'git merge old-work', code: 1, tail: 'CONFLICT (content): Merge conflict in list.txt', conflict: true },
        logPath: join(repo, '.werk', 'log.jsonl'),
        boardPath: join(repo, '.werk', 'board.jsonl'),
      })
      expect(r).toMatchObject({ result: 'green', passes: 1 })
    } finally {
      process.env.PATH = PATH
      delete process.env.FAKE_CLAUDE_SCRIPT
    }
    // The new branch holds the old work and the main line, so the merge queue can take it.
    expect(git(repo, 'show', 'werk-build/B2:list.txt')).toBe('a\nmain\nold')
    expect(git(repo, 'merge-base', '--is-ancestor', 'main', 'werk-build/B2')).toBe('')
    expect(git(repo, 'merge-base', '--is-ancestor', 'old-work', 'werk-build/B2')).toBe('')
    const pass1 = fake.calls().find((c) => c.prompt.includes('You are pass 1'))!
    expect(pass1.prompt).toContain('Earlier passes worked on this ticket.')
    expect(pass1.prompt).toContain('the earlier work is still here')
    expect(pass1.prompt).toContain('- list.txt')
  })

  describe("the main line's tip goes into the branch before the checks (#st-build-tip-in)", () => {
    /** A check that fails twice, the rerun included. On its first run it commits to the main
     *  line the way another ticket's merge would: the file in its argument gets the line "main". */
    const MOVER = [
      'set -e',
      'top=$(cd "$(git rev-parse --git-common-dir)/.." && pwd)',
      'if [ ! -f .a ]; then',
      '  touch .a',
      '  printf "a\\nmain\\n" > "$top/$1"',
      '  git -C "$top" add "$1"',
      '  git -C "$top" commit -q -m "another ticket merged first"',
      '  exit 1',
      'elif [ ! -f .b ]; then',
      '  touch .b',
      '  exit 1',
      'fi',
      '',
    ].join('\n')

    function movingRepo(file: string) {
      const { repo, id } = setup({ checks: `- \`sh move-main.sh ${file}\`` })
      writeFileSync(join(repo, 'list.txt'), 'a\n')
      writeFileSync(join(repo, 'move-main.sh'), MOVER)
      git(repo, 'add', 'list.txt', 'move-main.sh')
      git(repo, 'commit', '-q', '-m', 'the list and the mover')
      return { repo, id }
    }

    test('a clean merge puts the tip into the branch, and the next pass checks the merged tree', async () => {
      const { repo, id } = movingRepo('other.txt')
      const fake = judged([{ files: { 'done.txt': '' } }])
      const r = await runCli(repo, fake, ['build', id, '--loop-run', 'B1', '--cap', '3', ...FAST])
      expect(JSON.parse(r.stdout)).toMatchObject({ result: 'green', passes: 2 })
      // The branch holds the main line's new commit, so the merge queue has nothing to merge.
      expect(git(repo, 'merge-base', '--is-ancestor', 'main', 'werk-build/B1')).toBe('')
      expect(git(repo, 'show', 'werk-build/B1:other.txt')).toBe('a\nmain')
      const [first, second] = passesOf(repo)
      expect(first.green).toBe(false)
      expect(second.green).toBe(true)
    })

    test('a clash is the next pass to resolve, and it costs no pass of the cap', async () => {
      const { repo, id } = movingRepo('list.txt')
      const fake = judged([
        { match: 'You are pass 3 of', files: { 'done.txt': '', 'list.txt': 'a\nmain\nticket\n' } },
        { files: { 'done.txt': '', 'list.txt': 'a\nticket\n' } },
      ])
      // Cap 2: the red checks of pass 1 use one pass. Pass 2 ends on the clash and is free.
      const r = await runCli(repo, fake, ['build', id, '--loop-run', 'B1', '--cap', '2', ...FAST])
      expect(JSON.parse(r.stdout)).toMatchObject({ result: 'green', passes: 3 })
      const [, second, third] = passesOf(repo)
      expect(second).toMatchObject({ green: false, failure: 'merge', gate: { gate: 'merge' } })
      expect(third.green).toBe(true)
      const pass3 = fake.calls().find((c) => c.prompt.includes('You are pass 3 of'))!
      expect(pass3.prompt).toContain('- list.txt')
      expect(git(repo, 'show', 'werk-build/B1:list.txt')).toBe('a\nmain\nticket')
      expect(git(repo, 'merge-base', '--is-ancestor', 'main', 'werk-build/B1')).toBe('')
    })

    test('a main line that has not moved merges nothing', async () => {
      const { repo, id } = setup()
      const fake = judged([{ files: { 'done.txt': '' } }])
      const r = await runCli(repo, fake, ['build', id, '--loop-run', 'B1', ...FAST])
      expect(JSON.parse(r.stdout)).toMatchObject({ result: 'green', passes: 1 })
      expect(git(repo, 'log', '--merges', '--oneline', 'werk-build/B1')).toBe('')
    })
  })

  test('SIGTERM ends the build as stopped', async () => {
    const { repo, id } = setup()
    const fake = fakeClaude([{ hangMs: 20_000 }])
    const { proc, done } = startCli(repo, fake, ['build', id, '--loop-run', 'B1', '--timeout', '60', '--silence', '60'])
    const start = Date.now()
    while (!boardEvents(repo).some((e) => e.type === 'ticket.build.started') && Date.now() - start < 10_000) await Bun.sleep(50)
    await Bun.sleep(300)
    proc.kill('SIGTERM')
    const r = await done
    expect(r.code).toBe(1)
    expect(Date.now() - start).toBeLessThan(10_000)
    expect(boardOf(repo).tickets.get(id)).toMatchObject({ lastEnd: 'stopped', live: false })
    expect(git(repo, 'worktree', 'list').split('\n')).toHaveLength(1)
  })

  describe('an archive of its own ticket (#werk-board-control-archive-ends-build)', () => {
    test('the builder loop ends its own build when its ticket is archived, with no signal from outside', async () => {
      const { repo, id } = setup()
      const fake = fakeClaude([{ hangMs: 20_000 }])
      const { done } = startCli(repo, fake, ['build', id, '--loop-run', 'B1', '--timeout', '60', '--silence', '60'])
      const start = Date.now()
      while (!boardEvents(repo).some((e) => e.type === 'ticket.build.started') && Date.now() - start < 10_000) await Bun.sleep(50)
      await Bun.sleep(300)
      appendBoard(repo, 'ticket.archived', { id })
      const r = await done
      // Within about a second, plus the time the agent takes to stop.
      expect(Date.now() - start).toBeLessThan(10_000)
      expect(r.code).toBe(1)
      expect(boardOf(repo).tickets.get(id)).toMatchObject({ archived: true, column: 'building', lastEnd: 'stopped', live: false })
      // The branch stays, the worktree goes, and no pass recorded a retry.
      expect(git(repo, 'branch', '--list', 'werk-build/B1')).toContain('werk-build/B1')
      expect(git(repo, 'worktree', 'list').split('\n')).toHaveLength(1)
      expect(boardEvents(repo).some((e) => e.type === 'ticket.moved' && (e.payload as any).to === 'merging')).toBe(false)
    })

    test('an archive that comes during the last pass still stops the build, so the ticket never moves to merging', async () => {
      const { repo, id } = setup()
      // The pass finishes at once; the check holds long enough for the archive to land during it.
      const fake = judged([{ files: { 'done.txt': '' } }])
      const { done } = startCli(repo, fake, ['build', id, '--loop-run', 'B1', ...FAST])
      const start = Date.now()
      while (!boardEvents(repo).some((e) => e.type === 'ticket.build.started') && Date.now() - start < 10_000) await Bun.sleep(50)
      appendBoard(repo, 'ticket.archived', { id })
      const r = await done
      expect(boardEvents(repo).some((e) => e.type === 'ticket.moved' && (e.payload as any).to === 'merging')).toBe(false)
      expect(JSON.parse(r.stdout).result).not.toBe('green')
    })
  })

  describe('the grader (#lp-prod-judge)', () => {
    test('a low score fails the pass, and its gap is in the next brief', async () => {
      const { repo, id } = setup()
      const low = {
        match: 'You are the grader',
        times: 1,
        result: 'Here:\n```json\n[{"card": "criterion-1", "score": 4}, {"card": "scope-line", "score": 4}, {"card": "#kid", "score": 2, "built": true, "gap": "kid.ts never writes the file"}, {"card": "base", "score": 4}]\n```',
      }
      const fake = fakeClaude([low, ...JUDGES, { files: { 'done.txt': '' } }])
      const r = await runCli(repo, fake, ['build', id, '--loop-run', 'B1', ...FAST])
      expect(JSON.parse(r.stdout)).toMatchObject({ result: 'green', passes: 2 })
      const records = passesOf(repo)
      expect(records[0]).toMatchObject({
        green: false,
        failure: 'grade',
        grade: [{ card: 'criterion-1', score: 4 }, { card: 'scope-line', score: 4 }, { card: 'kid', score: 2 }, { card: 'base', score: 4 }],
      })
      expect(records[1]).toMatchObject({
        green: true,
        grade: [{ card: 'criterion-1', score: 4 }, { card: 'scope-line', score: 4 }, { card: 'kid', score: 4 }, { card: 'base', score: 4 }],
      })
      const grade = fake.calls().find((c) => c.prompt.includes('You are the grader'))!
      // The ticket's criterion is a delivery line.
      expect(grade.prompt).toContain('- criterion-1: It works')
      expect(grade.prompt).toContain('Kid body.')
      // The ticket cites only kid. base is in its depends_on closure, so it is judged too.
      expect(grade.prompt).toContain('Base body.')
      expect(grade.prompt).toContain('diff --git a/done.txt b/done.txt')
      const pass2 = fake.calls().filter((c) => c.prompt.includes('You are pass 2'))[0]
      expect(pass2.prompt).toContain('#kid, score 2/5: kid.ts never writes the file')
    })

    test('a card the grader leaves out fails, and so does an answer with no JSON', async () => {
      const { repo, id } = setup()
      const fake = fakeClaude([
        { match: 'You are the grader', times: 1, result: '[]' },
        { match: 'You are the grader', times: 1, result: 'looks fine to me' },
        { files: { 'done.txt': '' } },
      ])
      const r = await runCli(repo, fake, ['build', id, '--loop-run', 'B1', '--cap', '2', ...FAST])
      expect(JSON.parse(r.stdout)).toMatchObject({ result: 'cap' })
      const records = passesOf(repo)
      expect(records.map((x) => x.failure)).toEqual(['grade', 'step'])
      const pass2 = fake.calls().filter((c) => c.prompt.includes('You are pass 2'))[0]
      expect(pass2.prompt).toContain('the grader gave no line for this card')
    })

    const smallGap = (score: number) => ({
      match: 'You are the grader',
      result: JSON.stringify([{ card: 'criterion-1', score: 4 }, { card: 'scope-line', score: 4 }, { card: 'kid', score, built: true, gap: 'an empty list still sends the field' }, { card: 'base', score: 4 }]),
    })

    test('the next grade gets the gaps of the last one, and the first grade is told to name every gap (#st-grade-converge)', async () => {
      const { repo, id } = setup()
      const fake = fakeClaude([{ ...smallGap(2), times: 1 }, ...JUDGES, { files: { 'done.txt': '' } }])
      const r = await runCli(repo, fake, ['build', id, '--loop-run', 'B1', ...FAST])
      expect(JSON.parse(r.stdout)).toMatchObject({ result: 'green', passes: 2 })
      const [first, second] = fake.calls().filter((c) => c.prompt.includes('You are the grader'))
      expect(first.prompt).toContain('Name every gap you find on a line in this one answer')
      expect(first.prompt).not.toContain('## The earlier grade of this ticket')
      expect(second.prompt).toContain('## The earlier grade of this ticket')
      expect(second.prompt).toContain('- kid (score 2): an empty list still sends the field')
      expect(second.prompt).toContain('Fail a line that passed before only for a regression')
    })

    test('on the last counted pass, a built card with a small gap merges, and a follow-up for the gap waits for the ticket (#st-grade-defer)', async () => {
      const { repo, id } = setup()
      const fake = fakeClaude([smallGap(2), ...JUDGES, { files: { 'done.txt': '' } }])
      const r = await runCli(repo, fake, ['build', id, '--loop-run', 'B1', '--cap', '1', ...FAST])
      expect(JSON.parse(r.stdout)).toMatchObject({ result: 'green', passes: 1 })
      expect(passesOf(repo)[0]).toMatchObject({ green: true, deferred: ['kid'] })
      // The review still runs on a pass that merges with a deferred gap.
      expect(fake.calls().some((c) => c.role?.startsWith('reviewer-'))).toBe(true)
      const follow = [...boardOf(repo).tickets.values()].find((t) => t.followUpOf === id)!
      expect(follow).toMatchObject({ column: 'blocked', blockedBy: [id] })
      const text = readFileSync(join(repo, follow.file), 'utf8')
      expect(text).toContain('cites: kid')
      expect(text).toContain('- #kid: an empty list still sends the field')
    })

    test('a small gap before the last counted pass still fails the pass', async () => {
      const { repo, id } = setup()
      const fake = fakeClaude([{ ...smallGap(2), times: 1 }, ...JUDGES, { files: { 'done.txt': '' } }])
      const r = await runCli(repo, fake, ['build', id, '--loop-run', 'B1', '--cap', '2', ...FAST])
      expect(JSON.parse(r.stdout)).toMatchObject({ result: 'green', passes: 2 })
      expect(passesOf(repo).map((p) => p.deferred)).toEqual([undefined, undefined])
      expect([...boardOf(repo).tickets.values()].some((t) => t.followUpOf === id)).toBe(false)
    })

    test('a plain contradiction on the last counted pass still meets the cap', async () => {
      const { repo, id } = setup()
      const fake = fakeClaude([smallGap(1), ...JUDGES, { files: { 'done.txt': '' } }])
      const r = await runCli(repo, fake, ['build', id, '--loop-run', 'B1', '--cap', '1', ...FAST])
      expect(JSON.parse(r.stdout)).toMatchObject({ result: 'cap', passes: 1 })
      expect([...boardOf(repo).tickets.values()].some((t) => t.followUpOf === id)).toBe(false)
    })

    test('a ticket with no decided cited card is graded on its criteria alone', async () => {
      const repo = makeRepo({ Makefile: MAKEFILE })
      writeLog(repo, [{ id: 'kid', status: 'open' }])
      const id = planTicket(repo, { text: ticket({ title: 'List', cites: 'kid', stories: '1' }), spec: SPEC })
      const fake = judged([{ files: { 'done.txt': '' } }], [{ match: 'You are the grader', result: '[{"card": "criterion-1", "score": 5}, {"card": "scope-line", "score": 5}]' }, JUDGES[1]!])
      const r = await runCli(repo, fake, ['build', id, '--loop-run', 'B1', ...FAST])
      expect(JSON.parse(r.stdout)).toMatchObject({ result: 'green', passes: 1 })
      const grade = fake.calls().find((c) => c.prompt.includes('You are the grader'))!
      expect(grade.prompt).toContain('- criterion-1: It works')
      expect(grade.prompt).not.toContain('### #kid')
      expect(passesOf(repo)[0]).toMatchObject({ green: true, grade: [{ card: 'criterion-1', score: 5, gap: '' }, { card: 'scope-line', score: 5, gap: '' }] })
      // The review still runs.
      expect(fake.calls().filter((c) => c.prompt.includes('You are a code reviewer'))).toHaveLength(5)
    })

    test('a diff over the size limit is cut, with a pointer to the full diff', async () => {
      const { repo, id } = setup()
      const big = 'x'.repeat(99) + '\n'
      const fake = judged([{ files: { 'done.txt': '', 'big.txt': big.repeat(700) } }])
      const r = await runCli(repo, fake, ['build', id, '--loop-run', 'B1', ...FAST])
      const base = JSON.parse(r.stdout).base
      const judges = fake.calls().filter((c) => c.prompt.startsWith('You are the grader') || c.prompt.startsWith('You are a code reviewer'))
      expect(judges).toHaveLength(6)
      for (const j of judges) {
        const diff = j.prompt.slice(j.prompt.indexOf('```diff\n') + 8, j.prompt.lastIndexOf('\n```'))
        const cut = diff.match(/\n\[\.\.\. (\d+) characters cut: run `git diff (\w+) HEAD` for the rest \.\.\.\]$/)!
        expect(cut).not.toBeNull()
        expect(cut[2]).toBe(base)
        expect(diff.length - cut[0].length).toBe(MAX_DIFF_CHARS)
        expect(Number(cut[1])).toBeGreaterThan(0)
      }
    })

    test('a silent grader is cancelled and counts as a failed step', async () => {
      const { repo, id } = setup()
      const fake = fakeClaude([{ match: 'You are the grader', times: 1, hangMs: 5000 }, ...JUDGES, { files: { 'done.txt': '' } }])
      const r = await runCli(repo, fake, ['build', id, '--loop-run', 'B1', '--timeout', '20', '--silence', '0.4'])
      expect(JSON.parse(r.stdout)).toMatchObject({ result: 'green', passes: 2 })
      const pass2 = fake.calls().filter((c) => c.prompt.includes('You are pass 2'))[0]
      expect(pass2.prompt).toContain('the grader step could not judge the change: cancelled for silence')
    })
  })

  describe('the review (#lp-prod-review)', () => {
    const finding = (severity: string) => JSON.stringify([{ severity, file: 'done.txt', line: 1, impact: `a ${severity} problem`, fix: 'change it' }])

    test('five reviewers, one per area, read the diff after the grader passes', async () => {
      const { repo, id } = setup()
      const fake = judged([{ files: { 'done.txt': '' } }])
      await runCli(repo, fake, ['build', id, '--loop-run', 'B1', ...FAST])
      const areas = fake.calls().map((c) => c.prompt.match(/You are a code reviewer for one area: ([^.]*)\./)?.[1]).filter(Boolean)
      expect(areas.sort()).toEqual(['Design', 'Maintainability', 'Performance', 'Security and dependencies', 'Tests'])
      const order = fake.calls().map((c) => (c.prompt.startsWith('You are the grader') ? 'grade' : c.prompt.startsWith('You are a code reviewer') ? 'review' : 'build'))
      expect(order.slice(0, 3)).toEqual(['build', 'grade', 'review'])
    })

    test('a finding scripted for reviewer-security alone fails the review, and the other areas stay green (#st-build-seam-role-env-reviewer-area)', async () => {
      const { repo, id } = setup()
      const fake = fakeClaude([
        JUDGES[0],
        { role: 'reviewer-security', times: 1, result: finding('HIGH') },
        JUDGES[1],
        { files: { 'done.txt': '' } },
      ])
      const r = await runCli(repo, fake, ['build', id, '--loop-run', 'B1', ...FAST])
      expect(JSON.parse(r.stdout)).toMatchObject({ result: 'green', passes: 2 })
      expect(passesOf(repo)[0]).toMatchObject({ green: false, failure: 'review', review: [{ area: 'security', severity: 'HIGH' }] })
      const roles = fake.calls().map((c) => c.role).filter((x) => x?.startsWith('reviewer'))
      expect(new Set(roles)).toEqual(new Set(['reviewer-design', 'reviewer-maintainability', 'reviewer-tests', 'reviewer-security', 'reviewer-performance']))
    })

    test('a HIGH finding fails the pass and goes into the next brief', async () => {
      const { repo, id } = setup()
      const fake = fakeClaude([
        JUDGES[0],
        { match: 'one area: Tests\\.', times: 1, result: finding('HIGH') },
        JUDGES[1],
        { files: { 'done.txt': '' } },
      ])
      const r = await runCli(repo, fake, ['build', id, '--loop-run', 'B1', ...FAST])
      expect(JSON.parse(r.stdout)).toMatchObject({ result: 'green', passes: 2 })
      const records = passesOf(repo)
      expect(records[0]).toMatchObject({ green: false, failure: 'review', review: [{ area: 'tests', severity: 'HIGH' }] })
      const pass2 = fake.calls().filter((c) => c.prompt.includes('You are pass 2'))[0]
      expect(pass2.prompt).toContain('HIGH (tests) done.txt:1 — a HIGH problem Fix: change it')
    })

    test('a broken reviewer with no blocking finding fails the pass as a step, and its error is recorded', async () => {
      const { repo, id } = setup()
      const fake = fakeClaude([
        JUDGES[0],
        { match: 'one area: Design\\.', times: 1, exitCode: 1, stderr: 'reviewer crashed' },
        { match: 'one area: Tests\\.', times: 1, result: finding('LOW') },
        JUDGES[1],
        { files: { 'done.txt': '' } },
      ])
      const r = await runCli(repo, fake, ['build', id, '--loop-run', 'B1', ...FAST])
      expect(JSON.parse(r.stdout)).toMatchObject({ result: 'green', passes: 2 })
      const [first] = passesOf(repo)
      expect(first).toMatchObject({ green: false, failure: 'step', reviewErrors: [{ area: 'design', error: 'reviewer crashed' }], review: [{ area: 'tests', severity: 'LOW' }] })
      const pass2 = fake.calls().find((c) => c.prompt.includes('You are pass 2'))!
      expect(pass2.prompt).toContain('the review (design) step could not judge the change: reviewer crashed')
    })

    test('a broken reviewer beside a blocking finding: the finding fails the pass, and the error is still recorded', async () => {
      const { repo, id } = setup()
      const fake = fakeClaude([
        JUDGES[0],
        { match: 'one area: Design\\.', times: 1, result: 'no JSON here' },
        { match: 'one area: Tests\\.', times: 1, result: finding('CRITICAL') },
        JUDGES[1],
        { files: { 'done.txt': '' } },
      ])
      const r = await runCli(repo, fake, ['build', id, '--loop-run', 'B1', ...FAST])
      expect(JSON.parse(r.stdout)).toMatchObject({ result: 'green', passes: 2 })
      const [first] = passesOf(repo)
      expect(first).toMatchObject({ green: false, failure: 'review', reviewErrors: [{ area: 'design', error: 'the reviewer did not answer with a JSON array' }] })
      const pass2 = fake.calls().find((c) => c.prompt.includes('You are pass 2'))!
      expect(pass2.prompt).toContain('CRITICAL (tests) done.txt:1 — a CRITICAL problem')
      expect(pass2.prompt).not.toContain('could not judge')
    })

    test('MEDIUM and LOW findings are recorded and do not block', async () => {
      const { repo, id } = setup()
      const fake = fakeClaude([JUDGES[0], { match: 'one area: Design\\.', result: finding('MEDIUM') }, { match: 'one area: Performance\\.', result: finding('low') }, JUDGES[1], { files: { 'done.txt': '' } }])
      const r = await runCli(repo, fake, ['build', id, '--loop-run', 'B1', ...FAST])
      expect(JSON.parse(r.stdout)).toMatchObject({ result: 'green', passes: 1 })
      const [record] = passesOf(repo)
      expect(record.review.map((f: { severity: string }) => f.severity).sort()).toEqual(['LOW', 'MEDIUM'])
    })
  })

  describe('the overseer on silence (#lp-overseer-silence, #st-build-silence-act)', () => {
    test('a silent builder is cancelled, and a fresh pass starts with the reason in its brief', async () => {
      const { repo, id } = setup()
      const fake = judged([
        { match: 'You are pass 1 of', files: { 'half.txt': 'half\n' }, hangMs: 5000 },
        { match: 'You are pass 2 of', files: { 'done.txt': '' } },
      ])
      const start = Date.now()
      const r = await runCli(repo, fake, ['build', id, '--loop-run', 'B1', '--timeout', '20', '--silence', '0.4'])
      expect(Date.now() - start).toBeLessThan(4500)
      expect(JSON.parse(r.stdout)).toMatchObject({ result: 'green', passes: 2 })
      const records = passesOf(repo)
      expect(records[0]).toMatchObject({ silent: true, green: false, failure: 'silence', checks: [] })
      // The silent pass's edits are committed: the repository stays the memory.
      expect(git(repo, 'show', 'werk-build/B1~1:half.txt')).toBe('half')
      const pass2 = fake.calls().filter((c) => c.prompt.includes('You are pass 2'))[0]
      expect(pass2.prompt).toContain('cancelled by the overseer: cancelled: no event for 400ms')
      // #lp-overseer-mechanics: the cancel is a werk_overseer line in the session log and the live log.
      const cancel = { type: 'werk_overseer', kind: 'silence', silenceMs: 400, act: 'cancel the session' }
      expect(readJsonl(join(repo, '.werk', 'runs', 'B1', 'pass-1.jsonl')).filter((e) => e.type === 'werk_overseer')).toEqual([expect.objectContaining(cancel)])
      expect(readJsonl(join(repo, '.werk', 'runs', 'B1', 'live.jsonl')).filter((e) => e.type === 'werk_overseer')).toEqual([expect.objectContaining({ ...cancel, werk_session: 'pass-1' })])
    })

    test('a stall on every pass still stops at the cap, ended as silence', async () => {
      const { repo, id } = setup()
      const fake = judged([{ hangMs: 5000 }])
      const r = await runCli(repo, fake, ['build', id, '--loop-run', 'B1', '--cap', '2', '--timeout', '20', '--silence', '0.3'])
      expect(r.code).toBe(1)
      expect(JSON.parse(r.stdout)).toMatchObject({ result: 'silence', passes: 2 })
      expect(boardOf(repo).tickets.get(id)).toMatchObject({ column: 'ready', reason: 'red at the retry cap', lastEnd: 'silence', passes: 2 })
    })
  })

  describe('the overseer (#lp-overseer-progress, #lp-overseer-asks)', () => {
    const toolUse = (n: number) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', id: `t${n}`, name: 'Bash', input: { command: 'make test' } }] } })

    test('a pass the progress classifier calls looping is cancelled, and the next pass gets the reason', async () => {
      const { repo, id } = setup()
      const fake = judged([
        { match: 'You are the progress classifier', times: 1, result: '{"looping": true, "reason": "It runs make test again and again with no change."}' },
        { match: 'You are pass 1 of', files: { 'half.txt': 'half\n' }, events: [1, 2, 3, 4, 5, 6, 7, 8].map(toolUse), delayMs: 200 },
        { match: 'You are pass 2 of', files: { 'done.txt': '' } },
      ])
      const r = await runCli(repo, fake, ['build', id, '--loop-run', 'B1', ...FAST, '--progress', '0.3'])
      expect(JSON.parse(r.stdout)).toMatchObject({ result: 'green', passes: 2 })
      const records = passesOf(repo)
      expect(records[0]).toMatchObject({ green: false, failure: 'looping' })
      const classifier = fake.calls().find((c) => c.prompt.includes('You are the progress classifier'))!
      expect(classifier.prompt).toContain('Bash {"command":"make test"}')
      expect(classifier.prompt).toContain('List, end to end.')
      expect(classifier.argv.slice(-2)).toEqual(['--tools', ''])
      const pass2 = fake.calls().find((c) => c.prompt.includes('You are pass 2'))!
      expect(pass2.prompt).toContain('it was looping: It runs make test again and again with no change.')
      expect(git(repo, 'show', 'werk-build/B1~1:half.txt')).toBe('half')
      const live = readJsonl(join(repo, '.werk', 'runs', 'B1', 'live.jsonl'))
      expect(live.find((e) => e.type === 'werk_overseer' && e.kind === 'progress')).toMatchObject({ looping: true, werk_session: 'pass-1' })
      // #lp-overseer-mechanics: the verdict and its cancel are in the session log too.
      const own = readJsonl(join(repo, '.werk', 'runs', 'B1', 'pass-1.jsonl')).filter((e) => e.type === 'werk_overseer')
      expect(own).toEqual([expect.objectContaining({ kind: 'progress', looping: true, act: 'cancel the session', reason: 'It runs make test again and again with no change.' })])
    })

    test('the progress classifier watches the grader too, and a looping grader fails the pass as looping', async () => {
      const { repo, id } = setup()
      const fake = fakeClaude([
        { match: 'You are the progress classifier', times: 1, result: '{"looping": true, "reason": "It reads the same file again and again."}' },
        { match: 'You are the grader', times: 1, events: [1, 2, 3, 4, 5, 6, 7, 8].map(toolUse), delayMs: 200 },
        ...JUDGES,
        { files: { 'done.txt': '' } },
      ])
      const r = await runCli(repo, fake, ['build', id, '--loop-run', 'B1', ...FAST, '--progress', '0.3'])
      expect(JSON.parse(r.stdout)).toMatchObject({ result: 'green', passes: 2 })
      const records = passesOf(repo)
      expect(records[0]).toMatchObject({ green: false, failure: 'looping' })
      const classifier = fake.calls().find((c) => c.prompt.includes('You are the progress classifier'))!
      expect(classifier.prompt).toContain('An agent of the "grade-1" step')
      // The review does not run after a looping grader.
      expect(fake.calls().filter((c) => c.prompt.includes('You are a code reviewer'))).toHaveLength(5)
      const pass2 = fake.calls().find((c) => c.prompt.includes('You are pass 2'))!
      expect(pass2.prompt).toContain('it was looping: It reads the same file again and again.')
      const own = readJsonl(join(repo, '.werk', 'runs', 'B1', 'grade-1.jsonl')).filter((e) => e.type === 'werk_overseer')
      expect(own).toEqual([expect.objectContaining({ kind: 'progress', looping: true })])
    })

    test('a classifier answers each permission ask, and a deny carries its comment back to the builder', async () => {
      const { repo, id } = setup()
      const fake = judged([
        { match: 'rm -rf', result: '{"allow": false, "comment": "It deletes files outside the project."}' },
        { match: 'You are the permission classifier', result: 'I am not sure.' },
        { asks: [{ tool: 'Bash', input: { command: 'rm -rf ~/work' } }, { tool: 'WebFetch', input: { url: 'https://example.com' } }], files: { 'done.txt': '' } },
      ])
      const r = await runCli(repo, fake, ['build', id, '--loop-run', 'B1', ...FAST])
      expect(JSON.parse(r.stdout)).toMatchObject({ result: 'green', passes: 1 })
      const answers = readJsonl(`${fake.script}.asks.jsonl`).map((x) => x.response)
      expect(answers[0]).toEqual({ behavior: 'deny', message: 'It deletes files outside the project.', interrupt: false })
      // No verdict is a deny: nobody judged the call safe.
      expect(answers[1].behavior).toBe('deny')
      expect(answers[1].message).toContain('could not judge')
      const classifier = fake.calls().find((c) => c.prompt.includes('rm -rf'))!
      expect(classifier.prompt).toContain('You are the permission classifier')
      expect(classifier.prompt).toContain('List')
      // Every answer is in the event log.
      const live = readJsonl(join(repo, '.werk', 'runs', 'B1', 'live.jsonl')).filter((e) => e.type === 'werk_overseer')
      expect(live.map((e) => [e.kind, e.tool, e.allow])).toEqual([
        ['ask', 'Bash', false],
        ['ask', 'WebFetch', false],
      ])
      // #ms-cost: each classifier call is a session step of the pass, in a stage of its own,
      // with its transcript. It is not a pass.
      const pipeline = readJsonl<PipelineEvent>(join(repo, '.werk', 'pipeline.jsonl'))
      const calls = pipeline
        .filter((e) => e.type === 'step.ended' && e.payload.step === 'session' && (e.payload as BuildStepEnded).name?.startsWith('overseer-'))
        .map((e) => e.payload as BuildStepEnded)
      expect(calls.map((p) => [p.name, p.pass, p.file, stageOf(p.name!)])).toEqual([
        ['overseer-1', 1, '.werk/runs/B1/ask-1.jsonl', 'overseer'],
        ['overseer-2', 1, '.werk/runs/B1/ask-2.jsonl', 'overseer'],
      ])
      expect(foldPasses(pipeline).map((p) => p.pass)).toEqual([1])
    })
  })
})

describe('werk build: a decision no card makes (#st-build-missing-decision)', () => {
  test('a pass that names a spec gap and stays red makes the next pass a decision pass', async () => {
    const { repo, id } = setup()
    const fake = judged([
      { match: 'You are pass 1 of', result: 'started' },
      { match: 'You are pass 2 of', result: 'tried\nCAUSE OF THE LAST FAILURE: spec-gap — no card says where the list lives' },
      { match: 'You are pass 3 of', files: { 'done.txt': 'ok\n' } },
    ])
    const r = await runCli(repo, fake, ['build', id, '--loop-run', 'B1', '--cap', '3', ...FAST])
    expect(JSON.parse(r.stdout)).toMatchObject({ result: 'green', passes: 3 })
    const prompts = fake.calls().map((c) => c.prompt).filter((p) => p.includes('You are pass'))
    expect(prompts[1]).not.toContain('This is a decision pass')
    expect(prompts[2]).toContain('## This is a decision pass')
    expect(prompts[2]).toContain('because a pass named a spec gap as the cause of a failure: no card says where the list lives')
    expect(prompts[2]).toContain('--who you --obligation build-B1')
    expect(passesOf(repo).map((p) => p.decision)).toEqual([undefined, undefined, 'a pass named a spec gap as the cause of a failure: no card says where the list lives'])
  })

  test('the grader of a follow-up ticket reads each held-out scenario in full as a story of the ticket (#lp-prod-judge-scope)', async () => {
    const repo = makeRepo({ Makefile: MAKEFILE })
    writeLog(repo, [{ id: 'kid', body: 'Kid body.' }])
    const scenario = 'Scenario: G2 opens again\nGiven a merged ticket\nWhen the person approves G2\nThen G2 opens for the next tip'
    const text = followUpText({ steps: [{ id: '01.1', ticket: 'r1/01', text: scenario }], cites: ['kid'], checks: ['make test'] })
    const id = planTicket(repo, { num: '02', text, followUpOf: 'r1/01' })
    const fake = judged([{ match: 'You are pass 1 of', files: { 'done.txt': '' } }])
    await runCli(repo, fake, ['build', id, '--loop-run', 'B1', ...FAST])
    const grade = fake.calls().find((c) => c.prompt.includes('You are the grader'))!.prompt
    expect(grade.slice(grade.indexOf('## User stories'), grade.indexOf('## Decided cards'))).toContain(scenario)
  })

  describe('a pass that ends on a spec gap does not count against the cap (#st-build-cap-spec-gap)', () => {
    const asks = (card: string) => ({ match: 'You are the grader', times: 1, result: JSON.stringify([{ card, score: 2, gap: 'the ticket asks for what #kid forbids', person: true }]) })

    test('a grader gap only a person can settle on the last counted pass still gets its decision pass', async () => {
      const { repo, id } = setup()
      const fake = judged([{ files: { 'done.txt': 'ok\n' } }], [asks('criterion-1'), ...JUDGES])
      const r = await runCli(repo, fake, ['build', id, '--loop-run', 'B1', '--cap', '1', ...FAST])
      expect(JSON.parse(r.stdout)).toMatchObject({ result: 'green', passes: 2 })
      const prompts = fake.calls().map((c) => c.prompt).filter((p) => p.includes('You are pass'))
      expect(prompts[1]).toContain('because the grader said a person must settle: the ticket asks for what #kid forbids')
      expect(passesOf(repo).map((p) => p.free)).toEqual([true, undefined])
      const t = boardOf(repo).tickets.get(id)!
      expect(t).toMatchObject({ passes: 2, freePasses: 1 })
    })

    test('a pass the next pass names a spec gap is given back to the ticket', async () => {
      const { repo, id } = setup()
      const fake = judged([
        { match: 'You are pass 1 of', result: 'started' },
        { match: 'You are pass 2 of', result: 'tried\nCAUSE OF THE LAST FAILURE: spec-gap — no card says where the list lives' },
        { match: 'You are pass 3 of', files: { 'done.txt': 'ok\n' } },
      ])
      const r = await runCli(repo, fake, ['build', id, '--loop-run', 'B1', '--cap', '2', ...FAST])
      expect(JSON.parse(r.stdout)).toMatchObject({ result: 'green', passes: 3 })
      expect(passesOf(repo).map((p) => p.freed)).toEqual([undefined, 1, undefined])
      expect(boardOf(repo).tickets.get(id)!.freePasses).toBe(1)
    })

    test('a second free pass needs a proposal since the first, so a gap that keeps coming back meets the cap', async () => {
      const { repo, id } = setup()
      const always = { match: 'You are the grader', result: JSON.stringify([{ card: 'criterion-1', score: 2, gap: 'the ticket asks for what #kid forbids', person: true }]) }
      const fake = judged([{ files: { 'done.txt': 'ok\n' } }], [always, ...JUDGES])
      const r = await runCli(repo, fake, ['build', id, '--loop-run', 'B1', '--cap', '1', ...FAST])
      expect(JSON.parse(r.stdout)).toMatchObject({ result: 'cap', passes: 2 })
      expect(passesOf(repo).map((p) => p.free)).toEqual([true, undefined])
    })
  })

  test("a card an earlier build of the ticket proposed reaches the builder and the grader, and the green build records it on the board", async () => {
    const { repo, id } = setup()
    const log = join(repo, '.werk', 'log.jsonl')
    const seq = readJsonl(log).length
    const events = [
      { type: 'obligation.created', payload: { id: 'build-OLD', ticket: id, cites: ['kid'] } },
      { type: 'node.proposed', payload: { id: 'kid-where', kind: 'card', title: 'The list lives in one file', why: 'No card said where.', body: 'One file per project.', status: 'decided', obligation: 'build-OLD' } },
    ]
    appendFileSync(log, events.map((e, i) => JSON.stringify({ seq: seq + i + 1, at: '2026-10-01T10:00:00.000Z', actor: 'agent', ...e })).join('\n') + '\n')
    const grader = { match: 'You are the grader', result: JSON.stringify(['criterion-1', 'scope-line', 'kid', 'base', 'kid-where'].map((card) => ({ card, score: 4, gap: '' }))) }
    const fake = judged([{ match: 'You are pass 1 of', files: { 'done.txt': 'ok\n' } }], [grader, JUDGES[1]])
    const r = await runCli(repo, fake, ['build', id, '--loop-run', 'B1', ...FAST])
    expect(JSON.parse(r.stdout)).toMatchObject({ result: 'green', passes: 1 })
    const pass1 = fake.calls().find((c) => c.prompt.includes('You are pass 1'))!.prompt
    expect(pass1).toContain('## Decisions earlier passes of this ticket proposed')
    expect(pass1).toContain('### #kid-where — The list lives in one file')
    expect(fake.calls().find((c) => c.prompt.includes('You are the grader'))!.prompt).toContain('kid-where')
    expect(Object.keys(boardOf(repo).tickets.get(id)!.proposals ?? {})).toEqual(['kid-where'])
  })
})
