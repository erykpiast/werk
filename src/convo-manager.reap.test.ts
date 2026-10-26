import { beforeAll, describe, expect, test } from 'bun:test'
import { EventEmitter } from 'node:events'
import { tmpdir } from 'node:os'
import { dirname } from 'node:path'
import { PassThrough } from 'node:stream'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import type { SpawnChild } from './agent.ts'

import { ConvoManager, wholeMs } from './convo-manager.ts'
import { paths } from './project.ts'

// src/test/setup.ts points WERK_LOG at a scratch directory before anything loads log.ts.
// Every path the manager writes to hangs off it; the guard below stops a run that would
// write into the real .werk.
const scratch = dirname(dirname(paths.log))

/** A stand-in for the `claude` child: pipes the Agent reads and writes, and a kill that
 *  exits the way a real one does. */
class FakeChild extends EventEmitter {
  stdin = new PassThrough()
  stdout = new PassThrough()
  stderr = new PassThrough()
  killed = false
  kill() {
    if (this.killed) return true
    this.killed = true
    setTimeout(() => this.emit('exit', null), 0)
    return true
  }
  /** One stream-json line from the CLI. */
  say(event: unknown) {
    this.stdout.write(JSON.stringify(event) + '\n')
  }
}

function harness(reapMs: number) {
  const children: FakeChild[] = []
  const argvs: string[][] = []
  const spawnChild: SpawnChild = (_cmd, args) => {
    const c = new FakeChild()
    children.push(c)
    argvs.push(args)
    return c as unknown as ChildProcessWithoutNullStreams
  }
  const manager = new ConvoManager(scratch, ['Read'], false, { reapMs, spawnChild })
  return { manager, children, argvs }
}

/** Start main's child and finish its turn, so it is alive and idle. */
async function idleMain(h: ReturnType<typeof harness>) {
  const agent = h.manager.main()
  agent.send('hi')
  const child = h.children[0]
  child.say({ type: 'system', subtype: 'init', session_id: 'session-1' })
  child.say({ type: 'result', duration_api_ms: 10 })
  await Bun.sleep(5)
  expect(agent.busy).toBe(false)
  expect(agent.hasChild()).toBe(true)
  return { agent, child }
}

// The scratch directory belongs to setup.ts and is shared by every test file (it also holds
// the fake claude on PATH), so this file checks it but never deletes it.
beforeAll(() => {
  expect(scratch.startsWith(tmpdir())).toBe(true)
})

describe('#werk-cli-serve idle values', () => {
  test('only a positive whole number counts; anything else falls back to the default', () => {
    expect(wholeMs('300')).toBe(300)
    for (const bad of [undefined, '', '0', '-5', '1.5', '10s', 'abc', ' 7']) expect(wholeMs(bad)).toBeUndefined()
  })

  test('the check interval is its own value, apart from the idle limit', async () => {
    // Idle limit 20 ms, but a check only every 5 s: the child outlives the limit unswept.
    const children: FakeChild[] = []
    const spawnChild: SpawnChild = () => {
      const c = new FakeChild()
      children.push(c)
      return c as unknown as ChildProcessWithoutNullStreams
    }
    const manager = new ConvoManager(scratch, ['Read'], false, { reapMs: 20, checkMs: 5000, spawnChild })
    const agent = manager.main()
    agent.send('hi')
    children[0].say({ type: 'system', subtype: 'init', session_id: 'session-1' })
    children[0].say({ type: 'result', duration_api_ms: 10 })
    await Bun.sleep(5)
    manager.park('main')
    await Bun.sleep(120)
    expect(children[0].killed).toBe(false)
    manager.stopAll()
  })
})

describe('#werk-mc-park-unpark', () => {
  test('an un-park after a sweep starts a child at once, on the stored session', async () => {
    const h = harness(20)
    const { agent } = await idleMain(h)
    h.manager.park('main')
    await Bun.sleep(80)
    expect(agent.hasChild()).toBe(false)
    h.manager.unpark('main')
    expect(h.children).toHaveLength(2)
    expect(agent.hasChild()).toBe(true)
    expect(h.argvs[1]).toContain('--resume')
    expect(h.argvs[1]).toContain('session-1')
    h.manager.stopAll()
  })

  test('an un-park of a live child starts nothing', async () => {
    const h = harness(60_000)
    const { child } = await idleMain(h)
    h.manager.park('main')
    h.manager.unpark('main')
    expect(h.children).toHaveLength(1)
    expect(child.killed).toBe(false)
    h.manager.stopAll()
  })

  test('an un-park of a conversation with no stored session starts nothing', async () => {
    const h = harness(60_000)
    const fresh = h.manager.startEmpty('map')
    const name = fresh.name
    h.manager.park(name)
    h.manager.unpark(name)
    expect(h.children).toHaveLength(0)
    expect(fresh.hasChild()).toBe(false)
    h.manager.stopAll()
  })
})

describe('#werk-mc-reap', () => {
  test('parking does not kill the child', async () => {
    const h = harness(60_000)
    const { agent, child } = await idleMain(h)
    h.manager.park('main')
    await Bun.sleep(5)
    expect(child.killed).toBe(false)
    expect(agent.hasChild()).toBe(true)
    h.manager.stopAll()
  })

  test('the sweep kills a parked child left untouched past the interval', async () => {
    const h = harness(20)
    const { agent, child } = await idleMain(h)
    h.manager.park('main')
    await Bun.sleep(80)
    expect(child.killed).toBe(true)
    expect(agent.hasChild()).toBe(false)
    h.manager.stopAll()
  })

  test('the sweep leaves a visible tab alone, however long it idles', async () => {
    const h = harness(20)
    const { child } = await idleMain(h)
    await Bun.sleep(80)
    expect(child.killed).toBe(false)
    h.manager.stopAll()
  })

  test('un-parking before the interval saves the child', async () => {
    const h = harness(20)
    const { child } = await idleMain(h)
    h.manager.park('main')
    h.manager.unpark('main')
    await Bun.sleep(80)
    expect(child.killed).toBe(false)
    h.manager.stopAll()
  })

  test('the sweep leaves a parked child alone while a turn or a background agent runs', async () => {
    const h = harness(60_000)
    const { agent, child } = await idleMain(h)
    h.manager.park('main')
    child.say({ type: 'system', subtype: 'background_tasks_changed', tasks: [{ task_id: 't', task_type: 'agent', description: 'x' }] })
    await Bun.sleep(5)
    h.manager.sweep(Date.now() + 120_000)
    expect(child.killed).toBe(false)
    child.say({ type: 'system', subtype: 'background_tasks_changed', tasks: [] })
    agent.send('again')
    await Bun.sleep(5)
    h.manager.sweep(Date.now() + 120_000)
    expect(child.killed).toBe(false)
    h.manager.stopAll()
  })

  test('a swept child exits quietly, and the next message resumes its session', async () => {
    const h = harness(20)
    const { agent, child } = await idleMain(h)
    h.manager.park('main')
    await Bun.sleep(80)
    expect(child.killed).toBe(true)
    expect(agent.history().some((m) => /stopped/.test(m.text))).toBe(false)
    h.manager.unpark('main')
    agent.send('back')
    expect(h.children.length).toBe(2)
    h.manager.stopAll()
  })
})

describe('a stop followed at once by a send', () => {
  test("the old child's late exit does not orphan the new one", async () => {
    const h = harness(60_000)
    const { agent } = await idleMain(h)
    agent.stop()
    agent.send('again')
    expect(h.children.length).toBe(2)
    // The stopped child's exit event arrives after the new child is already running.
    await Bun.sleep(10)
    expect(agent.hasChild()).toBe(true)
    expect(agent.busy).toBe(true)
    h.manager.stopAll()
  })
})
