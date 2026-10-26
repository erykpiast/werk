import { describe, expect, test } from 'bun:test'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { foldBoard } from './board.ts'
import type { BoardEvent } from './board.ts'
import { fakeClaude, git, MAKEFILE, makeRepo, planTicket, readJsonl, runCli, writeLog } from './testing/fixture.ts'
import type { FakeRule } from './testing/fake-claude.ts'
import { stageOf } from './measures.ts'
import { foldPasses } from './pipeline.ts'
import type { BuildStepEnded, PipelineEvent } from './pipeline.ts'
import { JUDGES, SPEC, ticket } from './testing/samples.ts'

export const FAST = ['--timeout', '20', '--silence', '5', '--check-timeout', '20']

/** `make test` passes once done.txt exists. `make merged` fails in a merge-queue tree until
 *  the file named by $FLAG exists, so a ticket can be green alone and red on the main line. */
const MAKE = `${MAKEFILE}merged:\n\t@case "$$PWD" in *werk-merge-wt*) test -f "$(FLAG)" || (echo "red on the main line" && exit 1) ;; esac\n`

export function setupRun(o: { second?: { blockedBy?: string[]; checks?: string }; checks?: string } = {}) {
  const repo = makeRepo({ Makefile: MAKE })
  writeLog(repo, [{ id: 'root', body: 'The root decision.' }, { id: 'kid', parent: 'root', body: 'Kid body.' }])
  const first = planTicket(repo, { num: '01', text: ticket({ title: 'First', cites: 'kid', stories: '1', checks: o.checks }), spec: SPEC })
  const second = o.second ? planTicket(repo, { num: '02', text: ticket({ title: 'Second', cites: 'kid', stories: '2', checks: o.second.checks }), blockedBy: o.second.blockedBy }) : undefined
  return { repo, first, second }
}

export const boardEvents = (repo: string) => readJsonl<BoardEvent>(join(repo, '.werk', 'board.jsonl'))
export const boardOf = (repo: string) => foldBoard(boardEvents(repo))
const judged = (rules: FakeRule[]) => fakeClaude([...JUDGES, ...rules])

describe('werk run: the merge loop (#st-build-run)', () => {
  test('builds one ticket at a time, merges each onto the main line, and unblocks the next', async () => {
    const { repo, first, second } = setupRun({ second: { blockedBy: ['r1/01'] } })
    const fake = judged([
      { match: 'Ticket: First', files: { 'done.txt': 'one\n' } },
      { match: 'Ticket: Second', files: { 'two.txt': 'two\n' } },
    ])
    const r = await runCli(repo, fake, ['run', 'r1', ...FAST])
    expect(r.code).toBe(0)
    const out = JSON.parse(r.stdout)
    expect(out).toMatchObject({ run: 'r1', end: 'gate' })
    expect(out.merges.map((m: { ticket: string; green: boolean }) => [m.ticket, m.green])).toEqual([
      [first, true],
      [second, true],
    ])

    // The main line holds both tickets' work, and its checkout followed it (#st-plan-main).
    expect(git(repo, 'show', 'main:done.txt')).toBe('one')
    expect(git(repo, 'show', 'main:two.txt')).toBe('two')
    expect(readFileSync(join(repo, 'two.txt'), 'utf8')).toBe('two\n')
    expect(git(repo, 'status', '--porcelain')).toBe('')
    expect(git(repo, 'branch', '--list', 'werk-run/*')).toBe('')
    expect(git(repo, 'worktree', 'list').split('\n')).toHaveLength(1)

    // Serial: the second ticket starts only after the first is done, and moves with a reason.
    const ev = boardEvents(repo)
    const doneFirst = ev.findIndex((e) => e.type === 'ticket.moved' && (e.payload as { id: string }).id === first && (e.payload as { to: string }).to === 'done')
    const unblocked = ev.findIndex((e) => e.type === 'ticket.moved' && (e.payload as { id: string }).id === second && (e.payload as { to: string }).to === 'ready')
    const startSecond = ev.findIndex((e) => e.type === 'ticket.build.started' && (e.payload as { id: string }).id === second)
    expect(doneFirst).toBeGreaterThan(-1)
    expect(unblocked).toBeGreaterThan(doneFirst)
    expect(startSecond).toBeGreaterThan(unblocked)
    expect((ev[unblocked].payload as { reason: string }).reason).toContain('r1/01')

    const b = boardOf(repo)
    expect(b.tickets.get(first)).toMatchObject({ column: 'done', lastMerge: { green: true } })
    expect(b.tickets.get(second!)).toMatchObject({ column: 'done' })
  })

  test('a red check on the main line does not stop the merge, and files a follow-up that fixes it (#ms-merge-red-follow-up)', async () => {
    const flagDir = mkdtempSync(join(tmpdir(), 'werk-flag-'))
    const flag = join(flagDir, 'flag')
    const { repo, first } = setupRun({ checks: '- `make test`\n- `make merged`' })
    const fake = judged([
      { match: 'Ticket: Fix the red checks', files: { 'fix.txt': 'fixed\n' }, sh: [`touch "${flag}"`] },
      { match: 'Ticket: First', files: { 'done.txt': 'one\n' } },
    ])
    const before = git(repo, 'rev-parse', 'HEAD')
    const r = await runCli(repo, fake, ['run', 'r1', ...FAST], { FLAG: flag })
    expect(r.code).toBe(0)
    const out = JSON.parse(r.stdout)
    // Both merges are green: the first with a red check, the follow-up with none.
    expect(out.merges.map((m: { green: boolean }) => m.green)).toEqual([true, true])
    expect(out.builds).toHaveLength(2)
    expect(git(repo, 'show', 'main:done.txt')).toBe('one')
    expect(git(repo, 'show', 'main:fix.txt')).toBe('fixed')
    expect(git(repo, 'rev-parse', 'HEAD')).not.toBe(before)
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(out.merges[1].commit)

    // The first merge names the red check. The follow-up cites nothing blocking, quotes the output.
    const ev = boardEvents(repo)
    const merges = ev.filter((e) => e.type === 'ticket.merge').map((e) => e.payload as { id: string; green: boolean; failedChecks?: string[] })
    expect(merges.map((m) => [m.id, m.green, m.failedChecks])).toEqual([
      [first, true, ['make merged']],
      ['r1/02', true, undefined],
    ])
    const planned = ev.filter((e) => e.type === 'ticket.planned' && (e.payload as { followUpOf?: string }).followUpOf === first).map((e) => e.payload as { id: string; title: string; blockedBy: string[] })
    expect(planned).toHaveLength(1)
    expect(planned[0]).toMatchObject({ id: 'r1/02', title: `Fix the red checks of ${first}`, blockedBy: [] })
    const text = readFileSync(join(repo, '.werk', 'tickets', 'r1', '02.md'), 'utf8')
    expect(text).toContain('red on the main line')
    expect(text).toContain('- `make merged`')
    expect(boardOf(repo).tickets.get(first)).toMatchObject({ column: 'done' })

    // #ms-store: each merge attempt is a step under the build it merges, and each of its
    // checks a step with its whole output in a file beside the log (#ms-store-files). A red
    // check runs once.
    const pipeline = readJsonl<PipelineEvent>(join(repo, '.werk', 'pipeline.jsonl'))
    const ends = pipeline.filter((e) => e.type === 'step.ended').map((e) => e.payload as BuildStepEnded)
    const mergeSteps = ends.filter((p) => p.step === 'merge')
    expect(mergeSteps.map((p) => [p.build, p.ticket, p.result])).toEqual([
      [out.builds[0].loopRun, first, 'green'],
      [out.builds[1].loopRun, 'r1/02', 'green'],
    ])
    const mergeChecks = ends.filter((p) => p.step === 'check' && p.pass === undefined)
    expect(mergeChecks.map((p) => [p.name, p.result])).toEqual([
      ['make test', 'ok'],
      ['make merged', 'red'],
      ['make merged', 'ok'],
    ])
    expect(readFileSync(join(repo, mergeChecks[1].file!), 'utf8')).toContain('red on the main line')
    // The merge steps are not builder passes: one pass per build.
    expect(foldPasses(pipeline).map((p) => [p.loopRun, p.pass])).toEqual([
      [out.builds[0].loopRun, 1],
      [out.builds[1].loopRun, 1],
    ])
  })

  test('two unblocked tickets build at once; a build that stays red parks that ticket, and the run ends stuck when nothing else can go', async () => {
    const { repo, first, second } = setupRun({ second: {} })
    const fake = judged([{ result: 'no luck' }])
    const r = await runCli(repo, fake, ['run', 'r1', '--cap', '2', ...FAST])
    expect(r.code).toBe(1)
    const out = JSON.parse(r.stdout)
    expect(out.end).toBe('stuck')
    // #st-build-stuck-park: the end names each stuck ticket.
    expect(out.detail.split(' | ').sort()).toEqual([`${first} stuck: cap`, `${second} stuck: cap`])
    // #st-build-parallel: neither waited for the other.
    expect(out.builds.map((b: { ticket: string }) => b.ticket).sort()).toEqual([first, second])
    // Each is parked in blocked with the stuck hold, not left in building.
    for (const id of [first, second!]) {
      expect(boardOf(repo).tickets.get(id)).toMatchObject({ column: 'blocked', passes: 2, heldBy: 'stuck', reason: 'stuck: cap' })
    }
    expect(boardEvents(repo).at(-1)).toMatchObject({ type: 'run.ended', payload: { run: 'r1', end: 'stuck' } })
  })

  test('a stuck ticket stops only the tickets that need it; the others still build and merge (#st-build-stuck-park)', async () => {
    const repo = makeRepo({ Makefile: MAKE })
    writeLog(repo, [{ id: 'root', body: 'The root decision.' }, { id: 'kid', parent: 'root', body: 'Kid body.' }])
    const bad = planTicket(repo, { num: '01', text: ticket({ title: 'Bad', cites: 'kid', stories: '1' }), spec: SPEC })
    const needsBad = planTicket(repo, { num: '02', text: ticket({ title: 'Needs bad', cites: 'kid', stories: '2' }), blockedBy: [bad] })
    const good = planTicket(repo, { num: '03', text: ticket({ title: 'Good', cites: 'kid', stories: '3' }) })
    const fake = judged([
      { match: 'Ticket: Good', files: { 'done.txt': 'good\n' } },
      { match: 'Ticket: Bad', result: 'no luck' },
    ])
    const r = await runCli(repo, fake, ['run', 'r1', '--cap', '1', ...FAST])
    expect(r.code).toBe(1)
    const out = JSON.parse(r.stdout)
    expect(out.end).toBe('stuck')
    expect(out.detail).toBe(`${bad} stuck: cap; 1 ticket(s) wait on it: ${needsBad}`)
    expect(out.merges).toEqual([expect.objectContaining({ ticket: good, green: true })])
    const b = boardOf(repo)
    expect(b.tickets.get(good)).toMatchObject({ column: 'done' })
    expect(b.tickets.get(bad)).toMatchObject({ column: 'blocked', heldBy: 'stuck' })
    expect(b.tickets.get(needsBad)).toMatchObject({ column: 'blocked', openBlockers: [bad] })
    expect(boardEvents(repo).some((e) => e.type === 'ticket.build.started' && (e.payload as { id: string }).id === needsBad)).toBe(false)
  })

  test('a second werk run on a run that a live one holds is refused', async () => {
    const { repo } = setupRun()
    // The test runner itself is a live process: it stands in for the holding run.
    appendFileSync(join(repo, '.werk', 'board.jsonl'), JSON.stringify({ seq: 999, at: '', actor: 'agent', type: 'run.started', payload: { run: 'r1', pid: process.pid } }) + '\n')
    const r = await runCli(repo, fakeClaude([]), ['run', 'r1', ...FAST])
    expect(r.code).toBe(1)
    expect(JSON.parse(r.stdout)).toMatchObject({ end: 'error', detail: `werk run r1 is already running (pid ${process.pid})` })
  })

  test('a ticket that a failed set check holds stays blocked after its blockers merge (#st-build-parallel)', async () => {
    const { repo, second } = setupRun({ second: { blockedBy: ['r1/01'] } })
    const hold = { id: second, to: 'blocked', reason: 'set check blocked_by failed: x', check: 'blocked_by' }
    appendFileSync(join(repo, '.werk', 'board.jsonl'), JSON.stringify({ seq: 999, at: '', actor: 'agent', type: 'ticket.moved', payload: hold }) + '\n')
    const fake = judged([{ match: 'Ticket: First', files: { 'done.txt': 'one\n' } }])
    const r = await runCli(repo, fake, ['run', 'r1', ...FAST])
    expect(r.code).toBe(1)
    expect(JSON.parse(r.stdout)).toMatchObject({ end: 'blocked', detail: `${second} is held by the failed set check blocked_by` })
    expect(boardEvents(repo).some((e) => e.type === 'ticket.build.started' && (e.payload as { id: string }).id === second)).toBe(false)
  })

  test('a local change in the checkout of main that blocks the fast-forward moves nothing and stops the run', async () => {
    const { repo, first } = setupRun()
    const fake = judged([{ match: 'Ticket: First', files: { 'done.txt': 'one\n' } }])
    // A person's file in the checkout of main, where the ticket's file would land.
    writeFileSync(join(repo, 'done.txt'), 'a person is editing this\n')
    const before = git(repo, 'rev-parse', 'main')
    const r = await runCli(repo, fake, ['run', 'r1', ...FAST])
    expect(r.code).toBe(1)
    const out = JSON.parse(r.stdout)
    expect(out.end).toBe('checkout')
    expect(out.detail).toContain(`${first} is green, but main is checked out at ${realpathSync(repo)}`)
    expect(out.detail).toContain('done.txt')
    expect(out.merges).toEqual([{ ticket: first, green: false, detail: out.detail }])
    // Nothing moved, and no red merge is recorded: the fault is not the ticket's own. The stop
    // returns it to ready (#st-build-stop-ready).
    expect(git(repo, 'rev-parse', 'main')).toBe(before)
    expect(readFileSync(join(repo, 'done.txt'), 'utf8')).toBe('a person is editing this\n')
    expect(boardEvents(repo).some((e) => e.type === 'ticket.merge')).toBe(false)
    expect(boardOf(repo).tickets.get(first)).toMatchObject({ column: 'ready', loopStop: 'checkout' })
    expect(boardEvents(repo).at(-1)).toMatchObject({ type: 'run.ended', payload: { run: 'r1', end: 'checkout', detail: out.detail } })
    expect(git(repo, 'worktree', 'list').split('\n')).toHaveLength(1)
  })

  test('a run with no main line is refused before any agent call (#werk-base-branch)', async () => {
    const { repo } = setupRun()
    git(repo, 'branch', '-m', 'main', 'trunk')
    const fake = fakeClaude([])
    const r = await runCli(repo, fake, ['run', 'r1', ...FAST])
    expect(r.code).toBe(1)
    expect(JSON.parse(r.stdout)).toMatchObject({ end: 'error', detail: 'no main line branch main' })
    expect(fake.calls()).toHaveLength(0)
    expect(boardEvents(repo).some((e) => e.type === 'run.started' || e.type === 'ticket.build.started')).toBe(false)
  })

  test('a run with no tickets is an error before any agent call', async () => {
    const { repo } = setupRun()
    const fake = fakeClaude([])
    const r = await runCli(repo, fake, ['run', 'nope', ...FAST])
    expect(r.code).toBe(1)
    expect(JSON.parse(r.stdout)).toMatchObject({ end: 'error' })
    expect(fake.calls()).toHaveLength(0)
  })
})

describe('werk run: the held-out set (#lp-prod-heldout, #st-validate-heldout)', () => {
  const STEPS = `Scenario: the list shows
Given the app is open
When the user opens the list
Then the list shows every item

Scenario: an item is kept
Given the app is open
When the user adds an item
Then the item is still there after a restart`
  const verdicts = (second: string) => JSON.stringify([{ id: '01.1', result: 'pass', detail: 'ok' }, { id: '01.2', result: second, detail: 'the item is gone after a restart' }])

  test('a red step after a merge files a follow-up with that step, and the merge stands', async () => {
    const { repo, first } = setupRun()
    const fake = judged([
      { match: 'You are the step author', result: STEPS },
      { match: 'You are the binder', times: 1, result: verdicts('fail'), files: { '.werk-heldout/list.test.ts': 'test code' } },
      { match: 'You are the binder', result: verdicts('pass') },
      { match: 'a failed user path work', files: { 'kept.txt': 'kept\n' } },
      { match: 'Ticket: First', files: { 'done.txt': 'one\n' } },
    ])
    const r = await runCli(repo, fake, ['run', 'r1', ...FAST])
    expect(r.code).toBe(0)
    const out = JSON.parse(r.stdout)
    expect(out.end).toBe('gate')

    // The steps live outside every worktree, and never on the main line.
    expect(readJsonl(join(repo, '.werk', 'board.jsonl')).find((e) => e.type === 'ticket.steps').payload).toMatchObject({ id: first, count: 2, file: '.werk/heldout/r1/01.steps.md' })
    expect(git(repo, 'ls-tree', '-r', '--name-only', 'main')).not.toContain('steps')
    expect(git(repo, 'ls-tree', '-r', '--name-only', 'main')).not.toContain('.werk-heldout')

    // The first held-out run is red on step 2: a follow-up in ready, the merge kept.
    const heldout = boardEvents(repo).filter((e) => e.type === 'ticket.heldout').map((e) => e.payload)
    expect(heldout[0]).toEqual({ id: first, green: false, failed: ['01.2 an item is kept'], followUps: ['r1/02'] })
    const followUp = boardOf(repo).tickets.get('r1/02')!
    expect(followUp).toMatchObject({ followUpOf: first, steps: ['01.2'], column: 'done' })
    // #werk-board-columns: the badge stays on the done ticket whose merge the red run followed.
    expect(boardOf(repo).tickets.get(first)).toMatchObject({ column: 'done', heldOutRed: true, followUp: 'r1/02' })
    expect(heldout.at(-1)).toMatchObject({ id: 'r1/02', green: true })

    // #lp-heldout-feedback: the follow-up's builder gets the failed step word for word, and
    // neither the other step nor the test code.
    const builder = fake.calls().find((c) => c.prompt.includes('a failed user path work'))!.prompt
    expect(builder).toContain('When the user adds an item\nThen the item is still there after a restart')
    expect(builder).not.toContain('the list shows every item')
    expect(builder).not.toContain('test code')
    // A follow-up gets no step author of its own; the binder sees every step. The step author
    // runs once more to read the red step against its cards (#st-heldout-step-contradiction).
    expect(fake.calls().filter((c) => c.prompt.includes('You are the step author'))).toHaveLength(2)
    expect(fake.calls().find((c) => c.prompt.includes('You are the binder'))!.prompt).toContain('### 01.1')
    expect(git(repo, 'show', 'main:kept.txt')).toBe('kept')

    // #ms-cost, #ms-store-files: each held-out session is a step with its transcript, under
    // the run's held-out directory, with no pass, so it is a stage of its own.
    const pipeline = readJsonl<PipelineEvent>(join(repo, '.werk', 'pipeline.jsonl'))
    const sessions = pipeline.filter((e) => e.type === 'step.ended' && e.payload.step === 'session' && (e.payload as BuildStepEnded).build === 'r1-heldout').map((e) => e.payload as BuildStepEnded)
    expect(sessions.map((p) => [p.name, p.ticket, p.result, p.pass])).toEqual([
      ['heldout-author-01', first, 'ok', undefined],
      ['heldout-binder-01', first, 'ok', undefined],
      // The step author reads the red step against its cards (#st-heldout-step-contradiction),
      // and the follow-up's red step runs in its merge gate (#st-heldout-followup-gate).
      ['heldout-author-01', first, 'ok', undefined],
      ['heldout-binder-gate-02', 'r1/02', 'ok', undefined],
      ['heldout-binder-02', 'r1/02', 'ok', undefined],
    ])
    for (const p of sessions) expect(readFileSync(join(repo, p.file!), 'utf8')).not.toBe('')
    expect(new Set(sessions.map((p) => stageOf(p.name!)))).toEqual(new Set(['heldout-author', 'heldout-binder', 'heldout-binder-gate']))
    expect(foldPasses(pipeline).every((p) => p.loopRun !== 'r1-heldout')).toBe(true)
  })

  test('a step an open follow-up already carries files no second follow-up', async () => {
    // The second waits on the first, so the first's steps are merged when the second merges
    // (#st-heldout-merged-only). The follow-up's builder is slow, so the second merges while
    // the follow-up is still open.
    const { repo, first, second } = setupRun({ second: { blockedBy: ['r1/01'], checks: '- `make lint`' } })
    const fake = judged([
      { match: 'You are the step author[\\s\\S]*The ticket: First', result: STEPS },
      { match: 'You are the step author', result: 'No scenario from me.' },
      // Red on step 01.2 after the first and the second merge; green after the follow-up's.
      { match: 'You are the binder', times: 2, result: verdicts('fail') },
      { match: 'You are the binder', result: verdicts('pass') },
      { match: 'a failed user path work', files: { 'kept.txt': 'kept\n' }, hangMs: 1500 },
      { match: 'Ticket: First', files: { 'done.txt': 'one\n' } },
      { match: 'Ticket: Second', files: { 'two.txt': 'two\n' } },
    ])
    const r = await runCli(repo, fake, ['run', 'r1', ...FAST])
    expect(r.code).toBe(0)
    expect(JSON.parse(r.stdout).end).toBe('gate')
    const heldout = boardEvents(repo)
      .filter((e) => e.type === 'ticket.heldout')
      .map((e) => e.payload)
    expect(heldout).toEqual([
      { id: first, green: false, failed: ['01.2 an item is kept'], followUps: ['r1/03'] },
      // The follow-up r1/03 is still open and carries 01.2: no second follow-up.
      { id: second!, green: false, failed: ['01.2 an item is kept'] },
      { id: 'r1/03', green: true },
    ])
    const followUps = [...boardOf(repo).tickets.values()].filter((t) => t.followUpOf)
    expect(followUps.map((t) => [t.id, t.steps])).toEqual([['r1/03', ['01.2']]])
    // Three builds, a slow one among them, and three binder runs: past the default 5 s.
  }, 15_000)

  test('red steps of two tickets file one follow-up per source ticket, each citing its own source (#st-heldout-followup-per-ticket)', async () => {
    const { repo, first, second } = setupRun({ second: { blockedBy: ['r1/01'], checks: '- `make lint`' } })
    const both = JSON.stringify([
      { id: '01.1', result: 'pass', detail: 'ok' },
      { id: '01.2', result: 'fail', detail: 'gone' },
      { id: '02.1', result: 'fail', detail: 'empty' },
      { id: '02.2', result: 'pass', detail: 'ok' },
    ])
    const fake = judged([
      { match: 'You are the step author', result: STEPS },
      { match: 'You are the binder[\\s\\S]*### 02\\.1', times: 1, result: both },
      { match: 'You are the binder[\\s\\S]*### 02\\.1', result: JSON.stringify(['01.1', '01.2', '02.1', '02.2'].map((id) => ({ id, result: 'pass', detail: 'ok' }))) },
      { match: 'You are the binder', result: verdicts('pass') },
      { match: 'a failed user path work', files: { 'kept.txt': 'kept\n' } },
      { match: 'Ticket: First', files: { 'done.txt': 'one\n' } },
      { match: 'Ticket: Second', files: { 'two.txt': 'two\n' } },
    ])
    const r = await runCli(repo, fake, ['run', 'r1', ...FAST])
    expect(r.code).toBe(0)
    const red = boardEvents(repo).find((e) => e.type === 'ticket.heldout' && (e.payload as { green: boolean }).green === false)!.payload
    expect(red).toEqual({ id: second!, green: false, failed: ['01.2 an item is kept', '02.1 the list shows'], followUps: ['r1/03', 'r1/04'] })
    const followUps = [...boardOf(repo).tickets.values()].filter((t) => t.followUpOf)
    expect(followUps.map((t) => [t.id, t.followUpOf, t.steps])).toEqual([
      ['r1/03', first, ['01.2']],
      ['r1/04', second, ['02.1']],
    ])
    // #werk-board-columns: the badge on the merged ticket links the first; the drawer lists both.
    expect(boardOf(repo).tickets.get(second!)).toMatchObject({ followUps: ['r1/03', 'r1/04'], followUp: 'r1/03' })
  }, 15_000)

  describe('a step written before its source card changed (#st-heldout-step-fresh)', () => {
    /** Steps of ticket 01 written before the run, from an older wording of #kid. */
    const staleSteps = (repo: string, sources: string | undefined) => {
      mkdirSync(join(repo, '.werk', 'heldout', 'r1'), { recursive: true })
      writeFileSync(join(repo, '.werk', 'heldout', 'r1', '01.steps.md'), STEPS + '\n')
      if (sources) writeFileSync(join(repo, '.werk', 'heldout', 'r1', '01.sources.json'), sources)
    }

    test('is rewritten by the step author from the current card before the set runs', async () => {
      const { repo, first } = setupRun()
      staleSteps(repo, JSON.stringify({ kid: 'an-old-print' }))
      const kept = STEPS.split('\n\n')[0]
      const fake = judged([
        { match: 'Your earlier scenarios', result: kept },
        { match: 'You are the binder', result: JSON.stringify([{ id: '01.1', result: 'pass', detail: 'ok' }]) },
        { match: 'Ticket: First', files: { 'done.txt': 'one\n' } },
      ])
      const r = await runCli(repo, fake, ['run', 'r1', ...FAST])
      expect(JSON.parse(r.stdout).end).toBe('gate')
      const rewrite = fake.calls().find((c) => c.prompt.includes('Your earlier scenarios'))!.prompt
      expect(rewrite).toContain('these cards changed or went: #kid')
      expect(rewrite).toContain('Kid body.')
      expect(rewrite).toContain('Then the item is still there after a restart')
      // The dropped step does not run, and the steps now record the current card.
      expect(fake.calls().find((c) => c.prompt.includes('You are the binder'))!.prompt).not.toContain('### 01.2')
      expect(readFileSync(join(repo, '.werk', 'heldout', 'r1', '01.steps.md'), 'utf8')).toBe(kept + '\n')
      expect(JSON.parse(readFileSync(join(repo, '.werk', 'heldout', 'r1', '01.sources.json'), 'utf8')).kid).not.toBe('an-old-print')
      expect(boardEvents(repo).find((e) => e.type === 'ticket.steps')!.payload).toMatchObject({ id: first, count: 1, rewritten: ['kid'] })
      // A step author that writes the steps with the ticket records their sources itself, so
      // the next run rewrites nothing.
      expect(fake.calls().filter((c) => c.prompt.includes('Your earlier scenarios'))).toHaveLength(1)
    })

    test('does not run, and files no follow-up, while the step author cannot rewrite it', async () => {
      const { repo, first } = setupRun()
      staleSteps(repo, undefined)
      const fake = judged([
        { match: 'Your earlier scenarios', result: 'I cannot tell.' },
        { match: 'You are the binder', result: verdicts('fail') },
        { match: 'Ticket: First', files: { 'done.txt': 'one\n' } },
      ])
      const r = await runCli(repo, fake, ['run', 'r1', ...FAST])
      expect(JSON.parse(r.stdout).end).toBe('heldout')
      expect(fake.calls().some((c) => c.prompt.includes('You are the binder'))).toBe(false)
      const heldout = boardEvents(repo).find((e) => e.type === 'ticket.heldout')!.payload as { green: boolean; binderErrors: string[]; followUps?: string[] }
      expect(heldout).toMatchObject({ id: first, green: false })
      expect(heldout.followUps).toBeUndefined()
      expect(heldout.binderErrors[0]).toBe('01.1 the list shows: a source card changed, and the step author could not rewrite it: the step author wrote no Given/When/Then scenario')
    })
  })

  test('the run after a merge binds only the steps of merged tickets (#st-heldout-merged-only)', async () => {
    // Both build at once; the second is slow, so the first merges while the second builds.
    const { repo, first, second } = setupRun({ second: { checks: '- `make lint`' } })
    const fake = judged([
      { match: 'You are the step author', result: STEPS },
      { match: 'You are the binder[\\s\\S]*### 02\\.1', result: JSON.stringify(['01.1', '01.2', '02.1', '02.2'].map((id) => ({ id, result: 'pass', detail: 'ok' }))) },
      { match: 'You are the binder', result: verdicts('pass') },
      { match: 'Ticket: First', files: { 'done.txt': 'one\n' } },
      { match: 'Ticket: Second', files: { 'two.txt': 'two\n' }, hangMs: 1500 },
    ])
    const r = await runCli(repo, fake, ['run', 'r1', ...FAST])
    expect(JSON.parse(r.stdout).end).toBe('gate')
    const binders = fake.calls().filter((c) => c.prompt.includes('You are the binder'))
    expect(binders).toHaveLength(2)
    // After the first merge: the first's steps only, though the second's are written.
    expect(binders[0]!.prompt).toContain('### 01.1')
    expect(binders[0]!.prompt).not.toContain('### 02.1')
    // After the second merge: both.
    expect(binders[1]!.prompt).toContain('### 02.1')
    expect(boardEvents(repo).filter((e) => e.type === 'ticket.heldout').map((e) => (e.payload as { id: string }).id)).toEqual([first, second!])
  })

  test('the step author runs beside the builder, with no tools and outside the worktree', async () => {
    const { repo } = setupRun()
    const fake = judged([
      { match: 'You are the step author', result: STEPS, hangMs: 300 },
      { match: 'You are the binder', result: verdicts('pass') },
      { match: 'Ticket: First', files: { 'done.txt': 'one\n' }, hangMs: 300 },
    ])
    await runCli(repo, fake, ['run', 'r1', ...FAST])
    const calls = fake.calls()
    const author = calls.findIndex((c) => c.prompt.includes('You are the step author'))
    const grader = calls.findIndex((c) => c.prompt.includes('You are the grader'))
    expect(author).toBeGreaterThan(-1)
    expect(author).toBeLessThan(grader)
    expect(calls[author].argv.slice(-2)).toEqual(['--tools', ''])
    expect(calls[author].cwd).toContain(join('.werk', 'heldout', 'r1'))
    expect(calls[author].prompt).toContain('List, end to end.'.replace('List', 'First'))
    // The builder's brief holds no step.
    expect(calls.find((c) => c.prompt.includes('You are pass'))!.prompt).not.toContain('Scenario:')
  })

  test('a binder that changes the product voids its report; a binder error files no follow-up and needs a person', async () => {
    const { repo } = setupRun()
    const fake = judged([
      { match: 'You are the step author', result: STEPS },
      { match: 'You are the binder', times: 1, result: verdicts('pass'), files: { 'done.txt': 'patched by the binder\n' } },
      { match: 'You are the binder', result: verdicts('binder-error') },
      { match: 'Ticket: First', files: { 'done.txt': 'one\n' } },
    ])
    const r = await runCli(repo, fake, ['run', 'r1', ...FAST])
    expect(r.code).toBe(1)
    const out = JSON.parse(r.stdout)
    expect(out.end).toBe('heldout')
    const heldout = boardEvents(repo).filter((e) => e.type === 'ticket.heldout').map((e) => e.payload as { green: boolean; binderErrors: string[]; followUps?: string[] })
    expect(heldout[0].binderErrors[0]).toContain('changed files outside .werk-heldout/: done.txt')
    expect(heldout.at(-1)!.binderErrors).toEqual(['01.2 an item is kept: the item is gone after a restart'])
    expect(heldout.every((h) => !h.followUps)).toBe(true)
    // The binder's patch never reached the main line.
    expect(git(repo, 'show', 'main:done.txt')).toBe('one')
  })

  test('a step through a capability that an unmerged ticket builds is not run, files no follow-up, and is tried again after that merge (#st-heldout-unbuilt-capability)', async () => {
    const { repo, first, second } = setupRun({ second: { blockedBy: ['r1/01'], checks: '- `make lint`' } })
    const unbuilt = JSON.stringify([{ id: '01.1', result: 'pass', detail: 'ok' }, { id: '01.2', result: 'unbuilt', owner: second, detail: 'there is no restart operation' }])
    const fake = judged([
      { match: 'You are the step author[\\s\\S]*The ticket: First', result: STEPS },
      { match: 'You are the step author', result: 'No scenario from me.' },
      { match: 'You are the binder', times: 1, result: unbuilt },
      { match: 'You are the binder', result: verdicts('pass') },
      { match: 'Ticket: First', files: { 'done.txt': 'one\n' } },
      { match: 'Ticket: Second', files: { 'two.txt': 'two\n' } },
    ])
    const r = await runCli(repo, fake, ['run', 'r1', ...FAST])
    expect(r.code).toBe(0)
    expect(JSON.parse(r.stdout).end).toBe('gate')
    const heldout = boardEvents(repo).filter((e) => e.type === 'ticket.heldout').map((e) => e.payload as { id: string; green: boolean; binderErrors?: string[]; followUps?: string[] })
    expect(heldout[0]).toMatchObject({ id: first, green: false })
    expect(heldout[0].binderErrors).toEqual([`01.2 an item is kept: it needs a capability that ${second} builds, and ${second} is not merged: there is no restart operation`])
    expect(heldout[0].followUps).toBeUndefined()
    expect(heldout.at(-1)).toMatchObject({ green: true })
    expect([...boardOf(repo).tickets.values()].filter((t) => t.followUpOf)).toEqual([])
    // The binder was told which tickets were not merged when it ran the first time.
    expect(fake.calls().find((c) => c.prompt.includes('You are the binder'))!.prompt).toContain(`- ${second}:`)
  }, 15_000)

  test('a red step that contradicts its card files a decision follow-up, waits as not run, and runs again once rewritten (#st-heldout-step-contradiction)', async () => {
    const { repo, first } = setupRun()
    const contradicts = JSON.stringify([{ id: '01.2', verdict: 'contradicts', card: 'kid', why: 'the card says the item is not kept' }])
    const fake = judged([
      { match: 'You are the step author[\\s\\S]*## Red steps', result: contradicts },
      { match: 'You are the step author[\\s\\S]*## Your earlier scenarios', result: STEPS.split('\n\n')[0] },
      { match: 'You are the step author', result: STEPS },
      { match: 'You are the binder', times: 1, result: verdicts('fail') },
      { match: 'You are the binder', result: JSON.stringify([{ id: '01.1', result: 'pass', detail: 'ok' }]) },
      { match: 'Judge a held-out step against a decided card', files: { 'decided.txt': 'kid is right\n' } },
      { match: 'Ticket: First', files: { 'done.txt': 'one\n' } },
    ])
    const r = await runCli(repo, fake, ['run', 'r1', ...FAST])
    expect(r.code).toBe(0)
    expect(JSON.parse(r.stdout).end).toBe('gate')
    const heldout = boardEvents(repo).filter((e) => e.type === 'ticket.heldout').map((e) => e.payload as { id: string; green: boolean; failed?: string[]; binderErrors?: string[]; followUps?: string[] })
    // No build follow-up: a decision follow-up, and the step waits, as a step not run.
    expect(heldout[0]).toMatchObject({ id: first, green: false, followUps: ['r1/02'] })
    expect(heldout[0].failed).toBeUndefined()
    expect(heldout[0].binderErrors).toEqual(['01.2 an item is kept: it contradicts #kid, and r1/02 judges it'])
    const decision = boardOf(repo).tickets.get('r1/02')!
    expect(decision).toMatchObject({ followUpOf: first, column: 'done' })
    expect(decision.steps ?? []).toEqual([])
    // The decision follow-up starts as a decision pass.
    const prompt = fake.calls().find((c) => c.prompt.includes('Judge a held-out step against a decided card') && c.prompt.includes('You are pass'))!.prompt
    expect(prompt).toContain('This is a decision pass')
    // While the follow-up is open the step stays out of the binder's set, and after its merge
    // the step author rewrites the steps from the cards, and the hold goes.
    expect(fake.calls().filter((c) => c.prompt.includes('You are the step author') && c.prompt.includes('## Your earlier scenarios'))).toHaveLength(1)
    expect(existsSync(join(repo, '.werk', 'heldout', 'r1', '01.held.json'))).toBe(false)
    expect(heldout.at(-1)).toMatchObject({ green: true })
  }, 20_000)

  test('a follow-up that merges with its red step still red goes back to its builder with the step, and merges when the step passes (#st-heldout-followup-gate)', async () => {
    const { repo } = setupRun()
    const fake = judged([
      { match: 'You are the step author', result: STEPS },
      // Red after the first merge, red in the follow-up's gate, then green.
      { match: 'You are the binder', times: 2, result: verdicts('fail') },
      { match: 'You are the binder', result: verdicts('pass') },
      { match: 'a failed user path work', files: { 'kept.txt': 'kept\n' } },
      { match: 'Ticket: First', files: { 'done.txt': 'one\n' } },
    ])
    const r = await runCli(repo, fake, ['run', 'r1', ...FAST])
    expect(r.code).toBe(0)
    expect(JSON.parse(r.stdout).end).toBe('gate')
    const merges = JSON.parse(r.stdout).merges as Array<{ ticket: string; green: boolean; detail?: string }>
    expect(merges.map((m) => [m.ticket, m.green])).toEqual([['r1/01', true], ['r1/02', false], ['r1/02', true]])
    expect(merges[1].detail).toContain('held-out step 01.2')
    const builds = fake.calls().filter((c) => c.prompt.includes('a failed user path work') && c.prompt.includes('You are pass'))
    expect(builds).toHaveLength(2)
    expect(builds[1].prompt).toContain('Command: `held-out step 01.2`')
    expect(builds[1].prompt).toContain('When the user adds an item\nThen the item is still there after a restart')
    expect(builds[1].prompt).toContain('What the binder saw: the item is gone after a restart')
    expect(git(repo, 'show', 'main:kept.txt')).toBe('kept')
  }, 20_000)
})

describe('werk run: the tier and G2 (#werk-loop-tier, #st-g2-heldout)', () => {
  test('every run records the feature tier first, stops at G2, and only a person passes it', async () => {
    const { repo } = setupRun()
    const fake = judged([{ match: 'Ticket: First', files: { 'done.txt': 'one\n' } }])
    const r = await runCli(repo, fake, ['run', 'r1', ...FAST])
    expect(r.code).toBe(0)
    expect(JSON.parse(r.stdout)).toMatchObject({ end: 'gate', detail: 'G2 waits for a person: werk gate r1 approve --actor you' })
    const ev = boardEvents(repo)
    const tier = ev.findIndex((e) => e.type === 'run.tier')
    expect(ev[tier].payload).toEqual({ run: 'r1', tier: 'feature' })
    expect(tier).toBeLessThan(ev.findIndex((e) => e.type === 'ticket.build.started'))
    // Under a run the process is the whole run: no pid, so a ticket's stop never kills it.
    expect(ev.find((e) => e.type === 'ticket.build.started')!.payload).not.toHaveProperty('pid')
    const tip = git(repo, 'rev-parse', 'main')
    expect(ev.at(-2)).toMatchObject({ type: 'gate.waiting', payload: { run: 'r1', gate: 'G2', tip } })
    // The run lets go of the run last, so the board's trigger starts a new one.
    expect(ev.at(-1)).toMatchObject({ type: 'run.ended', payload: { run: 'r1', end: 'gate' } })

    // A second run on the same tree does not open the gate twice, and still waits.
    const again = await runCli(repo, fake, ['run', 'r1', ...FAST])
    expect(JSON.parse(again.stdout).end).toBe('gate')
    expect(boardEvents(repo).filter((e) => e.type === 'gate.waiting')).toHaveLength(1)
    expect(boardEvents(repo).filter((e) => e.type === 'run.tier')).toHaveLength(2)

    const agent = await runCli(repo, fake, ['gate', 'r1', 'approve'])
    expect(agent.code).toBe(1)
    expect(agent.stderr).toContain('needs --actor you')
    const person = await runCli(repo, fake, ['gate', 'r1', 'approve', '--actor', 'you'])
    expect(person.code).toBe(0)
    expect(boardEvents(repo).at(-1)).toMatchObject({ type: 'gate.passed', actor: 'you', payload: { run: 'r1', gate: 'G2', tip } })
    expect(boardOf(repo).runs.get('r1')).toEqual({ tier: 'feature', gates: { G2: { waiting: tip, passed: tip, reason: expect.any(String) } } })
    const after = await runCli(repo, fake, ['run', 'r1', ...FAST])
    expect(JSON.parse(after.stdout).end).toBe('done')
  })

  test('G2 opens again for a new tip after a later merge', async () => {
    const { repo } = setupRun()
    const fake = judged([
      { match: 'Ticket: First', files: { 'done.txt': 'one\n' } },
      { match: 'Ticket: Later', files: { 'later.txt': 'later\n' } },
    ])
    await runCli(repo, fake, ['run', 'r1', ...FAST])
    const tip1 = git(repo, 'rev-parse', 'main')
    expect((await runCli(repo, fake, ['gate', 'r1', 'approve', '--actor', 'you'])).code).toBe(0)

    // A ticket planned later merges, and the main line moves past the tip a person passed.
    planTicket(repo, { num: '02', text: ticket({ title: 'Later', cites: 'kid', stories: '2' }) })
    const r = await runCli(repo, fake, ['run', 'r1', ...FAST])
    expect(JSON.parse(r.stdout)).toMatchObject({ end: 'gate', detail: 'G2 waits for a person: werk gate r1 approve --actor you' })
    const tip2 = git(repo, 'rev-parse', 'main')
    expect(tip2).not.toBe(tip1)
    const waits = boardEvents(repo).filter((e) => e.type === 'gate.waiting').map((e) => (e.payload as { tip: string }).tip)
    expect(waits).toEqual([tip1, tip2])
    expect(boardOf(repo).runs.get('r1')!.gates.G2).toMatchObject({ waiting: tip2, passed: tip1 })

    expect((await runCli(repo, fake, ['gate', 'r1', 'approve', '--actor', 'you'])).code).toBe(0)
    expect(JSON.parse((await runCli(repo, fake, ['run', 'r1', ...FAST])).stdout).end).toBe('done')
  })

  test('G2 does not open while a held-out step is red', async () => {
    const { repo } = setupRun()
    const fake = judged([
      { match: 'You are the step author', result: 'Given a\nWhen b\nThen c' },
      { match: 'You are the binder', result: '[{"id": "01.1", "result": "binder-error", "detail": "no such screen"}]' },
      { match: 'Ticket: First', files: { 'done.txt': 'one\n' } },
    ])
    const r = await runCli(repo, fake, ['run', 'r1', ...FAST])
    expect(JSON.parse(r.stdout).end).toBe('heldout')
    expect(boardEvents(repo).some((e) => e.type === 'gate.waiting')).toBe(false)
  })
})
