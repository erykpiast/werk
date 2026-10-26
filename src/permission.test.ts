// Checks for the approval path. `bun test src/permission.test.ts`.
//
// werk no longer decides what is safe — Claude Code's own permission engine does, and only
// asks werk about a call it could not resolve (see #werk-perm-native). So there is nothing
// here about shell splitting, read-only commands or rule matching. What is left is the
// translation between the CLI's `permission_suggestions` and the pane's "always" button.
//
// A wrong label on that button is a real hole: it would widen something other than what the
// words say. These cases stay in the repository. `src/permission.live.mjs` proves the wire
// against a real child.

import { beforeEach, describe, expect, test } from 'bun:test'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { paths } from './project.ts'
import {
  Asks,
  addAlways,
  alwaysFrom,
  appendAsk,
  readAlways,
  ruleStrings,
  dirStrings,
  describeCall,
  type Ask,
  type PermissionUpdate,
} from './permission.ts'

const ALLOW_PATH = paths.allow
const ASKS_PATH = paths.asks

// ---- the suggestion lists the CLI actually sends ----
// Captured from claude 2.1.235 with --permission-prompt-tool stdio. These two came from
// --permission-mode manual, which werk no longer runs (see #werk-perm-mode) — under `auto`
// no ask has yet carried a suggestion at all. They are kept because they are the only real
// samples of the shape, and because the translation still has to be right if `auto` ever
// starts sending one. Nothing here asserts that werk will see them.

/** A write to a path outside the working directory. */
const MKDIR: PermissionUpdate[] = [
  {
    type: 'addRules',
    rules: [{ toolName: 'Bash', ruleContent: 'mkdir -p sub/one' }],
    behavior: 'allow',
    destination: 'localSettings',
  },
  { type: 'addDirectories', directories: ['/private/tmp/sub'], destination: 'session' },
  { type: 'setMode', mode: 'acceptEdits', destination: 'session' },
]

/** A read of a path outside it. Two addRules, and only the second one unblocks the call. */
const CAT: PermissionUpdate[] = [
  {
    type: 'addRules',
    rules: [{ toolName: 'Bash', ruleContent: 'cat /etc/hosts | wc -l' }],
    behavior: 'allow',
    destination: 'localSettings',
  },
  { type: 'addRules', rules: [{ toolName: 'Read', ruleContent: '//private/etc/**' }], behavior: 'allow', destination: 'session' },
]

describe('alwaysFrom: the "always" button', () => {
  // Every widening suggestion, not the first. Applying only the Bash rule left `cat
  // /etc/hosts | wc -l` asking a second time, because the command and the path are two
  // separate blocks.
  test('keeps both addRules updates', () => {
    expect(alwaysFrom(CAT)?.updates.length).toBe(2)
  })
  test('names every rule it adds', () => {
    expect(alwaysFrom(CAT)?.label).toBe('Bash(cat /etc/hosts | wc -l), Read(//private/etc/**)')
  })

  // setMode is dropped. It is the one suggestion that widens past the call on the screen,
  // and a button labelled with one command must not stop asking about every file write.
  test('leaves setMode out', () => {
    const mkdir = alwaysFrom(MKDIR)
    expect(mkdir?.updates.length).toBe(2)
    expect(mkdir?.updates.every((u) => u.type !== 'setMode')).toBe(true)
  })
  test('labels a directory as a directory', () => {
    expect(alwaysFrom(MKDIR)?.label).toBe('Bash(mkdir -p sub/one), /private/tmp/sub/**')
  })
})

describe('alwaysFrom: no button rather than a wrong one', () => {
  test('a call with no suggestions gets no always button', () => {
    expect(alwaysFrom(undefined)).toBeUndefined()
  })
  test('an empty suggestion list gets no always button', () => {
    expect(alwaysFrom([])).toBeUndefined()
  })
  // Measured: a network call comes back with no suggestions at all.
  test('setMode alone is no button', () => {
    expect(alwaysFrom([{ type: 'setMode', mode: 'acceptEdits' }])).toBeUndefined()
  })
  // A deny or ask rule must never end up behind a button labelled "Always allow".
  for (const behavior of ['deny', 'ask']) {
    test(`a ${behavior} rule is not an "always allow" button`, () => {
      expect(alwaysFrom([{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'rm:*' }], behavior }])).toBeUndefined()
    })
  }
  test('an empty rule list is no button', () => {
    expect(alwaysFrom([{ type: 'addRules', rules: [], behavior: 'allow' }])).toBeUndefined()
  })
  test('an empty directory list is no button', () => {
    expect(alwaysFrom([{ type: 'addDirectories', directories: [] }])).toBeUndefined()
  })
  test('removeRules is not a button', () => {
    expect(alwaysFrom([{ type: 'removeRules', rules: [{ toolName: 'Bash' }] }])).toBeUndefined()
  })
  test('junk in the list is ignored', () => {
    expect(alwaysFrom(['nonsense', null, 7])).toBeUndefined()
  })
})

// The syntax is Claude Code's own --allowedTools and --add-dir syntax. werk writes it and
// never reads it back as anything but a string to hand over.
describe('ruleStrings and dirStrings: what allow.json keeps for the next child', () => {
  test('an addRules rule becomes one --allowedTools string', () => {
    expect(ruleStrings(CAT[0]).join()).toBe('Bash(cat /etc/hosts | wc -l)')
  })
  test('a Read rule keeps its path pattern', () => {
    expect(ruleStrings(CAT[1]).join()).toBe('Read(//private/etc/**)')
  })
  test('a rule with no content is the bare tool name', () => {
    expect(ruleStrings({ type: 'addRules', rules: [{ toolName: 'Read' }], behavior: 'allow' }).join()).toBe('Read')
  })
  test('every rule in one update is kept', () => {
    const update: PermissionUpdate = {
      type: 'addRules',
      behavior: 'allow',
      rules: [{ toolName: 'Bash', ruleContent: 'git push:*' }, { toolName: 'Write' }],
    }
    expect(ruleStrings(update).join()).toBe('Bash(git push:*),Write')
  })
  test('a deny rule is never written to allow.json', () => {
    expect(ruleStrings({ type: 'addRules', rules: [{ toolName: 'Bash' }], behavior: 'deny' })).toEqual([])
  })
  test('addDirectories is not an --allowedTools rule', () => {
    expect(ruleStrings(MKDIR[1])).toEqual([])
  })
  test('addDirectories becomes an --add-dir path', () => {
    expect(dirStrings(MKDIR[1]).join()).toBe('/private/tmp/sub')
  })
  test('addRules is not an --add-dir path', () => {
    expect(dirStrings(MKDIR[0])).toEqual([])
  })
  test('setMode is not an --add-dir path', () => {
    expect(dirStrings(MKDIR[2])).toEqual([])
  })
})

describe('describeCall: the one line the bar and the tool bubble both show', () => {
  test('trims a command', () => {
    expect(describeCall('Bash', { command: ' ls ' })).toBe('ls')
  })
  test('names the subject', () => {
    expect(describeCall('Grep', { pattern: 'foo' })).toBe('Grep foo')
  })
  test('names a path', () => {
    expect(describeCall('Write', { file_path: '/tmp/a' })).toBe('Write /tmp/a')
  })
  test('a Bash call with no command is an empty line, not a crash', () => {
    expect(describeCall('Bash', {})).toBe('')
  })
  test('a tool with no known subject falls back to its input', () => {
    expect(describeCall('Task', { thing: 1 })).toBe('Task {"thing":1}')
  })
})

// allow.json and asks.jsonl live next to WERK_LOG, which the test preload points at a
// scratch directory. Each test starts with neither file.
describe('readAlways and addAlways: what a restarted child is launched with', () => {
  beforeEach(() => {
    rmSync(ALLOW_PATH, { force: true })
  })
  test('no file means no rules and no directories', () => {
    expect(readAlways()).toEqual({ rules: [], dirs: [] })
  })
  test('a click is kept for the next read', () => {
    addAlways({ rules: ['Bash(ls)'], dirs: ['/tmp/a'] })
    expect(readAlways()).toEqual({ rules: ['Bash(ls)'], dirs: ['/tmp/a'] })
  })
  test('a second click adds to the first, and a repeat counts once', () => {
    addAlways({ rules: ['Bash(ls)'] })
    expect(addAlways({ rules: ['Bash(ls)', 'Read'], dirs: ['/tmp/b'] })).toEqual({
      rules: ['Bash(ls)', 'Read'],
      dirs: ['/tmp/b'],
    })
  })
  test('the old bare-array file still reads as rules', () => {
    writeFileSync(ALLOW_PATH, JSON.stringify(['Bash(ls)', 7]))
    expect(readAlways()).toEqual({ rules: ['Bash(ls)'], dirs: [] })
  })
  test('non-string entries are dropped', () => {
    writeFileSync(ALLOW_PATH, JSON.stringify({ rules: ['Read', null], dirs: 'nope' }))
    expect(readAlways()).toEqual({ rules: ['Read'], dirs: [] })
  })
  test('a corrupt file reads as empty, not a crash', () => {
    writeFileSync(ALLOW_PATH, '{not json')
    expect(readAlways()).toEqual({ rules: [], dirs: [] })
  })
})

const sampleAsk = (id: string, convo = 'main'): Ask => ({
  id,
  at: '2026-10-03T00:00:00.000Z',
  tool: 'Bash',
  label: `ls ${id}`,
  input: { command: `ls ${id}` },
  reason: 'rule',
  always: { label: 'Bash(ls)', updates: [{ type: 'addRules', behavior: 'allow', rules: [{ toolName: 'Bash', ruleContent: 'ls' }] }] },
  convo,
})

describe('appendAsk: the ask history', () => {
  beforeEach(() => {
    rmSync(ASKS_PATH, { force: true })
  })
  const lines = () =>
    readFileSync(ASKS_PATH, 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l))
  test('one line per resolved ask, with what was asked and decided', () => {
    appendAsk(sampleAsk('1'), 'allow')
    appendAsk(sampleAsk('2', 'other'), 'deny')
    const [a, b] = lines()
    expect(a).toMatchObject({ asked: '2026-10-03T00:00:00.000Z', convo: 'main', tool: 'Bash', label: 'ls 1', decision: 'allow' })
    expect(a.input).toEqual({ command: 'ls 1' })
    expect(b).toMatchObject({ convo: 'other', decision: 'deny' })
  })
  test('only an "always" decision records what it widened', () => {
    appendAsk(sampleAsk('1'), 'allow')
    appendAsk(sampleAsk('2'), 'always')
    const [a, b] = lines()
    expect(a.widened).toBeUndefined()
    expect(b.widened).toEqual(sampleAsk('2').always!.updates)
  })
})

describe('Asks: the open questions', () => {
  test('put opens a question and tells every listener', () => {
    const asks = new Asks()
    const seen: string[][] = []
    asks.onChange((open) => seen.push(open.map((a) => a.id)))
    asks.put(sampleAsk('1'))
    asks.put(sampleAsk('2'))
    expect(asks.open().map((a) => a.id)).toEqual(['1', '2'])
    expect(seen).toEqual([['1'], ['1', '2']])
  })
  test('an answer resolves the waiting call with its decision and message', async () => {
    const asks = new Asks()
    const p = asks.put(sampleAsk('1'))
    expect(asks.answer('1', 'deny', 'not now')).toBe(true)
    expect(await p).toEqual({ decision: 'deny', message: 'not now' })
    expect(asks.open()).toEqual([])
  })
  test('a second answer to the same id is false, not an error', () => {
    const asks = new Asks()
    asks.put(sampleAsk('1'))
    asks.answer('1', 'allow')
    expect(asks.answer('1', 'allow')).toBe(false)
  })
  test('an unsubscribed listener hears nothing more', () => {
    const asks = new Asks()
    let calls = 0
    const off = asks.onChange(() => calls++)
    asks.put(sampleAsk('1'))
    off()
    asks.put(sampleAsk('2'))
    expect(calls).toBe(1)
  })
  test('clear for one conversation answers only its asks, with the given decision', async () => {
    const asks = new Asks()
    const a = asks.put(sampleAsk('1', 'main'))
    asks.put(sampleAsk('2', 'other'))
    asks.clear('main', 'allow')
    expect(await a).toEqual({ decision: 'allow', message: undefined })
    expect(asks.open().map((x) => x.id)).toEqual(['2'])
  })
  test('clear with no conversation denies every ask', async () => {
    const asks = new Asks()
    const a = asks.put(sampleAsk('1', 'main'))
    const b = asks.put(sampleAsk('2', 'other'))
    asks.clear()
    expect((await a).decision).toBe('deny')
    expect((await b).decision).toBe('deny')
    expect(asks.open()).toEqual([])
  })
})
