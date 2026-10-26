import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chatSessions, importMissingSessions, importPipelineCosts, importPlanTurns, readSession, recordTurn, sessionTree } from './cost-history.ts'
import { foldPlanCost } from './cost.ts'
import { readPipeline } from './pipeline.ts'
import type { Event } from './types.ts'

let root: string
let dir: string
let convoDir: string
let pipeline: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'werk-cost-'))
  dir = join(root, 'transcripts')
  convoDir = join(root, 'conversations')
  pipeline = join(root, 'pipeline.jsonl')
  mkdirSync(dir)
  mkdirSync(convoDir)
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const T = (min: number) => new Date(Date.UTC(2026, 9, 1, 12, min)).toISOString()
const prompt = (text: string, min: number, extra: object = {}) => ({ type: 'user', timestamp: T(min), message: { role: 'user', content: text }, ...extra })
const toolResult = (min: number) => ({ type: 'user', timestamp: T(min), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x' }] } })
/** One line of a response. A response written as several lines repeats its id. */
const line = (id: string, min: number, content: object[] = [], output = 1_000_000, model = 'claude-sonnet-5-5') => ({
  type: 'assistant', timestamp: T(min),
  message: { id, model, content, usage: { input_tokens: 0, output_tokens: output } },
})
const bash = (command: string, id = 'tu1') => ({ type: 'tool_use', id, name: 'Bash', input: { command } })
const edit = { type: 'tool_use', id: 'tu-e', name: 'Edit', input: { file_path: '/repo/src/a.ts' } }

function session(id: string, entries: object[], raw = '') {
  writeFileSync(join(dir, `${id}.jsonl`), entries.map(e => JSON.stringify(e)).join('\n') + '\n' + raw)
}
function subagent(sessionId: string, name: string, entries: object[], meta?: string) {
  const sub = join(dir, sessionId, 'subagents')
  mkdirSync(sub, { recursive: true })
  writeFileSync(join(sub, `${name}.jsonl`), entries.map(e => JSON.stringify(e)).join('\n'))
  if (meta !== undefined) writeFileSync(join(sub, `${name}.meta.json`), meta)
}
/** A time long after every fixture file was written, so no session counts as live. */
const LATER = Date.now() + 24 * 3600 * 1000
const importAll = (now = LATER) => importPlanTurns({ dir, convoDir, pipeline, now })
/** Import into the fixture's pipeline log, then fold it: the path every report takes. */
const history = (events: Event[] = []) => {
  importAll()
  return foldPlanCost(readPipeline(pipeline), events)
}

describe('turns', () => {
  test('only a person\'s prompt starts a turn; a response before the first prompt is dropped', () => {
    session('s1', [
      line('early', 0),
      prompt('one', 1),
      line('r1', 2, [bash('ls')]),
      toolResult(3),
      prompt('meta', 3, { isMeta: true }),
      prompt('side', 3, { isSidechain: true }),
      line('r2', 4),
      prompt('two', 5),
    ])
    const turns = readSession(dir, 's1')
    expect(turns.map(t => t.responses.length)).toEqual([2, 0])
  })

  test('a response over several lines counts once, with the usage of its last line', () => {
    session('s1', [prompt('one', 0), line('r1', 1, [], 10), line('r1', 2, [bash('node src/cli.ts say a "x"')], 1_000_000)])
    const [t] = readSession(dir, 's1')
    expect(t.responses).toHaveLength(1)
    expect(t.responses[0].tokens.output).toBe(1_000_000)
    expect(t.responses[0].dollars).toBeCloseTo(10)
    expect(t.responses[0].cards).toEqual(['a'])
  })

  test('a response belongs to the turn its first line fell in', () => {
    session('s1', [prompt('one', 0), line('r1', 1), prompt('two', 2), line('r1', 3)])
    expect(readSession(dir, 's1').map(t => t.responses.length)).toEqual([1, 0])
  })

  test('a cut line is skipped and the lines on both sides still count', () => {
    session('s1', [prompt('one', 0), line('r1', 1)], '{"type":"assist\n' + JSON.stringify(line('r2', 2)) + '\n')
    expect(readSession(dir, 's1')[0].responses).toHaveLength(2)
  })
})

describe('subagents', () => {
  test('a subagent goes to the turn whose tool call started it', () => {
    session('s1', [prompt('one', 0), line('r1', 1, [bash('ls', 'tu-a')]), prompt('two', 2), line('r2', 3)])
    subagent('s1', 'agent-a', [line('sa', 1)], JSON.stringify({ toolUseId: 'tu-a' }))
    expect(readSession(dir, 's1').map(t => t.subagent.length)).toEqual([1, 0])
  })

  test('with no meta file, or a meta file that is not JSON, it goes to the last turn', () => {
    session('s1', [prompt('one', 0), line('r1', 1), prompt('two', 2), line('r2', 3)])
    subagent('s1', 'agent-a', [line('sa', 1)])
    subagent('s1', 'agent-b', [line('sb', 1)], '{not json')
    expect(readSession(dir, 's1').map(t => t.subagent.length)).toEqual([0, 2])
  })
})

describe('chat-pane sessions', () => {
  test('the store names a session by its session file or by a new-session record', () => {
    mkdirSync(join(convoDir, 'card-a'))
    writeFileSync(join(convoDir, 'card-a', 'session'), 'aaaaaaaa-1111\n')
    writeFileSync(join(convoDir, 'card-a', 'chat.jsonl'), JSON.stringify({ from: 'system', text: 'New session bbbbbbbb.' }) + '\n')
    mkdirSync(join(convoDir, 'empty'))
    const map = chatSessions(convoDir)
    expect(map.get('aaaaaaaa-1111')).toBe('card-a')
    expect(map.get('bbbbbbbb')).toBe('card-a')
    expect(map.size).toBe(2)
  })

  test('a session is chat-pane when the store names it or a prompt names an open card', () => {
    mkdirSync(join(convoDir, 'home'))
    writeFileSync(join(convoDir, 'home', 'session'), 'named')
    session('named', [prompt('hi', 0), line('r1', 1)])
    session('older', [prompt('[the map is now at #x — "t"]\nhi', 0), line('r2', 1)])
    session('term', [prompt('hi', 0), line('r3', 1)])
    const h = history()
    expect(h.sessions).toEqual({ chatPane: 2, terminal: 1 })
    expect(h.cards.map(c => c.card).sort()).toEqual(['home', 'x'])
  })
})

test('a missing transcript directory or store gives an empty result', () => {
  rmSync(root, { recursive: true, force: true })
  expect(chatSessions(convoDir).size).toBe(0)
  expect(history().cards).toEqual([])
})

describe('rollup', () => {
  test('plan plus not plan is the total, each turn goes to its prompt\'s day, card shares add up', () => {
    session('term', [
      prompt('map', 0),
      line('r1', 1, [bash('node src/cli.ts add a --title t; node src/cli.ts add b --title t')]),
      line('r2', 2, [edit]),
      prompt('code', 3),
      line('r3', 4, [edit]),
    ])
    const h = history()
    expect(h.dollars.plan + h.dollars.notPlan).toBeCloseTo(30)
    expect(h.dollars.plan).toBeCloseTo(20)
    expect(h.dollars.prototype).toBeCloseTo(10)
    expect(h.dollars.planTerminal).toBeCloseTo(20)
    expect(h.cards.reduce((s, c) => s + c.dollars, 0)).toBeCloseTo(h.dollars.plan)
    expect(h.days).toHaveLength(1)
    expect(h.days[0].day).toBe('2026-10-01')
    expect(h.reasons.mixed.turns).toBe(1)
    expect(h.reasons['code-only'].turns).toBe(1)
  })

  test('a placeholder response costs nothing and is not unpriced; an unknown model is unpriced', () => {
    session('s1', [prompt('[still on #a — "t"]', 0), line('r1', 1, [], 5, '<synthetic>'), line('r2', 2, [], 5, 'claude-unknown')])
    const h = history()
    expect(h.unpricedResponses).toBe(1)
    expect(h.cards[0].tokens.output).toBe(5)
  })

  test('the per-day denominator counts the cards that first became decided that day', () => {
    session('s1', [prompt('[still on #a — "t"]', 0), line('r1', 1)])
    const ev = (seq: number, type: string, payload: object): Event => ({ seq, at: T(seq), actor: 'agent', type, payload } as Event)
    const h = history([
      ev(1, 'status.set', { id: 'a', status: 'decided' }),
      ev(2, 'status.set', { id: 'a', status: 'decided' }),
      ev(3, 'node.added', { id: 'b', kind: 'card', status: 'decided' }),
      ev(4, 'node.added', { id: 'b:opt0', kind: 'option', status: 'decided' }),
    ])
    expect(h.days[0].decided).toBe(2)
    expect(h.days[0].perDecided).toBeCloseTo(5)
  })
})

describe('import into the pipeline log', () => {
  test('a second import adds nothing; a new turn is added on the next import', () => {
    session('s1', [prompt('[still on #a — "t"]', 0, { uuid: 'p1' }), line('r1', 1)])
    expect(importAll()).toEqual({ added: 1, skipped: 0 })
    expect(importAll()).toEqual({ added: 0, skipped: 1 })
    session('s1', [prompt('[still on #a — "t"]', 0, { uuid: 'p1' }), line('r1', 1), prompt('more', 2, { uuid: 'p2' }), line('r2', 3)])
    expect(importAll()).toEqual({ added: 1, skipped: 1 })
    const events = readPipeline(pipeline)
    expect(events.map(e => e.seq)).toEqual([1, 2])
    expect(events.map(e => e.payload)).toMatchObject([{ turnId: 'p1', backfilled: true }, { turnId: 'p2', card: null }])
  })

  test('an event is dated when its turn ended', () => {
    session('s1', [prompt('hi', 0), line('r1', 1), line('r2', 4)])
    importAll()
    expect(readPipeline(pipeline)[0].at).toBe(T(4))
  })

  test('the last turn of a session written to in the last minutes waits for a later import', () => {
    session('s1', [prompt('one', 0, { uuid: 'p1' }), line('r1', 1), prompt('two', 2, { uuid: 'p2' }), line('r2', 3)])
    expect(importAll(Date.now())).toEqual({ added: 1, skipped: 0 })
    expect(importAll()).toEqual({ added: 1, skipped: 1 })
  })
})

describe('live record of a chat-pane turn (#ms-store-plan)', () => {
  const record = (session: string, home: string | null, endedAt: number) => recordTurn(session, home, endedAt, { dir, pipeline })

  test('writes the turn that ended, with its subagents, as a live event the backfill then skips', () => {
    session('s1', [prompt('[still on #a — "t"]', 0, { uuid: 'p1' }), line('r1', 1, [{ type: 'tool_use', id: 'tu-sub', name: 'Agent', input: {} }])])
    subagent('s1', 'agent-1', [line('sub1', 1)], JSON.stringify({ toolUseId: 'tu-sub' }))
    const turn = record('s1', 'home-card', Date.parse(T(2)))
    expect(turn).toMatchObject({ step: 'turn', session: 's1', turnId: 'p1', card: 'a', responses: 1 })
    const events = readPipeline(pipeline)
    expect(events).toHaveLength(1)
    expect(events[0].payload).not.toHaveProperty('backfilled')
    expect(events[0].at).toBe(T(1))
    // The subagent's response is priced into the turn: two responses of 1M output tokens each.
    expect(turn!.tokens.output).toBe(2_000_000)
    expect(importAll()).toEqual({ added: 0, skipped: 1 })
  })

  test('a prompt sent after the result is not the turn that ended; the home card fills a turn with no open card', () => {
    session('s1', [prompt('first', 0, { uuid: 'p1' }), line('r1', 1), prompt('queued', 5, { uuid: 'p2' })])
    expect(record('s1', 'home-card', Date.parse(T(2)))).toMatchObject({ turnId: 'p1', card: 'home-card' })
  })

  test('the same turn twice is written once; a missing transcript or no turn yet writes nothing', () => {
    session('s1', [prompt('one', 0, { uuid: 'p1' }), line('r1', 1)])
    expect(record('s1', null, Date.parse(T(2)))).not.toBeNull()
    expect(record('s1', null, Date.parse(T(3)))).toBeNull()
    expect(record('nope', null, Date.parse(T(3)))).toBeNull()
    session('s2', [prompt('later', 10, { uuid: 'p9' })])
    expect(record('s2', null, Date.parse(T(2)))).toBeNull()
    expect(readPipeline(pipeline)).toHaveLength(1)
  })

  test('a background task that wakes the turn after its result adds the next part, with only the new responses', () => {
    const agent = { type: 'tool_use', id: 'tu-sub', name: 'Agent', input: {} }
    session('s1', [prompt('[still on #a — "t"]', 0, { uuid: 'p1' }), line('r1', 1, [agent])])
    subagent('s1', 'agent-b', [line('sub1', 1)], JSON.stringify({ toolUseId: 'tu-sub' }))
    expect(record('s1', null, Date.parse(T(2)))).toMatchObject({ responses: 1, subagentResponses: 1 })

    // The task ends and wakes the turn: two more responses, and a second subagent whose file
    // sorts before the first one.
    session('s1', [prompt('[still on #a — "t"]', 0, { uuid: 'p1' }), line('r1', 1, [agent]), line('r2', 10), line('r3', 11)])
    subagent('s1', 'agent-a', [line('sub2', 10)])
    const wake = record('s1', null, Date.parse(T(12)))
    // The part starts at the last recorded response. The 9-minute gap before the wake is under
    // the idle limit, so it counts as wall time, as inside any turn.
    expect(wake).toMatchObject({ turnId: 'p1', part: 1, card: 'a', responses: 2, subagentResponses: 1, ms: 600_000 })
    expect(wake!.tokens.output).toBe(3_000_000)
    expect(record('s1', null, Date.parse(T(13)))).toBeNull()

    // The backfill adds nothing, and the fold counts one turn with the cost of every part.
    expect(importAll()).toEqual({ added: 0, skipped: 2 })
    const h = foldPlanCost(readPipeline(pipeline), [])
    expect(h.cards).toMatchObject([{ card: 'a', turns: 1 }])
    expect(h.reasons['chat-pane'].turns).toBe(1)
  })

  test('the backfill adds a wake that the live record missed, as the next part', () => {
    session('s1', [prompt('one', 0, { uuid: 'p1' }), line('r1', 1)])
    record('s1', null, Date.parse(T(2)))
    session('s1', [prompt('one', 0, { uuid: 'p1' }), line('r1', 1), line('r2', 30)])
    expect(importAll()).toEqual({ added: 1, skipped: 1 })
    expect(readPipeline(pipeline)[1].payload).toMatchObject({ turnId: 'p1', part: 1, responses: 1, backfilled: true })
  })

  test('an event written before parts existed counts every subagent as recorded', () => {
    session('s1', [prompt('one', 0, { uuid: 'p1' }), line('r1', 1, [{ type: 'tool_use', id: 'tu-sub', name: 'Agent', input: {} }])])
    subagent('s1', 'agent-1', [line('sub1', 1)], JSON.stringify({ toolUseId: 'tu-sub' }))
    writeFileSync(pipeline, JSON.stringify({ seq: 1, at: T(1), actor: 'agent', type: 'step.ended', payload: { step: 'turn', session: 's1', turnId: 'p1', responses: 1 } }) + '\n')
    expect(record('s1', null, Date.parse(T(2)))).toBeNull()
  })
})

describe('a pipeline session costs its whole tree (#ms-cost-tree)', () => {
  // claude-sonnet-5-5 output is $10 per million tokens: one line of 1M output tokens is $10.
  test('the sum counts the main thread and every subagent', () => {
    session('s1', [line('m1', 0)])
    subagent('s1', 'a1', [line('m2', 1)])
    subagent('s1', 'a2', [line('m3', 2)])
    const t = sessionTree(dir, 's1')!
    expect(t.costUsd).toBeCloseTo(30)
    expect(t.subagents).toBe(2)
    expect(t.responses).toBe(3)
  })

  test('a response in two files counts once', () => {
    session('s1', [line('m1', 0)])
    subagent('s1', 'a1', [line('m1', 0)])
    expect(sessionTree(dir, 's1')!.costUsd).toBeCloseTo(10)
  })

  test('a session with no transcript has no tree', () => {
    expect(sessionTree(dir, 'gone')).toBeNull()
  })
})

describe('a correction rebuilds a past pipeline session (#ms-cost-history-pipeline)', () => {
  const ended = (file: string, costUsd: number | null) => ({
    seq: 1, at: T(0), actor: 'agent',
    type: 'step.ended',
    payload: { build: 'b1', ticket: 't1', step: 'session', name: 'pass-1', result: 'ok', ms: 1, file, ...(costUsd === null ? {} : { costUsd, tokens: { input: 0, output: 1_000_000, cacheRead: 0, cacheWrite: 0 } }) },
  })
  const runFile = (name: string, sid: string) => {
    const p = join(root, name)
    writeFileSync(p, JSON.stringify({ type: 'result', session_id: sid }) + '\n')
    return name
  }

  test('the fold reads the corrected cost, the log keeps the original, and a rerun adds nothing', () => {
    // The transcript root holds one project directory, with the session and its subagent.
    const projects = join(root, 'projects')
    dir = join(projects, 'p')
    mkdirSync(dir, { recursive: true })
    session('s1', [line('m1', 0)])
    subagent('s1', 'a1', [line('m2', 1)])
    const file = runFile('pass-1.jsonl', 's1')
    writeFileSync(pipeline, JSON.stringify(ended(file, 10)) + '\n')
    expect(importPipelineCosts({ pipeline, root: projects, cwd: root })).toMatchObject({ corrected: 1 })
    expect(readPipeline(pipeline)[0].payload).toMatchObject({ costUsd: 20, subagents: 1, responses: 2 })
    expect(readFileSync(pipeline, 'utf8')).toContain('"costUsd":10')
    expect(importPipelineCosts({ pipeline, root: projects, cwd: root })).toMatchObject({ corrected: 0, skipped: 1 })
  })

  test('a session whose logged cost is missing gets the tree cost', () => {
    session('s1', [line('m1', 0)])
    const file = runFile('pass-1.jsonl', 's1')
    writeFileSync(pipeline, JSON.stringify(ended(file, null)) + '\n')
    const projects = join(root, 'projects')
    mkdirSync(projects)
    // Point the transcript root at the fixture's transcripts, as one project directory.
    mkdirSync(join(projects, 'p'))
    writeFileSync(join(projects, 'p', 's1.jsonl'), JSON.stringify(line('m1', 0)) + '\n')
    const r = importPipelineCosts({ pipeline, root: projects, cwd: root })
    expect(r.corrected).toBe(1)
    expect(readPipeline(pipeline)[0].payload).toMatchObject({ costUsd: 10 })
    expect(importPipelineCosts({ pipeline, root: projects, cwd: root })).toMatchObject({ corrected: 0, skipped: 1 })
  })
})

describe('a pipeline session with no event is imported from its transcript (#ms-cost-history-pipeline)', () => {
  const binder = 'You are the binder of a held-out test set. Write the steps.'
  const temp = (name: string) => {
    const d = join(root, 'projects', `-private-var-T-werk-heldout-wt-${name}`)
    mkdirSync(d, { recursive: true })
    return d
  }
  const write = (d: string, id: string, text: string) =>
    writeFileSync(join(d, `${id}.jsonl`), [prompt(text, 0), line('m1', 1)].map(e => JSON.stringify(e)).join('\n') + '\n')

  test('a binder with no event gets one, once, with its tree cost', () => {
    const d = temp('abc')
    write(d, 'b1', binder)
    const opts = { pipeline, root: join(root, 'projects'), cwd: root, now: LATER }
    expect(importMissingSessions(opts)).toMatchObject({ added: 1, unclassified: 0 })
    expect(readPipeline(pipeline)[0].payload).toMatchObject({ name: 'heldout-binder', session: 'b1', costUsd: 10, imported: true })
    expect(importMissingSessions(opts).added).toBe(0)
  })

  test('a session with no known role is counted and left out, and a live one waits', () => {
    const d = temp('def')
    write(d, 'x1', 'Something else entirely')
    write(d, 'b2', binder)
    const opts = { pipeline, root: join(root, 'projects'), cwd: root }
    expect(importMissingSessions({ ...opts, now: LATER })).toMatchObject({ added: 1, unclassified: 1 })
    const live = temp('ghi')
    write(live, 'b3', binder)
    expect(importMissingSessions({ ...opts, now: Date.now() }).added).toBe(0)
  })
})
