import { afterEach, expect, test } from 'bun:test'
import { acc, kil, lnk, project, prop, type P } from './cli-util.ts'

let p: P
afterEach(() => p?.cleanup())

const statusLine = (id: string) => p.w('show', id).stdout.split('\n').find((l) => l.startsWith('status:'))
const statusEvents = (id: string) => p.log().filter((e) => e.type === 'node.status_set' && e.payload.id === id).length

/** Splits a printed command into argv, the way a shell would for simple double-quoted words. */
function argv(command: string): string[] {
  const words = [...command.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]!)
  expect(words[0]).toBe('werk')
  return words.slice(1)
}

/** A real decided basis card "base", with every fact. */
const base = [prop('base', { title: 'The base', status: 'decided', who: 'me' }), acc('base'), { type: 'node.edited', payload: { id: 'base', noBasis: 'root' } }, kil('base')]

test('64.1', () => {
  p = project()
  p.seed([
    ...base,
    prop('c', { title: 'The card', status: 'open', who: 'you' }),
    acc('c'),
    lnk('c', 'base', 'depends_on'),
    prop('o', { kind: 'option', title: 'The option', whyNot: 'It lost' }),
    acc('o'),
    lnk('o', 'c', 'alternative_to'),
  ])
  const before = statusEvents('c')
  const r = p.w('status', 'c', 'decided')
  console.log('64.1 refusal:\n' + r.all)
  expect(r.code).not.toBe(0)
  expect(r.all).toMatch(/kill/)
  const cmd = r.all.split('\n').map((l) => l.trim()).find((l) => l.startsWith('werk kill c'))
  expect(cmd).toBeDefined()
  expect(statusLine('c')).toBe('status: open')
  expect(statusEvents('c')).toBe(before)
  expect(p.w(...argv(cmd!)).code).toBe(0)
  expect(p.w('status', 'c', 'decided').code).toBe(0)
  expect(statusLine('c')).toBe('status: decided')
})

test('64.2', () => {
  p = project()
  p.seed([...base, prop('c', { title: 'The card', body: 'Some body text', status: 'open' }), acc('c')])
  const r = p.w('status', 'c', 'decided')
  console.log('64.2 refusal:\n' + r.all)
  expect(r.code).not.toBe(0)
  expect(statusLine('c')).toBe('status: open')
  const facts = ['who', 'basis', 'options', 'kill']
  const missing = facts.filter((f) => !new RegExp(`^\\s+${f}:`, 'm').test(r.all))
  const cmds = r.all.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('werk ') && !/^werk \w+:/.test(l))
  // Run each printed command in turn. A placeholder for a card id is filled with a real card, as an agent would.
  for (const c of cmds) {
    for (const part of c.split(' && ')) {
      const filled = part.replace('<card-it-needs>', 'base')
      const res = p.w(...argv(filled))
      console.log('64.2 ran:', filled, '->', res.code, res.all.trim())
    }
  }
  const again = p.w('status', 'c', 'decided')
  console.log('64.2 decide again:', again.code, again.all.trim())
  const decided = statusLine('c')
  expect({ missing, decided }).toEqual({ missing: [], decided: 'status: decided' })
})

test('64.3', () => {
  p = project()
  p.seed(base)
  p.ok('add', 'g1', '--title', 'First ghost', '--who', 'you')
  p.ok('link', 'g1', 'base', '--type', 'depends_on')
  p.ok('add', 'g1o', '--kind', 'option', '--title', 'An option', '--why-not', 'It lost')
  p.ok('link', 'g1o', 'g1', '--type', 'alternative_to')
  p.ok('kill', 'g1', '--form', 'revisit')
  p.ok('add', 'g2', '--title', 'Second ghost', '--who', 'you')
  p.ok('add', 'g2o', '--kind', 'option', '--title', 'An option', '--why-not', 'It lost')
  p.ok('link', 'g2o', 'g2', '--type', 'alternative_to')
  p.ok('kill', 'g2', '--form', 'revisit')
  expect(p.w('status', 'g1', 'decided').code).toBe(0)
  expect(statusLine('g1')).toBe('status: decided')
  expect(p.w('show', 'g1').stdout).toMatch(/ghost/)
  const r = p.w('status', 'g2', 'decided')
  console.log('64.3 refusal:\n' + r.all)
  expect(r.code).not.toBe(0)
  expect(r.all).toMatch(/basis/)
  expect(r.all).toContain('--type depends_on')
  expect(statusLine('g2')).not.toBe('status: decided')
})

const decidedCard = () => [
  ...base,
  prop('c', { title: 'The card', body: 'The old body. It is long.', status: 'decided', who: 'you' }),
  acc('c'),
  lnk('c', 'base', 'depends_on'),
  prop('o', { kind: 'option', title: 'The option', whyNot: 'It lost' }),
  acc('o'),
  lnk('o', 'c', 'alternative_to'),
  kil('c'),
]

test('64.4', () => {
  p = project()
  p.seed(decidedCard())
  const help = p.w('help').stdout
  console.log('64.4 verbs:\n' + help)
  // No verb removes an edge. Try the verbs that change a card to see if any can drop the depends_on edge.
  const tries = [p.w('unlink', 'c', 'base', '--type', 'depends_on'), p.w('amend', 'c')]
  for (const t of tries) console.log('64.4 try:', t.code, t.all.trim())
  const st = p.state()
  expect(st.edges.some((e) => e.from === 'c' && e.type === 'depends_on')).toBe(true)
  // The step needs an amend that removes the edge to be refused with the missing basis named.
  expect(tries.some((t) => t.code === 1 && /basis/.test(t.all) && /depends_on/.test(t.all))).toBe(true)
})

test('64.5', () => {
  p = project()
  p.seed(decidedCard())
  const before = p.log().length
  const r = p.w('edit', 'c', '--body', 'One short sentence.')
  console.log('64.5 edit:', r.code, r.all.trim())
  expect(r.code).toBe(0)
  expect(statusLine('c')).toBe('status: decided')
  expect(p.w('show', 'c').stdout).toContain('One short sentence.')
  const added = p.log().slice(before).map((e) => e.type)
  console.log('64.5 new events:', added)
  expect(added).toContain('node.reopened')
  expect(added).toContain('node.status_set')
})

const card = (id: string, extra: Record<string, unknown> = {}) => [prop(id, { title: `Card ${id}`, status: 'decided', who: 'me', ...extra }), acc(id)]

test('65.1', () => {
  p = project()
  p.seed([...card('a'), ...card('b'), ...card('c'), lnk('b', 'a', 'depends_on'), lnk('c', 'b', 'depends_on')])
  p.ok('reopen', 'a', '--reason', 'rejected', '--why', 'the storage choice is wrong')
  const out = p.w('stale').stdout
  console.log('65.1 stale:\n' + out)
  expect(out).toMatch(/^stale\s+#b\b/m)
  expect(out).toMatch(/rejected #a .*depends_on/)
  expect(out).not.toContain('#c ')
  const showC = p.w('show', 'c').stdout
  expect(showC).not.toMatch(/stale|paused/)
})

test('65.2', () => {
  p = project()
  p.seed([...card('a'), ...card('b'), ...card('c'), ...card('d'), lnk('b', 'a', 'depends_on'), lnk('c', 'b', 'depends_on'), lnk('d', 'c', 'depends_on')])
  p.ok('reopen', 'a', '--reason', 'postponed', '--why', 'the engine build waits for next quarter')
  const out = p.w('stale').stdout
  console.log('65.2 stale:\n' + out)
  for (const id of ['b', 'c', 'd']) expect(out).toMatch(new RegExp(`^paused\\s+#${id}\\b`, 'm'))
  expect(statusLine('d')).toBe('status: decided')
  const dBlock = out.split('\n').slice(out.split('\n').findIndex((l) => /#d\b/.test(l)))
  expect(dBlock[1]).toMatch(/postponed #a/)
  expect(out).not.toMatch(/^stale\s/m)
})

test('65.3', () => {
  p = project()
  p.seed([...card('a'), ...card('b'), ...card('c'), lnk('c', 'a', 'depends_on'), lnk('c', 'b', 'refines')])
  p.ok('reopen', 'a', '--reason', 'postponed', '--why', 'later')
  p.ok('reopen', 'b', '--reason', 'rejected', '--why', 'wrong')
  const out = p.w('stale').stdout
  console.log('65.3 stale:\n' + out)
  expect(out).toMatch(/^stale\s+#c\b/m)
  expect(out).not.toMatch(/^paused\s+#c\b/m)
  expect(out).toMatch(/rejected #b /)
})

test('65.4', () => {
  p = project()
  p.seed([...card('a'), ...card('b'), ...card('c'), lnk('b', 'a', 'depends_on'), lnk('c', 'a', 'depends_on')])
  p.ok('reopen', 'a', '--reason', 'rejected', '--why', 'wrong')
  let out = p.w('stale').stdout
  expect(out).toMatch(/^stale\s+#b\b/m)
  expect(out).toMatch(/^stale\s+#c\b/m)
  p.ok('rederive', 'b', 'confirm', '--why', 'still holds')
  out = p.w('stale').stdout
  console.log('65.4 stale:\n' + out)
  expect(out).not.toMatch(/#b\b/)
  expect(out).toMatch(/^stale\s+#c\b/m)
  expect(out).toMatch(/rejected #a /)
  expect(p.w('show', 'b').stdout).not.toMatch(/stale/)
})

test('65.5', () => {
  p = project()
  p.seed([
    ...card('a'),
    { type: 'node.edited', payload: { id: 'a', noBasis: 'root' } },
    kil('a'),
    ...card('b'),
    ...card('c'),
    lnk('b', 'a', 'depends_on'),
    lnk('c', 'b', 'depends_on'),
  ])
  const cStatus = statusLine('c')
  p.ok('reopen', 'a', '--reason', 'postponed', '--why', 'later')
  let out = p.w('stale').stdout
  expect(out).toMatch(/^paused\s+#b\b/m)
  expect(out).toMatch(/^paused\s+#c\b/m)
  const r = p.w('status', 'a', 'decided')
  console.log('65.5 decide a:', r.code, r.all.trim())
  expect(r.code).toBe(0)
  out = p.w('stale').stdout
  console.log('65.5 stale after:\n' + out)
  expect(out).not.toMatch(/#b\b/)
  expect(out).not.toMatch(/#c\b/)
  expect(statusLine('c')).toBe(cStatus!)
})
