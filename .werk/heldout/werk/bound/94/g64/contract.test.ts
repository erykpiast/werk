import { afterEach, expect, test } from 'bun:test'
import { makeProject, type Project } from '../../src/test/harness.ts'
import { decided, events, logLines, nodeOnMap, ok, runPrinted } from './helpers.ts'

let p: Project
afterEach(() => p?.cleanup())

const out = (r: { stdout: string; stderr: string }) => r.stdout + r.stderr

test('64.1 a card that lacks a kill criterion stays open, and the printed command fixes it', () => {
  p = makeProject()
  decided(p, 'base')
  ok(p, ['add', 'c', '--title', 'Use a log', '--body', 'B', '--who', 'you'])
  ok(p, ['accept', 'c', '--actor', 'you'])
  ok(p, ['link', 'c', 'base', '--type', 'depends_on', '--why', 'needs base'])
  ok(p, ['add', 'c-opt', '--kind', 'option', '--title', 'Use a DB', '--why-not', 'too heavy'])
  ok(p, ['link', 'c-opt', 'c', '--type', 'alternative_to'])
  ok(p, ['accept', 'c-opt', '--actor', 'you'])

  const before = logLines(p)
  const r = p.werk(['status', 'c', 'decided'])
  expect(r.code).not.toBe(0)
  const text = out(r)
  expect(text).toMatch(/kill/)
  expect(text).not.toMatch(/\bwho:|\bbasis:|\boptions:/)
  const cmd = text.split('\n').map((l) => l.trim()).find((l) => l.startsWith('werk kill c '))
  expect(cmd).toBeDefined()
  expect(nodeOnMap(p, 'c')?.status).toBe('open')
  expect(logLines(p)).toEqual(before)

  expect(runPrinted(p, cmd!).code).toBe(0)
  expect(p.werk(['status', 'c', 'decided']).code).toBe(0)
  expect(nodeOnMap(p, 'c')?.status).toBe('decided')
  expect(p.werk(['show', 'c']).stdout).toContain('status: decided')
})

test('64.2 a card that lacks several facts reports each missing fact with its own command', () => {
  p = makeProject()
  decided(p, 'base')
  ok(p, ['add', 'c', '--title', 'Use a log', '--body', 'Only words'])
  ok(p, ['accept', 'c', '--actor', 'you'])

  const r = p.werk(['status', 'c', 'decided'])
  expect(r.code).not.toBe(0)
  const lines = out(r).split('\n').map((l) => l.trim())
  for (const fact of ['who', 'basis', 'options', 'kill']) expect(lines.some((l) => l.startsWith(`${fact}:`))).toBe(true)
  const cmds = lines.filter((l) => l.startsWith('werk ') && !l.startsWith('werk status:'))
  expect(cmds.length).toBe(4)
  expect(nodeOnMap(p, 'c')?.status).toBe('open')

  // The agent fills the placeholders of each printed command.
  const fill = (w: string) => (w === '<card-it-needs>' ? 'base' : w.replace(/<[^>]*>/g, 'filled'))
  for (const cmd of cmds) expect(runPrinted(p, cmd, fill).code).toBe(0)
  expect(p.werk(['status', 'c', 'decided']).code).toBe(0)
  expect(nodeOnMap(p, 'c')?.status).toBe('decided')
})

test('64.3 a ghost card obeys the same check through its held edges', () => {
  p = makeProject()
  decided(p, 'base')
  // The first ghost: decider, held depends_on, held rejected option, kill criterion.
  ok(p, ['add', 'g1', '--title', 'Ghost one', '--who', 'you'])
  ok(p, ['link', 'g1', 'base', '--type', 'depends_on', '--why', 'needs base'])
  ok(p, ['add', 'g1-opt', '--kind', 'option', '--title', 'Other', '--why-not', 'lost'])
  ok(p, ['link', 'g1-opt', 'g1', '--type', 'alternative_to'])
  ok(p, ['kill', 'g1', '--form', 'manual', '--text', 'revisit g1'])
  // The second ghost: every fact but a depends_on basis.
  ok(p, ['add', 'g2', '--title', 'Ghost two', '--who', 'you'])
  ok(p, ['add', 'g2-opt', '--kind', 'option', '--title', 'Other', '--why-not', 'lost'])
  ok(p, ['link', 'g2-opt', 'g2', '--type', 'alternative_to'])
  ok(p, ['kill', 'g2', '--form', 'manual', '--text', 'revisit g2'])

  const r1 = p.werk(['status', 'g1', 'decided'])
  expect(r1.code).toBe(0)
  expect(nodeOnMap(p, 'g1')).toMatchObject({ status: 'decided', proposed: true })

  const r2 = p.werk(['status', 'g2', 'decided'])
  expect(r2.code).not.toBe(0)
  const text = out(r2)
  expect(text).toMatch(/basis:/)
  expect(text).toContain('werk link g2 ')
  expect(text).toContain('--type depends_on')
  expect(nodeOnMap(p, 'g2')?.status).not.toBe('decided')
})

test('64.4 an amend that removes a required fact is refused and the decided card stays the same', () => {
  p = makeProject()
  decided(p, 'base')
  decided(p, 'c', 'base')
  const showBefore = p.werk(['show', 'c']).stdout
  const before = logLines(p)

  const r = p.werk(['amend', 'c', '--summary', 'drop the basis', '--unlink', 'base'])
  expect(r.code).not.toBe(0)
  const text = out(r)
  expect(text).toMatch(/basis:/)
  expect(text).toContain('werk link c ')
  expect(text).toContain('--type depends_on')
  expect(nodeOnMap(p, 'c')?.status).toBe('decided')
  expect(p.werk(['show', 'c']).stdout).toBe(showBefore)
  expect(logLines(p)).toEqual(before)
})

test('64.5 an amend that keeps every fact succeeds, and card text is not checked', () => {
  p = makeProject()
  decided(p, 'base')
  decided(p, 'c', 'base')
  const n = logLines(p).length

  const r = p.werk(['amend', 'c', '--summary', 'shorter body', '--body', 'Short.'])
  expect(r.code).toBe(0)
  expect(nodeOnMap(p, 'c')).toMatchObject({ status: 'decided', body: 'Short.' })
  const show = p.werk(['show', 'c']).stdout
  expect(show).toContain('status: decided')
  expect(show).toContain('Short.')
  const added = events(p).slice(n)
  const types = added.map((e) => e.type)
  expect(types[0]).toBe('node.reopened')
  expect(added[0]!.payload.id).toBe('c')
  expect(added.at(-1)).toMatchObject({ type: 'node.status_set', payload: { id: 'c', status: 'decided' } })
})
