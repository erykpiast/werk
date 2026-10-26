import { afterEach, expect, test } from 'bun:test'
import { project, type P } from './helpers.ts'

let p: P
afterEach(() => p?.cleanup())

/** The fixing commands a refusal prints: each indented line that starts with `werk `. */
const commandsOf = (out: string) => out.split('\n').filter((l) => /^ {4}werk /.test(l)).map((l) => l.trim())
const statusOnMap = (id: string) => p.graph().nodes.find((n) => n.id === id)?.status
const statusEvents = (id: string) => p.lines().map((l) => JSON.parse(l)).filter((e) => e.type === 'node.status_set' && e.payload.id === id)

/** An open card with a decider, a depends_on edge to a decided card, and a rejected option. */
function openWithAllButKill(id: string) {
  p.decided('base', { title: 'Base decision' })
  p.realCard(id, 'The card')
  p.ok(['status', id, 'open'])
  p.ok(['edit', id, '--who', 'you'])
  p.ok(['link', id, 'base', '--type', 'depends_on'])
  p.ok(['add', 'opt', '--kind', 'option', '--title', 'The other way', '--why-not', 'too slow'])
  p.ok(['link', 'opt', id, '--type', 'alternative_to'])
  p.ok(['accept', 'opt', '--actor', 'you'])
}

test('64.1', () => {
  p = project()
  openWithAllButKill('card')
  const before = statusEvents('card').length
  const r = p.refuses(['status', 'card', 'decided'])
  const out = r.stdout + r.stderr
  expect(out).toMatch(/kill/)
  const cmds = commandsOf(out)
  const killCmd = cmds.find((c) => c.startsWith('werk kill card'))
  expect(killCmd).toBeDefined()
  expect(statusOnMap('card')).toBe('open')
  expect(statusEvents('card').length).toBe(before)
  expect(p.sh(killCmd!).code).toBe(0)
  expect(p.werk(['status', 'card', 'decided']).code).toBe(0)
  expect(statusOnMap('card')).toBe('decided')
})

test('64.2', () => {
  p = project()
  p.decided('base', { title: 'Base decision' })
  p.realCard('card', 'The card', ['--body', 'Some body text'])
  p.ok(['status', 'card', 'open'])
  const r = p.refuses(['status', 'card', 'decided'])
  const out = r.stdout + r.stderr
  const problems: string[] = []
  if (!/\bwho\b|decide/.test(out)) problems.push('decider not named')
  if (!/depends_on|basis/.test(out)) problems.push('depends_on basis not named')
  if (!/option/.test(out)) problems.push('rejected option not named')
  if (!/kill/.test(out)) problems.push('kill criterion not named')
  const cmds = commandsOf(out)
  if (!cmds.some((c) => c.includes('--who'))) problems.push('no who command')
  if (!cmds.some((c) => c.includes('depends_on'))) problems.push('no depends_on command')
  if (!cmds.some((c) => c.includes('--kind option'))) problems.push('no option command')
  if (!cmds.some((c) => c.startsWith('werk kill'))) problems.push('no kill command')
  expect(statusOnMap('card')).toBe('open')
  // The agent runs each printed command, filling each <placeholder> the way an agent would.
  for (const c of cmds) {
    const filled = c.replace('<card-it-needs>', 'base').replace(/"<[^>]*>"/g, '"filled by the agent"')
    const res = p.sh(filled)
    if (res.code !== 0) problems.push(`printed command failed: ${filled}: ${res.stderr}`)
  }
  const again = p.werk(['status', 'card', 'decided'])
  if (again.code !== 0) problems.push(`second decide refused: ${again.stderr}`)
  if (statusOnMap('card') !== 'decided') problems.push('card not decided on the map')
  console.log('64.2 first refusal output:\n' + out)
  expect(problems).toEqual([])
})

test('64.3', () => {
  p = project()
  p.decided('base', { title: 'Base decision' })
  p.ok(['add', 'g1', '--title', 'Ghost one'])
  p.ok(['edit', 'g1', '--who', 'you'])
  p.ok(['link', 'g1', 'base', '--type', 'depends_on'])
  p.ok(['add', 'o1', '--kind', 'option', '--title', 'Other way', '--why-not', 'too slow'])
  p.ok(['link', 'o1', 'g1', '--type', 'alternative_to'])
  p.ok(['kill', 'g1', '--form', 'revisit'])

  p.ok(['add', 'g2', '--title', 'Ghost two'])
  p.ok(['edit', 'g2', '--who', 'you'])
  p.ok(['add', 'o2', '--kind', 'option', '--title', 'Other way 2', '--why-not', 'too slow'])
  p.ok(['link', 'o2', 'g2', '--type', 'alternative_to'])
  p.ok(['kill', 'g2', '--form', 'revisit'])

  expect(p.werk(['status', 'g1', 'decided']).code).toBe(0)
  expect(p.show('g1')).toContain('status: decided')
  const r = p.refuses(['status', 'g2', 'decided'])
  const out = r.stdout + r.stderr
  expect(out).toMatch(/depends_on|basis/)
  expect(commandsOf(out).some((c) => c.startsWith('werk link g2') && c.includes('depends_on'))).toBe(true)
  expect(p.show('g2')).not.toContain('status: decided')
})

/** A decided card with a decider, a depends_on edge, a rejected option and a kill criterion. */
function decidedFull() {
  p.decided('base', { title: 'Base decision' })
  p.realCard('card', 'The card', ['--body', 'A long body that explains the card in many words.'])
  p.ok(['edit', 'card', '--who', 'you'])
  p.ok(['link', 'card', 'base', '--type', 'depends_on'])
  p.ok(['add', 'opt', '--kind', 'option', '--title', 'The other way', '--why-not', 'too slow'])
  p.ok(['link', 'opt', 'card', '--type', 'alternative_to'])
  p.ok(['kill', 'card', '--form', 'revisit'])
  p.ok(['status', 'card', 'decided'])
}

test('64.4', () => {
  p = project()
  decidedFull()
  // No verb or flag removes a depends_on edge from a card (no unlink verb, no edit flag).
  const verbs = p.werk(['help']).stdout
  const verbNames = verbs.split('\n').filter((l) => /^  [a-z]/.test(l)).map((l) => l.trim().split(/\s+/)[0])
  const hasUnlink = verbNames.some((v) => v === 'unlink' || v === 'amend')
  const edit = p.werk(['edit', 'card', '--help'])
  console.log('64.4 help:\n' + verbs + '\nedit --help: ' + edit.stderr)
  expect(hasUnlink).toBe(true)
})

test('64.5', () => {
  p = project()
  decidedFull()
  const before = p.lines().length
  expect(p.werk(['edit', 'card', '--body', 'Short.']).code).toBe(0)
  const s = p.show('card')
  expect(s).toContain('status: decided')
  expect(s).toContain('Short.')
  const added = p.lines().slice(before).map((l) => JSON.parse(l))
  console.log('64.5 new events: ' + JSON.stringify(added.map((e) => e.type)))
  const types = added.map((e) => e.type)
  expect(types).toContain('node.reopened')
  expect(added.some((e) => e.type === 'node.status_set' && e.payload.status === 'decided')).toBe(true)
})
