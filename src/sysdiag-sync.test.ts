import { afterEach, describe, expect, test } from 'bun:test'
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildPassed,
  changedCards,
  changesBetween,
  parseKind,
  needsChange,
  runClaudeAgent,
  runGridBuild,
  scoutBrief,
  startSysdiagSync,
  type RunAgent,
  type SyncState,
  updaterBrief,
} from './sysdiag-sync.ts'
import type { Event, EventType } from './types.ts'

type Raw = [EventType, Record<string, unknown>]

function log(...events: Raw[]): Event[] {
  return events.map(([type, payload], i) => ({
    seq: i + 1,
    at: `2026-10-10T10:${String(i).padStart(2, '0')}:00.000Z`,
    actor: 'agent' as const,
    type,
    payload,
  }))
}

const card = (id: string, status = 'decided'): Raw => ['node.added', { id, kind: 'card', title: id, status }]
const ghost = (id: string): Raw => ['node.proposed', { id, kind: 'card', title: id, status: 'decided' }]
const status = (id: string, s: string): Raw => ['status.set', { id, status: s }]

describe('changesBetween', () => {
  test('a card that becomes decided is a change', () => {
    const events = log(card('a', 'open'), status('a', 'decided'))
    expect(changesBetween(events, 1)).toEqual(['card a became decided: "a"'])
  })

  test('a reopened card stopped being decided', () => {
    const events = log(card('a'), ['reopened', { id: 'a' }])
    expect(changesBetween(events, 1)).toEqual(['card a stopped being decided (now open): "a"'])
  })

  test('a removed card stopped being decided, and says so', () => {
    const events = log(card('a'), ['node.removed', { id: 'a' }])
    expect(changesBetween(events, 1)).toEqual(['card a stopped being decided (removed from the map): "a"'])
  })

  test('a retitle, a body edit, a link and an unlink on a decided card are changes', () => {
    const events = log(
      card('a'),
      card('b'),
      card('c'),
      ['edge.added', { from: 'a', to: 'c', type: 'depends_on' }],
      ['node.retitled', { id: 'a', title: 'A' }],
      ['node.bodyEdited', { id: 'a', patch: { body: 'new' } }],
      ['edge.added', { from: 'a', to: 'b', type: 'depends_on' }],
      ['edge.removed', { from: 'a', to: 'c', type: 'depends_on' }],
    )
    expect(changesBetween(events, 4)).toEqual([
      'card a retitled: "a" -> "A"',
      'card a why/body edited ("A")',
      'linked a depends_on b',
      'unlinked a depends_on c',
    ])
  })

  test('open cards, ghosts and notes change nothing the diagram may cite', () => {
    const events = log(card('a'), card('b', 'open'), ['node.retitled', { id: 'b', title: 'B' }], ghost('g'), [
      'note.added',
      { id: 'a', text: 'hi' },
    ])
    expect(changesBetween(events, 1)).toEqual([])
  })

  test('a ghost becomes a change when it is accepted', () => {
    const events = log(ghost('g'), ['change.accepted', { id: 'g' }])
    expect(changesBetween(events, 1)).toEqual(['card g became decided: "g"'])
  })
})

describe('the change kind (#vi-sysdiag-declare)', () => {
  test('reads the last CHANGE KIND line, in any case and with markdown bold', () => {
    expect(parseKind('Added node.\nCHANGE KIND: local — one title changed')).toEqual({ kind: 'local', reason: 'one title changed' })
    expect(parseKind('change kind: local — x\n**CHANGE KIND:** Restructure: the agent group split')).toEqual({ kind: 'restructure', reason: 'the agent group split' })
    expect(parseKind('a local edit, no line')).toBeUndefined()
    expect(parseKind('CHANGE KIND: huge')).toBeUndefined()
  })

  test('the changed cards come from the change lines, once each', () => {
    expect(changedCards(['card a became decided: "A"', 'linked a depends_on b', 'unlinked c refines d', 'card a retitled: "x" -> "y"'])).toEqual(['a', 'c'])
  })
})

describe('the verdict parsers', () => {
  test('a scout report that starts with NO CHANGE NEEDED means no change', () => {
    expect(needsChange('NO CHANGE NEEDED. Nothing cites it.')).toBe(false)
    expect(needsChange('**NO CHANGE NEEDED** — covered')).toBe(false)
    expect(needsChange('Edit line 12: ...')).toBe(true)
  })

  test('the build passes only on an explicit 0 error(s)', () => {
    expect(buildPassed('canvas 10x10\n0 error(s), 2 warning(s)')).toBe(true)
    expect(buildPassed('10 error(s)')).toBe(false)
    expect(buildPassed('3 error(s)')).toBe(false)
    expect(buildPassed('')).toBe(false)
  })

  test('both briefs tell the agent nobody will answer a question', () => {
    expect(scoutBrief(['card a became decided: "a"'])).toContain('- card a became decided')
    expect(scoutBrief([])).toContain('do not ask a question')
    expect(updaterBrief('Edit line 12')).toContain('Edit line 12')
    expect(updaterBrief('x')).toContain('Do not ask anything')
  })
})

// ---------- the background job ----------

let dir = ''
afterEach(() => dir && rmSync(dir, { recursive: true, force: true }))

function setup(initial: Raw[] = [card('a', 'open')]) {
  dir = mkdtempSync(join(tmpdir(), 'werk-sysdiag-'))
  const logPath = join(dir, 'log.jsonl')
  let seq = 0
  const write = (...raws: Raw[]) => {
    for (const [type, payload] of raws) {
      seq++
      appendFileSync(logPath, JSON.stringify({ seq, at: new Date().toISOString(), actor: 'agent', type, payload }) + '\n')
    }
  }
  write(...initial)
  writeFileSync(join(dir, 'diagram-grid-full-minimal.wgrid'), 'good wgrid')
  writeFileSync(join(dir, 'diagram-grid-full-minimal.svg'), 'good svg')
  return { logPath, write }
}

type Script = { scout?: { ok: boolean; out: string }; updater?: { ok: boolean; out: string } | 'throw'; build?: string }

function start(logPath: string, script: Script = {}, onRestructure?: (cards: string[], reason: string) => void) {
  const calls: string[] = []
  const states: SyncState[] = []
  let release: (() => void) | null = null
  let hold = false
  const runAgent: RunAgent = async (agent, _prompt, tools) => {
    calls.push(`${agent} ${tools.join(',')}`)
    if (hold) await new Promise<void>((r) => (release = r))
    if (agent === 'sysdiag-scout') return script.scout ?? { ok: true, out: 'NO CHANGE NEEDED' }
    writeFileSync(join(dir, 'diagram-grid-full-minimal.wgrid'), 'half-edited')
    if (script.updater === 'throw') throw new Error('boom')
    return script.updater ?? { ok: true, out: 'done' }
  }
  const sync = startSysdiagSync({
    werkDir: dir,
    logPath,
    runAgent,
    runBuild: async () => {
      calls.push('build')
      return script.build ?? '0 error(s)'
    },
    onState: (s) => states.push(s),
    onRestructure,
    debounceMs: 5,
  })
  return {
    sync,
    calls,
    states,
    holdAgents: () => (hold = true),
    releaseAgent: () => {
      hold = false
      release?.()
    },
  }
}

const settle = (ms = 40) => new Promise((r) => setTimeout(r, ms))
const wgrid = () => readFileSync(join(dir, 'diagram-grid-full-minimal.wgrid'), 'utf8')
const saved = (): SyncState => JSON.parse(readFileSync(join(dir, 'sysdiag-sync.json'), 'utf8'))

describe('the background job', () => {
  test('a first start takes the current log end as its baseline and replays nothing', async () => {
    const { logPath } = setup([card('a')])
    const { sync, calls } = start(logPath)
    sync.poke()
    await settle()
    expect(calls).toEqual([])
    expect(saved().seq).toBe(1)
  })

  test('the position survives a restart, and a saved running state loads as idle', async () => {
    const { logPath } = setup()
    writeFileSync(join(dir, 'sysdiag-sync.json'), JSON.stringify({ seq: 0, state: 'running' }))
    const { sync, states } = start(logPath)
    expect(states[0]).toEqual({ seq: 0, state: 'idle' })
    expect(sync.state().seq).toBe(0)
  })

  test('a burst of log changes gives one run', async () => {
    const { logPath, write } = setup()
    const { sync, calls } = start(logPath)
    write(status('a', 'decided'))
    sync.poke()
    sync.poke()
    sync.poke()
    await settle()
    expect(calls.filter((c) => c.startsWith('sysdiag-scout'))).toHaveLength(1)
  })

  test('a change during a run gives exactly one more run after it', async () => {
    const { logPath, write } = setup([card('a', 'open'), card('b', 'open')])
    const { sync, calls, holdAgents, releaseAgent } = start(logPath)
    holdAgents()
    write(status('a', 'decided'))
    sync.poke()
    await settle()
    write(status('b', 'decided'))
    sync.poke()
    sync.poke()
    releaseAgent()
    await settle()
    expect(calls.filter((c) => c.startsWith('sysdiag-scout'))).toHaveLength(2)
  })

  test('scout gets read-only tools; only the updater may edit and build', async () => {
    const { logPath, write } = setup()
    const { sync, calls } = start(logPath, { scout: { ok: true, out: 'Edit line 3' } })
    write(status('a', 'decided'))
    sync.poke()
    await settle()
    const [scout, updater] = calls
    expect(scout).not.toMatch(/Edit|Write|build/)
    expect(updater).toMatch(/^sysdiag-updater .*Edit.*Write.*Bash\(bun src\/gridsys\/build.ts:\*\)/)
  })

  test('scout saying no change ends the run as unchanged, with no updater and no build', async () => {
    const { logPath, write } = setup()
    const { sync, calls } = start(logPath)
    write(status('a', 'decided'))
    sync.poke()
    await settle()
    expect(calls).toHaveLength(1)
    expect(saved()).toMatchObject({ seq: 2, state: 'idle', last: { result: 'unchanged' } })
  })

  test('an updater and a passing build end the run as updated and keep the new diagram', async () => {
    const { logPath, write } = setup()
    const { sync } = start(logPath, { scout: { ok: true, out: 'Edit line 3' } })
    write(status('a', 'decided'))
    sync.poke()
    await settle()
    expect(saved()).toMatchObject({ seq: 2, state: 'idle', last: { result: 'updated' } })
    expect(wgrid()).toBe('half-edited')
  })

  test('an update keeps the change kind, and only a restructure notes the cards that caused it', async () => {
    const { logPath, write } = setup([card('a', 'open'), card('b', 'open')])
    const noted: [string[], string][] = []
    const scout = { ok: true, out: 'Edit line 3\nCHANGE KIND: local — scout guess' }
    const { sync } = start(logPath, { scout, updater: { ok: true, out: 'done\nCHANGE KIND: restructure — group split' } }, (c, r) => noted.push([c, r]))
    write(status('a', 'decided'))
    sync.poke()
    await settle()
    expect(saved().last).toMatchObject({ result: 'updated', kind: 'restructure', reason: 'group split' })
    expect(noted).toEqual([[['a'], 'group split']])

    const local = start(logPath, { scout, updater: { ok: true, out: 'done' } }, (c, r) => noted.push([c, r]))
    write(status('b', 'decided'))
    local.sync.poke()
    await settle()
    expect(saved().last).toMatchObject({ result: 'updated', kind: 'local', reason: 'scout guess' })
    expect(noted).toHaveLength(1)
    sync.stop()
    local.sync.stop()
  })

  for (const [name, script] of [
    ['a failing build', { scout: { ok: true, out: 'Edit' }, build: '2 error(s)' }],
    ['a failing updater', { scout: { ok: true, out: 'Edit' }, updater: { ok: false, out: 'exit 1' } }],
    ['a throwing updater', { scout: { ok: true, out: 'Edit' }, updater: 'throw' }],
  ] as Array<[string, Script]>) {
    test(`${name} restores the last good diagram and does not move the position`, async () => {
      const { logPath, write } = setup()
      const { sync } = start(logPath, script)
      write(status('a', 'decided'))
      sync.poke()
      await settle()
      expect(wgrid()).toBe('good wgrid')
      expect(saved()).toMatchObject({ seq: 1, state: 'failed', last: { result: 'failed' } })
    })
  }

  test('a failing scout does not move the position, so the next change retries it', async () => {
    const { logPath, write } = setup([card('a', 'open'), card('b', 'open')])
    const { sync, calls } = start(logPath, { scout: { ok: false, out: 'exit 1' } })
    write(status('a', 'decided'))
    sync.poke()
    await settle()
    expect(saved()).toMatchObject({ seq: 2, state: 'failed' })
    write(status('b', 'decided'))
    sync.poke()
    await settle()
    expect(calls).toHaveLength(2)
  })

  test('a failed run retries on the next log change, and a passing retry clears it', async () => {
    const { logPath, write } = setup([card('a', 'open'), card('b', 'open')])
    const script: Script = { scout: { ok: false, out: 'exit 1' } }
    const { sync } = start(logPath, script)
    write(status('a', 'decided'))
    sync.poke()
    await settle()
    expect(saved().state).toBe('failed')
    // The retry now finds nothing new to say, but the same change is still unchecked, so it
    // runs scout again. Make that pass, then a note on top must not clear anything by itself.
    script.scout = { ok: true, out: 'NO CHANGE NEEDED' }
    write(['note.added', { id: 'b', text: 'hi' }])
    sync.poke()
    await settle()
    expect(saved()).toMatchObject({ seq: 4, state: 'idle', last: { result: 'unchanged' } })
  })

  test('a log change with nothing to check leaves a failed state failed', async () => {
    const { logPath, write } = setup([card('a')])
    writeFileSync(join(dir, 'sysdiag-sync.json'), JSON.stringify({ seq: 1, state: 'idle' }))
    const { sync, calls } = start(logPath, { scout: { ok: false, out: 'exit 1' } })
    write(['reopened', { id: 'a' }])
    sync.poke()
    await settle()
    expect(saved().state).toBe('failed')
    // Undo the reopen: the decided set is back where the position says it was.
    write(status('a', 'decided'))
    sync.poke()
    await settle()
    expect(calls).toHaveLength(1)
    expect(saved()).toMatchObject({ seq: 3, state: 'failed' })
  })

  test('the state goes to the file and to the listener as the same value', async () => {
    const { logPath, write } = setup()
    const { sync, states } = start(logPath)
    write(status('a', 'decided'))
    sync.poke()
    await settle()
    expect(states.at(-1)).toEqual(saved())
    expect(states.some((s) => s.state === 'running')).toBe(true)
    expect(existsSync(join(dir, 'sysdiag-sync.json'))).toBe(true)
  })
})

describe('the real runners', () => {
  // A stand-in `claude` on PATH: prints its arguments, and fails when the prompt says so.
  function fakeClaude() {
    dir = mkdtempSync(join(tmpdir(), 'werk-sysdiag-bin-'))
    const bin = join(dir, 'claude')
    writeFileSync(bin, '#!/bin/sh\ncase "$2" in fail*) echo "bad thing" >&2; exit 3;; esac\necho "  $@  "\n', { mode: 0o755 })
    return { PATH: `${dir}:${process.env.PATH}` }
  }

  test('the agent runner puts the prompt first, names the agent, keeps no session, and trims stdout', async () => {
    const env = fakeClaude()
    const old = process.env.PATH
    process.env.PATH = env.PATH
    try {
      const r = await runClaudeAgent(dir)('sysdiag-scout', 'hello', ['Read', 'Grep'])
      expect(r.ok).toBe(true)
      expect(r.out).toBe('--print hello --agent sysdiag-scout --no-session-persistence --allowedTools Read Grep')
    } finally {
      process.env.PATH = old
    }
  })

  test('the agent runner resolves not-ok with stderr on a non-zero exit, and never rejects', async () => {
    const env = fakeClaude()
    const old = process.env.PATH
    process.env.PATH = env.PATH
    try {
      expect(await runClaudeAgent(dir)('sysdiag-scout', 'fail now', [])).toEqual({ ok: false, out: 'bad thing' })
    } finally {
      process.env.PATH = old
    }
  })

  test('the build runner returns the build output, also when the build cannot start', async () => {
    dir = mkdtempSync(join(tmpdir(), 'werk-sysdiag-'))
    const out = await runGridBuild(dir, dir)()
    expect(out.length).toBeGreaterThan(0)
    expect(buildPassed(out)).toBe(false)
  })
})
