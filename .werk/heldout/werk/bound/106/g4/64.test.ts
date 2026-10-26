import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { accepted, decidedRoot, linked, logEvents, logLines, makeProject, mapGraph, ok, proposed, seed, show, startServer, type Project } from './helpers.ts'

const MAIN = join(import.meta.dir, '..', '..', 'src', 'cli', 'main.ts')
const statusOf = (out: string) => out.split('\n').find((l) => l.startsWith('status:'))

/** The command lines a refusal prints: the indented lines that start with `werk `. */
const printedCommands = (out: string) =>
  out
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('werk ') && !/^werk [a-z-]+:/.test(l))

/** Runs one printed command the way an agent does in a shell, with `werk` as the werk command line. */
function runPrinted(p: Project, cmd: string, fill: Record<string, string> = {}) {
  let line = cmd
  for (const [hole, value] of Object.entries(fill)) line = line.replaceAll(hole, value)
  return p.run(['sh', '-c', `werk() { ${JSON.stringify(process.execPath)} ${JSON.stringify(MAIN)} "$@"; }\n${line}`])
}

/** An open card c with a decider, a depends_on edge on a decided card, and a rejected option. */
const openCardWithoutKill = () => [
  ...decidedRoot('base', 'Base'),
  proposed('c', { title: 'Card C', body: 'The body of C', status: 'open', who: 'you' }),
  accepted('c'),
  linked('c', 'base', 'depends_on'),
  proposed('c-opt', { kind: 'option', title: 'The other way', whyNot: 'It lost' }),
  accepted('c-opt'),
  linked('c-opt', 'c', 'alternative_to'),
]

describe('64', () => {
  test('64.1 A card that lacks a kill criterion stays open, and the printed command fixes it', async () => {
    const p = makeProject()
    seed(p, openCardWithoutKill())
    const server = startServer(p)
    const before = logLines(p)
    const r = p.werk(['status', 'c', 'decided'])
    const out = r.stdout + r.stderr
    expect(r.code).not.toBe(0)
    expect(out).toContain('kill')
    const cmds = printedCommands(out)
    const killCmd = cmds.find((c) => c.startsWith('werk kill c '))
    expect(killCmd).toBeDefined()
    expect((await mapGraph(p, server)).nodes.find((n) => n.id === 'c')?.status).toBe('open')
    expect(logLines(p)).toEqual(before)
    const fix = runPrinted(p, killCmd!)
    expect(fix.code).toBe(0)
    const again = p.werk(['status', 'c', 'decided'])
    expect(again.code).toBe(0)
    expect((await mapGraph(p, server)).nodes.find((n) => n.id === 'c')?.status).toBe('decided')
  })

  test('64.2 A card that lacks several facts reports each missing fact with its own command', async () => {
    const p = makeProject()
    seed(p, [...decidedRoot('base', 'Base'), proposed('c', { title: 'Card C', body: 'The body of C' }), accepted('c')])
    const server = startServer(p)
    const r = p.werk(['status', 'c', 'decided'])
    const out = r.stdout + r.stderr
    expect(r.code).not.toBe(0)
    for (const fact of ['who:', 'basis:', 'options:', 'kill:']) expect(out).toContain(fact)
    const cmds = printedCommands(out)
    expect(cmds.some((c) => c.startsWith('werk edit c --who'))).toBe(true)
    expect(cmds.some((c) => c.startsWith('werk link c ') && c.includes('depends_on'))).toBe(true)
    expect(cmds.some((c) => c.includes('--kind option') && c.includes('alternative_to'))).toBe(true)
    expect(cmds.some((c) => c.startsWith('werk kill c '))).toBe(true)
    expect(cmds).toHaveLength(4)
    expect((await mapGraph(p, server)).nodes.find((n) => n.id === 'c')?.status).not.toBe('decided')
    // The agent fills the one bare placeholder, the card the basis link points at.
    for (const cmd of cmds) {
      const fix = runPrinted(p, cmd, { '<card-it-needs>': 'base' })
      expect({ cmd, code: fix.code, err: fix.stderr }).toMatchObject({ code: 0 })
    }
    // The option the agent proposed is a ghost; the step does not say it is accepted, and the contract reads held edges.
    const again = p.werk(['status', 'c', 'decided'])
    expect({ code: again.code, err: again.stderr }).toMatchObject({ code: 0 })
    expect((await mapGraph(p, server)).nodes.find((n) => n.id === 'c')?.status).toBe('decided')
  })

  test('64.3 A ghost card obeys the same check through its held edges', () => {
    const p = makeProject()
    seed(p, decidedRoot('base', 'Base'))
    ok(p, ['add', 'g1', '--title', 'Ghost one', '--who', 'you'])
    ok(p, ['link', 'g1', 'base', '--type', 'depends_on'])
    ok(p, ['add', 'g1-opt', '--kind', 'option', '--title', 'Other way', '--why-not', 'It lost'])
    ok(p, ['link', 'g1-opt', 'g1', '--type', 'alternative_to'])
    ok(p, ['kill', 'g1', '--form', 'manual', '--text', 'revisit after a month'])
    ok(p, ['add', 'g2', '--title', 'Ghost two', '--who', 'you'])
    ok(p, ['add', 'g2-opt', '--kind', 'option', '--title', 'Other way', '--why-not', 'It lost'])
    ok(p, ['link', 'g2-opt', 'g2', '--type', 'alternative_to'])
    ok(p, ['kill', 'g2', '--form', 'manual', '--text', 'revisit after a month'])
    const r1 = p.werk(['status', 'g1', 'decided'])
    expect({ code: r1.code, err: r1.stderr }).toMatchObject({ code: 0 })
    expect(statusOf(show(p, 'g1').stdout)).toBe('status: decided')
    const r2 = p.werk(['status', 'g2', 'decided'])
    const out = r2.stdout + r2.stderr
    expect(r2.code).not.toBe(0)
    expect(out).toContain('basis:')
    expect(printedCommands(out).some((c) => c.startsWith('werk link g2 ') && c.includes('depends_on'))).toBe(true)
    expect(statusOf(show(p, 'g2').stdout)).not.toBe('status: decided')
  })

  const decidedCard = () => [
    ...openCardWithoutKill(),
    { type: 'kill.recorded', payload: { id: 'c', criterion: { form: 'manual', text: 'use c for a week' } } } as const,
    { type: 'node.status_set', payload: { id: 'c', status: 'decided' } } as const,
  ]

  test('64.4 An amend that removes a required fact is refused and the decided card stays the same', () => {
    const p = makeProject()
    seed(p, decidedCard() as never)
    const before = show(p, 'c').stdout
    expect(before).toContain('status: decided')
    const r = p.werk(['amend', 'c', '--summary', 'drop the basis', '--unlink', 'base'])
    const out = r.stdout + r.stderr
    expect(r.code).not.toBe(0)
    expect(out).toContain('basis:')
    expect(printedCommands(out).some((c) => c.startsWith('werk link c ') && c.includes('depends_on'))).toBe(true)
    const after = show(p, 'c').stdout
    expect(after).toContain('status: decided')
    expect(after).toBe(before)
  })

  test('64.5 An amend that keeps every fact succeeds, and card text is not checked', () => {
    const p = makeProject()
    seed(p, decidedCard() as never)
    const n0 = logEvents(p).length
    const r = p.werk(['amend', 'c', '--summary', 'shorter body', '--body', 'One short sentence.'])
    expect({ code: r.code, err: r.stderr }).toMatchObject({ code: 0 })
    const s = show(p, 'c').stdout
    expect(s).toContain('status: decided')
    expect(s).toContain('One short sentence.')
    const added = logEvents(p).slice(n0)
    expect(added.some((e) => e.type === 'node.reopened' && e.payload.id === 'c')).toBe(true)
    expect(added.some((e) => e.type === 'node.status_set' && e.payload.id === 'c' && e.payload.status === 'decided')).toBe(true)
  })
})
