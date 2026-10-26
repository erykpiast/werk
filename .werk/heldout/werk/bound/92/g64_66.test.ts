/** Held-out steps 64.x, 65.x, 66.x, run through the real command line. */
import { afterEach, describe, expect, setDefaultTimeout, test } from 'bun:test'
setDefaultTimeout(120_000)
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeProject, type Project, type RunResult } from '../src/test/harness.ts'

const MAIN = join(import.meta.dir, '..', 'src', 'cli', 'main.ts')
const cleanups: (() => void)[] = []
afterEach(() => cleanups.splice(0).forEach((c) => c()))

type P = Project & {
  ok: (args: string[]) => RunResult
  lines: () => string[]
  events: () => { type: string; payload: Record<string, unknown> }[]
  show: (id: string) => string
  stale: () => string
  sh: (cmd: string) => RunResult
}

function project(): P {
  const p = makeProject()
  cleanups.push(p.cleanup)
  const logFile = join(p.dir, '.werk', 'log.jsonl')
  const lines = () => (existsSync(logFile) ? readFileSync(logFile, 'utf8').split('\n').filter(Boolean) : [])
  const ok = (args: string[]) => {
    const r = p.werk(args)
    if (r.code !== 0) throw new Error(`werk ${args.join(' ')} exited ${r.code}: ${r.stdout}${r.stderr}`)
    return r
  }
  return {
    ...p,
    ok,
    lines,
    events: () => lines().map((l) => JSON.parse(l)),
    show: (id) => {
      const r = p.werk(['show', id])
      return r.stdout + r.stderr
    },
    stale: () => ok(['stale']).stdout,
    // Runs a printed command with `werk` as the real command line.
    sh: (cmd) => p.run(['sh', '-c', `werk() { ${JSON.stringify(process.execPath)} ${JSON.stringify(MAIN)} "$@"; }\n${cmd}`]),
  }
}

/** A real card, with the four facts, decided. */
function decided(p: P, id: string, o: { title?: string; dependsOn?: string[]; parent?: string } = {}) {
  p.ok(['add', id, '--title', o.title ?? `Card ${id}`, '--who', 'agent', ...(o.parent ? ['--parent', o.parent] : [])])
  p.ok(['accept', id, '--actor', 'you'])
  for (const d of o.dependsOn ?? []) p.ok(['link', id, d, '--type', 'depends_on'])
  if (!o.parent && !(o.dependsOn ?? []).length) p.ok(['edit', id, '--no-basis', 'a root card'])
  p.ok(['kill', id, '--form', 'manual', '--text', `use ${id} for a week`])
  p.ok(['status', id, 'decided'])
}

/** A real open card. */
function openCard(p: P, id: string, o: { title?: string; dependsOn?: string[]; parent?: string } = {}) {
  p.ok(['add', id, '--title', o.title ?? `Card ${id}`, '--status', 'open', ...(o.parent ? ['--parent', o.parent] : [])])
  p.ok(['accept', id, '--actor', 'you'])
  for (const d of o.dependsOn ?? []) p.ok(['link', id, d, '--type', 'depends_on'])
}

/** A rejected option weighed against a card. */
function option(p: P, id: string, card: string, accept = true) {
  p.ok(['add', id, '--kind', 'option', '--title', `Option ${id}`, '--why-not', 'it lost'])
  if (accept) p.ok(['accept', id, '--actor', 'you'])
  p.ok(['link', id, card, '--type', 'alternative_to'])
}

const statusOf = (show: string) => /^status: (\S+)$/m.exec(show)?.[1]

/** The block of the stale list for one card: its head line and its trace lines. */
function staleEntry(stale: string, id: string): string | undefined {
  const lines = stale.split('\n')
  const i = lines.findIndex((l) => new RegExp(`^\\S+\\s+#${id}\\s`).test(l))
  if (i < 0) return undefined
  const out = [lines[i]!]
  for (let j = i + 1; j < lines.length && lines[j]!.startsWith('  '); j++) out.push(lines[j]!)
  return out.join('\n')
}

describe('64', () => {
  test('64.1', () => {
    const p = project()
    decided(p, 'base')
    openCard(p, 'card', { dependsOn: ['base'] })
    p.ok(['edit', 'card', '--who', 'you'])
    option(p, 'card-opt', 'card')
    const before = p.lines()
    const r = p.werk(['status', 'card', 'decided'])
    expect(r.code).not.toBe(0)
    const out = r.stdout + r.stderr
    expect(out).toMatch(/kill/)
    expect(out).not.toMatch(/^\s+who:/m)
    expect(out).not.toMatch(/^\s+basis:/m)
    expect(out).not.toMatch(/^\s+options:/m)
    const cmd = out.split('\n').find((l) => /^\s*werk kill card /.test(l))
    expect(cmd).toBeDefined()
    expect(statusOf(p.show('card'))).toBe('open')
    expect(p.lines()).toEqual(before)
    const fix = p.sh(cmd!.trim())
    expect(fix.code).toBe(0)
    expect(p.werk(['status', 'card', 'decided']).code).toBe(0)
    expect(statusOf(p.show('card'))).toBe('decided')
  })

  test('64.2', () => {
    const p = project()
    decided(p, 'base')
    p.ok(['add', 'card', '--title', 'Bare card', '--status', 'open', '--body', 'Only some text'])
    p.ok(['accept', 'card', '--actor', 'you'])
    const r = p.werk(['status', 'card', 'decided'])
    expect(r.code).not.toBe(0)
    const out = r.stdout + r.stderr
    for (const fact of ['who', 'basis', 'options', 'kill']) expect(out).toMatch(new RegExp(`^\\s+${fact}:`, 'm'))
    const cmds = out.split('\n').filter((l) => /^\s+werk /.test(l)).map((l) => l.trim())
    expect(cmds.length).toBe(4)
    expect(statusOf(p.show('card'))).toBe('open')
    // The agent fills the one placeholder that names a card; the rest stay as printed.
    for (const c of cmds) {
      const fix = p.sh(c.replace('<card-it-needs>', 'base'))
      expect(fix.code).toBe(0)
    }
    p.werk(['status', 'card', 'decided'])
    expect(statusOf(p.show('card'))).toBe('decided')
  })

  test('64.3', () => {
    const p = project()
    decided(p, 'base')
    for (const g of ['g1', 'g2']) {
      p.ok(['add', g, '--title', `Ghost ${g}`, '--who', 'you'])
      option(p, `${g}-opt`, g, false)
      p.ok(['kill', g, '--form', 'manual', '--text', 'use it'])
    }
    p.ok(['link', 'g1', 'base', '--type', 'depends_on'])
    expect(p.show('g1')).toContain('(held)')
    const r1 = p.werk(['status', 'g1', 'decided'])
    expect(r1.code).toBe(0)
    expect(statusOf(p.show('g1'))).toBe('decided')
    expect(p.show('g1')).toContain('state: ghost')
    const r2 = p.werk(['status', 'g2', 'decided'])
    expect(r2.code).not.toBe(0)
    const out = r2.stdout + r2.stderr
    expect(out).toMatch(/^\s+basis:.*depends_on/m)
    expect(out).toMatch(/^\s+werk link g2 .*--type depends_on/m)
    expect(statusOf(p.show('g2'))).not.toBe('decided')
  })

  const decidedWithAll = (p: P) => {
    decided(p, 'base')
    openCard(p, 'card', { dependsOn: ['base'] })
    p.ok(['edit', 'card', '--who', 'you', '--body', 'The long first body of the card.'])
    option(p, 'card-opt', 'card')
    p.ok(['kill', 'card', '--form', 'manual', '--text', 'use it'])
    p.ok(['status', 'card', 'decided'])
  }

  test('64.4', () => {
    const p = project()
    decidedWithAll(p)
    const before = p.show('card')
    const lines = p.lines()
    const r = p.werk(['amend', 'card', '--unlink', 'base', '--summary', 'drop the basis'])
    expect(r.code).not.toBe(0)
    const out = r.stdout + r.stderr
    expect(out).toMatch(/^\s+basis:/m)
    expect(out).toMatch(/^\s+werk link card .*--type depends_on/m)
    expect(statusOf(p.show('card'))).toBe('decided')
    expect(p.show('card')).toBe(before)
    expect(p.lines()).toEqual(lines)
  })

  test('64.5', () => {
    const p = project()
    decidedWithAll(p)
    const n = p.lines().length
    const r = p.werk(['amend', 'card', '--body', 'One short sentence.', '--summary', 'shorter body'])
    expect(r.code).toBe(0)
    const show = p.show('card')
    expect(statusOf(show)).toBe('decided')
    expect(show).toContain('One short sentence.')
    const added = p.events().slice(n)
    const reopen = added.findIndex((e) => e.type === 'node.reopened' && e.payload.id === 'card')
    const decide = added.findIndex((e) => e.type === 'node.status_set' && e.payload.id === 'card' && e.payload.status === 'decided')
    expect(reopen).toBeGreaterThanOrEqual(0)
    expect(decide).toBeGreaterThan(reopen)
  })
})

describe('65', () => {
  test('65.1', () => {
    const p = project()
    decided(p, 'a')
    decided(p, 'b', { dependsOn: ['a'] })
    decided(p, 'c', { dependsOn: ['b'] })
    p.ok(['reopen', 'a', '--reason', 'rejected', '--why', 'the storage choice is wrong'])
    const s = p.stale()
    const b = staleEntry(s, 'b')
    expect(b).toBeDefined()
    expect(b!).toMatch(/^stale\s+#b/)
    expect(b!).toContain('#a')
    expect(b!).toContain('depends_on')
    expect(b!).toContain('rejected')
    expect(staleEntry(s, 'c')).toBeUndefined()
    expect(p.show('c')).not.toMatch(/stale|paused/)
  })

  test('65.2', () => {
    const p = project()
    decided(p, 'a')
    // d can be decided only when its basis c is decided, so b and c are decided too.
    decided(p, 'b', { dependsOn: ['a'] })
    decided(p, 'c', { dependsOn: ['b'] })
    decided(p, 'd', { dependsOn: ['c'] })
    p.ok(['reopen', 'a', '--reason', 'postponed', '--why', 'the engine build waits for next quarter'])
    const s = p.stale()
    for (const id of ['b', 'c', 'd']) expect(staleEntry(s, id)).toMatch(new RegExp(`^paused\\s+#${id}`))
    expect(statusOf(p.show('d'))).toBe('decided')
    const d = staleEntry(s, 'd')!
    expect(d).toContain('#a')
    expect(d).toContain('postponed')
    expect(s).not.toMatch(/^stale\s/m)
  })

  test('65.3', () => {
    const p = project()
    decided(p, 'a')
    decided(p, 'b')
    decided(p, 'c', { dependsOn: ['a'], parent: 'b' })
    p.ok(['reopen', 'a', '--reason', 'postponed', '--why', 'later'])
    p.ok(['reopen', 'b', '--reason', 'rejected', '--why', 'wrong'])
    const c = staleEntry(p.stale(), 'c')
    expect(c).toMatch(/^stale\s+#c/)
    expect(c!).toMatch(/rejected #b/)
  })

  test('65.4', () => {
    const p = project()
    decided(p, 'a')
    decided(p, 'b', { dependsOn: ['a'] })
    decided(p, 'c', { dependsOn: ['a'] })
    p.ok(['reopen', 'a', '--reason', 'rejected', '--why', 'wrong'])
    let s = p.stale()
    expect(staleEntry(s, 'b')).toMatch(/^stale/)
    expect(staleEntry(s, 'c')).toMatch(/^stale/)
    p.ok(['rederive', 'b', 'confirm', '--why', 'still holds'])
    s = p.stale()
    expect(staleEntry(s, 'b')).toBeUndefined()
    const c = staleEntry(s, 'c')!
    expect(c).toMatch(/^stale/)
    expect(c).toMatch(/rejected #a/)
    expect(p.show('b')).not.toMatch(/stale/)
  })

  test('65.5', () => {
    const p = project()
    decided(p, 'a')
    decided(p, 'b', { dependsOn: ['a'] })
    decided(p, 'c', { dependsOn: ['b'] })
    const cBefore = statusOf(p.show('c'))
    p.ok(['reopen', 'a', '--reason', 'postponed', '--why', 'later'])
    let s = p.stale()
    expect(staleEntry(s, 'b')).toMatch(/^paused/)
    expect(staleEntry(s, 'c')).toMatch(/^paused/)
    p.ok(['status', 'a', 'decided'])
    s = p.stale()
    expect(staleEntry(s, 'b')).toBeUndefined()
    expect(staleEntry(s, 'c')).toBeUndefined()
    expect(statusOf(p.show('c'))).toBe(cBefore)
  })
})

describe('66', () => {
  const child = (show: string, id: string) => new RegExp(`^link: refines <- #${id}\\b`, 'm').test(show)

  test('66.1', () => {
    const p = project()
    openCard(p, 'storage', { title: 'Storage' })
    openCard(p, 'cache', { title: 'Cache', parent: 'storage' })
    openCard(p, 'index', { title: 'Index', parent: 'storage' })
    openCard(p, 'eviction', { title: 'Eviction', parent: 'cache' })
    const before = p.lines()
    // The remove verb takes the person's claim; the agent passes it.
    p.ok(['remove', 'cache', '--actor', 'you'])
    expect(p.show('cache')).toMatch(/^state: removed/m)
    expect(p.show('eviction')).toMatch(/^state: removed/m)
    const s = p.show('storage')
    expect(child(s, 'cache')).toBe(false)
    expect(child(s, 'eviction')).toBe(false)
    expect(child(s, 'index')).toBe(true)
    expect(p.ok(['removed']).stdout).toContain('#cache')
    const after = p.lines()
    expect(after.slice(0, before.length)).toEqual(before)
    expect(after.length).toBe(before.length + 1)
  })

  test('66.2', () => {
    const p = project()
    openCard(p, 'storage', { title: 'Storage' })
    openCard(p, 'memory-budget', { title: 'Memory budget' })
    openCard(p, 'cache', { title: 'Cache', parent: 'storage', dependsOn: ['memory-budget'] })
    openCard(p, 'eviction', { title: 'Eviction', parent: 'cache' })
    p.ok(['remove', 'cache', '--actor', 'you'])
    p.ok(['restore', 'cache'])
    const c = p.show('cache')
    expect(c).not.toMatch(/state: removed/)
    expect(child(p.show('storage'), 'cache')).toBe(true)
    expect(child(c, 'eviction')).toBe(true)
    expect(c).toMatch(/^link: depends_on -> #memory-budget/m)
    expect(p.ok(['removed']).stdout).not.toContain('#cache')
  })

  test('66.3', () => {
    const p = project()
    openCard(p, 'storage', { title: 'Storage' })
    openCard(p, 'bad-layer', { title: 'Bad layer', parent: 'storage' })
    openCard(p, 'write-path', { title: 'Write path', parent: 'bad-layer' })
    openCard(p, 'read-path', { title: 'Read path', parent: 'bad-layer' })
    p.ok(['remove', 'bad-layer', '--actor', 'you', '--reparent'])
    expect(p.show('bad-layer')).toMatch(/^state: removed/m)
    const s = p.show('storage')
    expect(child(s, 'write-path')).toBe(true)
    expect(child(s, 'read-path')).toBe(true)
    expect(p.show('write-path')).toMatch(/^parent: #storage$/m)
    expect(p.show('write-path')).not.toMatch(/state: removed/)
    expect(p.show('read-path')).not.toMatch(/state: removed/)
  })

  test('66.4', () => {
    const p = project()
    decided(p, 'later')
    decided(p, 'wrong')
    openCard(p, 'storage', { title: 'Storage' })
    p.ok(['status', 'storage', 'proto'])
    openCard(p, 'cache', { title: 'Cache', parent: 'storage' })
    openCard(p, 'index', { title: 'Index', parent: 'storage' })
    openCard(p, 'backup', { title: 'Backup', parent: 'storage', dependsOn: ['later'] })
    openCard(p, 'quota', { title: 'Quota', parent: 'storage', dependsOn: ['wrong'] })
    openCard(p, 'outside', { title: 'Outside' })
    p.ok(['reopen', 'later', '--reason', 'postponed', '--why', 'next quarter'])
    p.ok(['reopen', 'wrong', '--reason', 'rejected', '--why', 'wrong choice'])
    const s = p.stale()
    expect(staleEntry(s, 'backup')).toMatch(/^paused/)
    expect(staleEntry(s, 'quota')).toMatch(/^stale/)
    const out = p.ok(['find', 'storage']).stdout
    expect(out).toContain('#cache')
    expect(out).toContain('#index')
    expect(out).not.toContain('#backup')
    expect(out).not.toContain('#quota')
    expect(out).not.toContain('#outside')
  })

  test('66.5', () => {
    const p = project()
    openCard(p, 'storage', { title: 'Storage' })
    openCard(p, 'cache', { title: 'Cache', parent: 'storage' })
    openCard(p, 'index', { title: 'Index', parent: 'storage' })
    p.ok(['remove', 'cache', '--actor', 'you'])
    let out = p.ok(['find', 'storage']).stdout
    expect(out).toContain('#index')
    expect(out).not.toContain('#cache')
    p.ok(['restore', 'cache'])
    out = p.ok(['find', 'storage']).stdout
    expect(out).toContain('#cache')
    expect(out).toContain('#index')
  })
})
