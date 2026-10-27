// ConvoManager behaviours from #werk-test-behaviours-convo-manager, against the fake claude
// and the scratch .werk. Behaviour 8 (park) is in convo-manager.reap.test.ts: parking keeps
// the child, and a sweep kills it after #werk-mc-reap's limit.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Agent } from './agent.ts'
import { ConvoManager } from './convo-manager.ts'
import { paths } from './project.ts'
import { alive, fakeEnv, flag, launches, pids, scratchDir, waitFor } from './test/harness.ts'

const WERK = dirname(process.env.WERK_LOG!)
const CONVO_DIR = paths.convos
let manager: ConvoManager
let undo: () => void
let log: string

beforeEach(() => {
  rmSync(CONVO_DIR, { recursive: true, force: true })
  rmSync(join(WERK, 'session'), { force: true })
  rmSync(join(WERK, 'chat.jsonl'), { force: true })
  log = join(scratchDir(), 'fake.jsonl')
  undo = fakeEnv({ FAKE_CLAUDE_LOG: log, FAKE_CLAUDE_MODE: 'ok' })
  manager = new ConvoManager(scratchDir(), ['Read'])
})

afterEach(() => {
  manager.stopAll()
  undo()
})

/** Send one turn and wait until it has finished. */
async function turn(agent: Agent, text: string) {
  let done = false
  const off = agent.onMessage((m) => {
    if (m.done) done = true
  })
  agent.send(text)
  await waitFor(() => done, `the turn in ${agent.name}`)
  off()
}

describe('ConvoManager', () => {
  test('1. main() makes the main agent on first reference, with nothing on disk', () => {
    const main = manager.main()
    expect(main.name).toBe('main')
    expect(main.sessionId).toBeNull()
  })

  test('2. ensure(name) needs a directory record on disk, or it throws', () => {
    expect(() => manager.ensure('nowhere')).toThrow('no conversation named "nowhere"')
    mkdirSync(join(CONVO_DIR, 'on-disk'), { recursive: true })
    writeFileSync(join(CONVO_DIR, 'on-disk', 'chat.jsonl'), JSON.stringify({ at: 'x', from: 'you', text: 'hi', card: 'home' }) + '\n')
    const agent = manager.ensure('on-disk')
    expect([agent.name, agent.home]).toEqual(['on-disk', 'home'])
  })

  test('3. a live agent is always reused, never a second one for the same name', () => {
    const main = manager.main()
    expect(manager.main()).toBe(main)
    expect(manager.ensure('main')).toBe(main)
    mkdirSync(join(CONVO_DIR, 'x'), { recursive: true })
    writeFileSync(join(CONVO_DIR, 'x', 'session'), 'sx\n')
    expect(manager.ensure('x')).toBe(manager.ensure('x'))
    expect(manager.list()).toHaveLength(2)
  })

  test('4. every agent made, main included, is announced to each listener; unsubscribe stops it', async () => {
    const heard: string[] = []
    const late: string[] = []
    const off = manager.onSpawn((a) => heard.push(a.name))
    manager.onSpawn((a) => late.push(a.name))
    await turn(manager.main(), 'hi')
    manager.fork('main', 'card-a')
    off()
    manager.fork('main', 'card-b')
    expect(heard).toEqual(['main', 'card-a'])
    expect(late).toEqual(['main', 'card-a', 'card-b'])
  })

  test('5. a fork of a parent that has sent a message resumes it with --fork-session', async () => {
    const main = manager.main()
    await turn(main, 'hi')
    const child = manager.fork('main', 'card-a')
    expect([child.name, child.home]).toEqual(['card-a', 'card-a'])
    await turn(child, 'from the fork')
    const argv = launches(log).at(-1)!
    expect(flag(argv, '--resume')).toBe(main.sessionId!)
    expect(argv).toContain('--fork-session')
  })

  test('5-nosession. a fork of a tab with no session opens an empty tab on the clicked card', async () => {
    const child = manager.fork('main', 'card-a')
    expect([child.name, child.home]).toEqual(['card-a', 'card-a'])
    expect(child.history()[0].emptyStart).toBe(true)
    await turn(child, 'first message')
    const argv = launches(log).at(-1)!
    expect(argv).not.toContain('--resume')
    expect(argv).not.toContain('--fork-session')
  })

  test('5a. an empty start needs no parent, takes a new name, and launches with no --resume', async () => {
    const main = manager.main()
    await turn(main, 'hi')
    manager.fork('main', 'card-a')
    const empty = manager.startEmpty('card-a')
    expect(empty.name).not.toBe('card-a')
    expect(empty.home).toBe('card-a')
    expect(empty.history()[0].emptyStart).toBe(true)
    await turn(empty, 'clean start')
    const argv = launches(log).at(-1)!
    expect(argv).not.toContain('--resume')
    expect(argv).not.toContain('--fork-session')
  })

  test('5a2. an empty start rebuilt from disk before its first message keeps its home and stays empty', async () => {
    const empty = manager.startEmpty('card-b')
    manager.stopAll()
    manager = new ConvoManager(scratchDir(), ['Read'])
    const again = manager.ensure(empty.name)
    expect(again.home).toBe('card-b')
    await turn(again, 'after a restart')
    expect(launches(log).at(-1)!).not.toContain('--resume')
  })

  test('5b. a fork runs on the parent model and opens with a notice pointing at the parent', async () => {
    const main = manager.main()
    main.setModel('opus', null)
    await turn(main, 'hi')
    const last = main.history().findLast((m) => m.from === 'you' || m.from === 'agent')!
    const child = manager.fork('main', 'card-a')
    expect(child.modelSetting()).toEqual({ model: 'opus', advisor: null })
    expect(child.history()[0].forkOf).toEqual({ convo: 'main', at: last.at, session: main.sessionId })
    await turn(child, 'from the fork')
    expect(flag(launches(log).at(-1)!, '--model')).toBe('opus')
  })

  test('5c. a fork rebuilt from disk before its first message still forks its parent', async () => {
    const main = manager.main()
    await turn(main, 'hi')
    manager.fork('main', 'card-a')
    manager.stopAll()
    manager = new ConvoManager(scratchDir(), ['Read'])
    const child = manager.ensure('card-a')
    expect(child.home).toBe('card-a')
    await turn(child, 'after a restart')
    const argv = launches(log).at(-1)!
    expect(flag(argv, '--resume')).toBe(main.sessionId!)
    expect(argv).toContain('--fork-session')
  })

  test('6. a fork name is unique against live agents and against conversations on disk', async () => {
    await turn(manager.main(), 'hi')
    expect(manager.fork('main', 'card-a').name).toBe('card-a')
    expect(manager.fork('main', 'card-a').name).toBe('card-a-2')
    // On disk from an earlier server run, never ensure()d. Taking its name would resume
    // that old session instead of forking.
    mkdirSync(join(CONVO_DIR, 'card-z'), { recursive: true })
    writeFileSync(join(CONVO_DIR, 'card-z', 'session'), 'old-session\n')
    expect(manager.fork('main', 'card-z').name).toBe('card-z-2')
  })

  test('6b. a conversation rebuilt from disk can be forked before it sends anything', async () => {
    mkdirSync(join(CONVO_DIR, 'card-y'), { recursive: true })
    writeFileSync(join(CONVO_DIR, 'card-y', 'session'), 'disk-session\n')
    writeFileSync(join(CONVO_DIR, 'card-y', 'chat.jsonl'), '')
    const child = manager.fork('card-y', 'card-b')
    expect(child.forkSource()).toBe('disk-session')
  })

  test('7. every agent shares one Asks queue, so an ask from any conversation lands in one place', async () => {
    await turn(manager.main(), 'hi')
    const child = manager.fork('main', 'card-a')
    // main's child was launched in ok mode. Let it go, so the next send launches one that asks.
    manager.main().stop()
    await waitFor(() => pids(log).every((p) => !alive(p)), 'main to exit')
    process.env.FAKE_CLAUDE_MODE = 'ask'
    manager.main().send('ask from main')
    child.send('ask from the fork')
    const open = await waitFor(() => (manager.asks.open().length === 2 ? manager.asks.open() : null), 'two asks')
    expect(open.map((a) => a.convo).sort()).toEqual(['card-a', 'main'])
  })

  test('9. stopAll() leaves no child running', async () => {
    process.env.FAKE_CLAUDE_MODE = 'hang'
    manager.main().send('one')
    await waitFor(() => manager.main().sessionId, 'main to start')
    const child = manager.fork('main', 'card-a')
    child.send('two')
    await waitFor(() => pids(log).length === 2, 'two children')
    expect(pids(log).every(alive)).toBe(true)
    manager.stopAll()
    await waitFor(() => pids(log).every((p) => !alive(p)), 'every child to exit')
  })
})
