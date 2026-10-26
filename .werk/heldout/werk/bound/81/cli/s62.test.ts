import { afterEach, expect, test } from 'bun:test'
import { out, project, soft, type P } from './helpers.ts'

let p: P | undefined
afterEach(() => p?.cleanup())

const appendedOne = (before: string[], after: string[]) =>
  after.length === before.length + 1 && before.every((l, i) => after[i] === l)

test('62.1', () => {
  p = project()
  const s = soft()
  // Given a map whose log already holds some events
  expect(p.werk(['add', 'root', '--title', 'The root']).code).toBe(0)
  expect(p.werk(['accept', 'root', '--actor', 'you']).code).toBe(0)
  let before = p.lines()
  expect(before.length).toBe(2)

  const add = p.werk(['add', 'use-log', '--title', 'Use a log', '--body', 'The body text', '--why', 'The why text'])
  s.check(add.code === 0, `add exit ${add.code}: ${out(add)}`)
  s.check(add.stdout.includes('proposed'), `add output lacks "proposed": ${add.stdout}`)
  s.check(appendedOne(before, p.lines()), 'add did not append exactly one line at the end')

  const shown = p.show('use-log').stdout
  for (const t of ['Use a log', 'The body text', 'The why text']) s.check(shown.includes(t), `show lacks ${t}`)
  s.check(/ghost/.test(shown), `show does not mark ghost: ${shown}`)

  before = p.lines()
  const a = p.werk(['accept', 'use-log', '--actor', 'you'])
  s.check(a.code === 0, `accept exit ${a.code}: ${out(a)}`)
  s.check(appendedOne(before, p.lines()), 'accept did not append exactly one line at the end')
  const real = p.show('use-log').stdout
  for (const t of ['Use a log', 'The body text', 'The why text']) s.check(real.includes(t), `show after accept lacks ${t}`)
  s.check(real.includes('state: real') && !/ghost/.test(real), `show after accept: ${real}`)
  expect(s.problems).toEqual([])
})

test('62.2', () => {
  p = project()
  const s = soft()
  expect(p.werk(['add', 'c1', '--title', 'A card']).code).toBe(0)
  const before = p.lines()
  const a = p.werk(['accept', 'c1'])
  s.check(a.code !== 0, `accept without claim exit ${a.code}`)
  s.check(p.lines().length === before.length, 'accept without claim appended an event')
  s.check(/ghost/.test(p.show('c1').stdout), 'card is not a ghost after refused accept')
  const b = p.werk(['accept', 'c1', '--actor', 'you'])
  s.check(b.code === 0, `accept with claim exit ${b.code}: ${out(b)}`)
  const shown = p.show('c1').stdout
  s.check(shown.includes('state: real') && !/ghost/.test(shown), `show after accept: ${shown}`)
  expect(s.problems).toEqual([])
})

test('62.3', () => {
  p = project()
  const s = soft()
  expect(p.werk(['add', 'c1', '--title', 'Use a log']).code).toBe(0)
  const n = p.lines().length
  const e = p.werk(['edit', 'c1', '--body', 'New body'])
  s.check(e.code !== 0 && p.lines().length === n, `edit on ghost exit ${e.code}, lines ${p.lines().length}`)
  const r = p.werk(['retitle', 'c1', '--title', 'Use an append-only log'])
  s.check(r.code !== 0 && p.lines().length === n, `retitle on ghost exit ${r.code}, lines ${p.lines().length}`)
  const a = p.werk(['add', 'c1', '--title', 'Another title'])
  s.check(a.code !== 0 && p.lines().length === n, `second add exit ${a.code}, lines ${p.lines().length}`)
  const shown = p.show('c1').stdout
  s.check(shown.includes('Use a log') && /ghost/.test(shown), `show: ${shown}`)
  expect(s.problems).toEqual([])
})

test('62.4', () => {
  p = project()
  const s = soft()
  expect(p.werk(['add', 'c1', '--title', 'Use a log']).code).toBe(0)
  expect(p.werk(['accept', 'c1', '--actor', 'you']).code).toBe(0)
  const before = p.lines()
  const r = p.werk(['retitle', 'c1', '--title', 'Use an append-only log'])
  s.check(r.code === 0, `retitle exit ${r.code}: ${out(r)}`)
  s.check(appendedOne(before, p.lines()), 'retitle did not append exactly one line at the end')
  const shown = p.show('c1').stdout
  s.check(shown.includes('Use an append-only log') && !shown.includes('Use a log'), `show: ${shown}`)
  s.check(p.lines()[0]!.includes('"Use a log"'), 'earlier line lacks "Use a log"')
  const e = p.werk(['edit', 'c1', '--body', 'The new body'])
  s.check(e.code === 0, `edit exit ${e.code}: ${out(e)}`)
  const after = p.show('c1').stdout
  s.check(after.includes('The new body') && after.includes('Use an append-only log'), `show after edit: ${after}`)
  expect(s.problems).toEqual([])
})

test('62.5', () => {
  p = project()
  const s = soft()
  expect(p.werk(['add', 'card', '--title', 'A card']).code).toBe(0)
  expect(p.werk(['accept', 'card', '--actor', 'you']).code).toBe(0)
  const adds: [string, string[]][] = [
    ['opt', ['add', 'opt', '--kind', 'option', '--title', 'An option', '--why-not', 'It costs too much', '--parent', 'card']],
    ['src', ['add', 'src', '--kind', 'source', '--title', 'A source', '--body', 'Source body']],
    ['ex', ['add', 'ex', '--kind', 'excerpt', '--title', 'An excerpt', '--body', 'Excerpt body']],
  ]
  for (const [id, args] of adds) {
    const before = p.lines()
    const r = p.werk(args)
    s.check(r.code === 0 && r.stdout.includes('proposed'), `add ${id}: exit ${r.code}, ${out(r)}`)
    s.check(appendedOne(before, p.lines()), `add ${id} did not append exactly one line`)
  }
  const opt = p.show('opt').stdout
  s.check(opt.includes('An option') && opt.includes('It costs too much') && /ghost/.test(opt), `show opt: ${opt}`)
  const src = p.show('src').stdout
  s.check(src.includes('A source') && src.includes('Source body') && /ghost/.test(src), `show src: ${src}`)
  const ex = p.show('ex').stdout
  s.check(ex.includes('An excerpt') && ex.includes('Excerpt body') && /ghost/.test(ex), `show ex: ${ex}`)

  const a = p.werk(['accept', 'opt', '--actor', 'you'])
  s.check(a.code === 0, `accept opt exit ${a.code}: ${out(a)}`)
  const opt2 = p.show('opt').stdout
  s.check(opt2.includes('state: real') && opt2.includes('why-not: It costs too much'), `show opt after accept: ${opt2}`)
  s.check(/ghost/.test(p.show('src').stdout) && /ghost/.test(p.show('ex').stdout), 'source or excerpt is no longer a ghost')
  expect(s.problems).toEqual([])
})
