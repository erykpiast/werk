import { expect, setDefaultTimeout, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeProject, type Project } from '../src/test/harness.ts'

// Each step runs many werk commands, and a busy machine runs them slowly.
setDefaultTimeout(120_000)

const MAIN = join(import.meta.dir, '..', 'src', 'cli', 'main.ts')
const logFile = (p: Project) => join(p.dir, '.werk', 'log.jsonl')
const logLines = (p: Project) => (existsSync(logFile(p)) ? readFileSync(logFile(p), 'utf8').split('\n').filter(Boolean) : [])
const events = (p: Project) => logLines(p).map((l) => JSON.parse(l) as { type: string; payload: Record<string, unknown> })
const ok = (p: Project, args: string[]) => {
  const r = p.werk(args)
  if (r.code !== 0) throw new Error(`werk ${args.join(' ')} exited ${r.code}: ${r.stderr}${r.stdout}`)
  return r
}
const show = (p: Project, id: string) => p.werk(['show', id]).stdout
const statusOf = (p: Project, id: string) => show(p, id).split('\n').find((l) => l.startsWith('status:'))

/** The printed commands: each indented line that starts with "werk ", trimmed. */
const printedCommands = (out: string) =>
  out
    .split('\n')
    .filter((l) => /^ {4}werk /.test(l))
    .map((l) => l.trim())

/** Runs a printed command the way an agent does, with its placeholders filled in. */
function runPrinted(p: Project, cmd: string, fill: (placeholder: string) => string) {
  const filled = cmd.replace(/<[^>]+>/g, (m) => fill(m))
  const r = p.run(['sh', '-c', `werk() { "${process.execPath}" "${MAIN}" "$@"; }; ${filled}`])
  if (r.code !== 0) throw new Error(`printed command failed: ${filled}: ${r.stderr}`)
  return r
}
const fillWith = (basis: string) => (ph: string) => (ph === '<card-it-needs>' ? basis : ph.slice(1, -1).replace(/"/g, ''))

/** A real decided card that other cards can depend on. */
function basisCard(p: Project, id: string) {
  ok(p, ['add', id, '--title', `Basis ${id}`, '--who', 'me'])
  ok(p, ['accept', id, '--actor', 'you'])
  ok(p, ['edit', id, '--no-basis', 'a root card'])
  ok(p, ['kill', id, '--form', 'revisit'])
  ok(p, ['status', id, 'decided'])
}
function rejectedOption(p: Project, opt: string, card: string) {
  ok(p, ['add', opt, '--kind', 'option', '--title', 'Another way', '--why-not', 'it lost'])
  ok(p, ['link', opt, card, '--type', 'alternative_to'])
}
/** A decided card with a decider, a depends_on edge, a rejected option and a kill criterion. */
function fullDecided(p: Project) {
  basisCard(p, 'base')
  ok(p, ['add', 'card', '--title', 'The card', '--body', 'A long body that says many things.', '--who', 'me'])
  ok(p, ['accept', 'card', '--actor', 'you'])
  ok(p, ['link', 'card', 'base', '--type', 'depends_on'])
  ok(p, ['add', 'opt', '--kind', 'option', '--title', 'Another way', '--why-not', 'it lost'])
  ok(p, ['accept', 'opt', '--actor', 'you'])
  ok(p, ['link', 'opt', 'card', '--type', 'alternative_to'])
  ok(p, ['kill', 'card', '--form', 'manual', '--text', 'check by use'])
  ok(p, ['status', 'card', 'decided'])
}

// Scenario: A card that lacks a kill criterion stays open, and the printed command fixes it
test('64.1 a card that lacks a kill criterion stays open, and the printed command fixes it', () => {
  const p = makeProject()
  basisCard(p, 'base')
  ok(p, ['add', 'card', '--title', 'The card', '--who', 'me'])
  ok(p, ['accept', 'card', '--actor', 'you'])
  ok(p, ['link', 'card', 'base', '--type', 'depends_on'])
  rejectedOption(p, 'opt', 'card')
  const before = events(p).length
  const r = p.werk(['status', 'card', 'decided'])
  expect(r.code).not.toBe(0)
  const out = r.stdout + r.stderr
  expect(out).toContain('kill criterion')
  expect(out).not.toMatch(/who:|basis:|options:/)
  const cmds = printedCommands(out)
  expect(cmds.length).toBe(1)
  expect(cmds[0]).toMatch(/^werk kill card /)
  expect(statusOf(p, 'card')).toBe('status: open')
  expect(events(p).filter((e) => e.type === 'node.status_set' && e.payload.id === 'card').length).toBe(0)
  expect(events(p).length).toBe(before)
  runPrinted(p, cmds[0]!, fillWith('base'))
  const again = p.werk(['status', 'card', 'decided'])
  expect(again.code).toBe(0)
  expect(statusOf(p, 'card')).toBe('status: decided')
})

// Scenario: A card that lacks several facts reports each missing fact with its own command
test('64.2 a card that lacks several facts reports each with its own command', () => {
  const p = makeProject()
  basisCard(p, 'base')
  ok(p, ['add', 'card', '--title', 'The card', '--body', 'Body text'])
  ok(p, ['accept', 'card', '--actor', 'you'])
  const r = p.werk(['status', 'card', 'decided'])
  expect(r.code).not.toBe(0)
  const out = r.stdout + r.stderr
  expect(out).toMatch(/who: .*decide/)
  expect(out).toMatch(/basis: .*depends_on/)
  expect(out).toMatch(/options: .*option/)
  expect(out).toMatch(/kill: .*kill criterion/)
  const cmds = printedCommands(out)
  expect(cmds.length).toBe(4)
  expect(statusOf(p, 'card')).toBe('status: open')
  for (const c of cmds) runPrinted(p, c, fillWith('base'))
  const again = p.werk(['status', 'card', 'decided'])
  expect(again.code).toBe(0)
  expect(statusOf(p, 'card')).toBe('status: decided')
})

// Scenario: A ghost card obeys the same check through its held edges
test('64.3 a ghost card obeys the same check through its held edges', () => {
  const p = makeProject()
  basisCard(p, 'base')
  ok(p, ['add', 'g1', '--title', 'Ghost one', '--who', 'me'])
  ok(p, ['link', 'g1', 'base', '--type', 'depends_on'])
  ok(p, ['add', 'o1', '--kind', 'option', '--title', 'Other', '--why-not', 'lost'])
  ok(p, ['link', 'o1', 'g1', '--type', 'alternative_to'])
  ok(p, ['kill', 'g1', '--form', 'revisit'])
  ok(p, ['add', 'g2', '--title', 'Ghost two', '--who', 'me'])
  ok(p, ['add', 'o2', '--kind', 'option', '--title', 'Other two', '--why-not', 'lost'])
  ok(p, ['link', 'o2', 'g2', '--type', 'alternative_to'])
  ok(p, ['kill', 'g2', '--form', 'revisit'])
  const r1 = p.werk(['status', 'g1', 'decided'])
  expect(r1.code).toBe(0)
  expect(show(p, 'g1')).toContain('state: ghost')
  expect(statusOf(p, 'g1')).toBe('status: decided')
  const r2 = p.werk(['status', 'g2', 'decided'])
  expect(r2.code).not.toBe(0)
  const out = r2.stdout + r2.stderr
  expect(out).toMatch(/basis: .*depends_on/)
  expect(printedCommands(out).some((c) => c.startsWith('werk link g2 ') && c.includes('--type depends_on'))).toBe(true)
  expect(statusOf(p, 'g2')).not.toBe('status: decided')
})

// Scenario: An amend that removes a required fact is refused and the decided card stays the same
test('64.4 an amend that removes a required fact is refused', () => {
  const p = makeProject()
  fullDecided(p)
  const before = show(p, 'card')
  const r = p.werk(['amend', 'card', '--summary', 'drop the basis', '--unlink', 'base'])
  expect(r.code).not.toBe(0)
  const out = r.stdout + r.stderr
  expect(out).toMatch(/basis: .*depends_on/)
  expect(printedCommands(out).some((c) => c.startsWith('werk link card ') && c.includes('--type depends_on'))).toBe(true)
  expect(statusOf(p, 'card')).toBe('status: decided')
  expect(show(p, 'card')).toBe(before)
})

// Scenario: An amend that keeps every fact succeeds, and card text is not checked
test('64.5 an amend that keeps every fact succeeds', () => {
  const p = makeProject()
  fullDecided(p)
  const n = events(p).length
  const r = p.werk(['amend', 'card', '--summary', 'shorter body', '--body', 'Short.'])
  expect(r.code).toBe(0)
  expect(statusOf(p, 'card')).toBe('status: decided')
  expect(show(p, 'card')).toContain('Short.')
  const added = events(p).slice(n)
  const types = added.map((e) => e.type)
  expect(types).toContain('node.reopened')
  expect(added.some((e) => e.type === 'node.status_set' && e.payload.id === 'card' && e.payload.status === 'decided')).toBe(true)
  expect(types.indexOf('node.reopened')).toBeLessThan(types.lastIndexOf('node.status_set'))
})
