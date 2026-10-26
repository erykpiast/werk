import { afterEach, expect, test } from 'bun:test'
import { logEvents, makeProject, ok, type TempProject } from './lib.ts'

let project: TempProject | undefined
afterEach(() => {
  project?.cleanup()
  project = undefined
})
const run = (...args: string[]) => {
  const r = project!.run(args)
  return { code: r.code, out: (r.stdout + r.stderr).trim() }
}
const card = (id: string) => JSON.parse(project!.run(['show', id]).stdout).card

/** Sets up a card with the facts the step names, using the most plausible command forms. Returns what each setup step did. */
function setup(id: string, facts: { decider?: boolean; basis?: boolean; options?: boolean; kill?: boolean }) {
  const seen: Record<string, string> = {}
  const add = ['add', id, '--title', `Card ${id}`, '--body', `Body of ${id}`]
  if (facts.decider) add.push('--who', 'you')
  if (facts.kill) add.push('--kill', 'Revisit if the log grows past 1 GB')
  let r = run(...add)
  seen.add = `${r.code}: ${r.out}`
  if (r.code !== 0) {
    r = run('add', id, '--title', `Card ${id}`, '--body', `Body of ${id}`)
    seen.addPlain = `${r.code}: ${r.out}`
  }
  if (facts.basis) {
    ok(project!, 'add', `${id}-base`, '--title', `Base of ${id}`)
    seen.basis = run('link', id, `${id}-base`, '--type', 'depends_on', '--why', 'needs it').out
  }
  if (facts.options) {
    ok(project!, 'add', `${id}:opt0`, '--kind', 'option', '--title', `Other ${id}`, '--why-not', 'too slow')
    seen.options = run('link', `${id}:opt0`, id, '--type', 'alternative_to').out
  }
  return seen
}

test('03.1 a card with no kill criteria cannot become decided, and the printed command fixes it', () => {
  project = makeProject()
  const seen = setup('x', { decider: true, basis: true, options: true })
  const before = logEvents(project.dir).length
  const decide = run('status', 'x', 'decided')
  const after = logEvents(project.dir).length
  console.log(JSON.stringify({ seen, decide, statusAfter: card('x').status, newEvents: after - before }, null, 1))
  expect(seen.add).toMatch(/^0:/) // a decider can be recorded
  expect(decide.code).not.toBe(0)
  expect(decide.out).toMatch(/kill/i)
  expect(card('x').status).toBe('open')
  expect(after).toBe(before)
})

test('03.2 each missing fact prints its own fixing command', () => {
  project = makeProject()
  const all = { decider: true, basis: true, options: true, kill: true }
  const seen = {
    c1: setup('c1', { ...all, decider: false }),
    c2: setup('c2', { ...all, basis: false }),
    c3: setup('c3', { ...all, options: false }),
    c4: setup('c4', { ...all, kill: false }),
  }
  const results = ['c1', 'c2', 'c3', 'c4'].map((id) => {
    const before = logEvents(project!.dir).length
    const r = run('status', id, 'decided')
    return { id, ...r, appended: logEvents(project!.dir).length - before }
  })
  console.log(JSON.stringify({ seen, results }, null, 1))
  for (const r of results) {
    expect(r.code).not.toBe(0)
    expect(r.appended).toBe(0)
  }
  expect(new Set(results.map((r) => r.out)).size).toBe(4)
})

test('03.3 a stated lack of basis and an unchallenged flag satisfy the check', () => {
  project = makeProject()
  const seen = setup('x', { decider: true, kill: true })
  // Plausible forms for "no basis, with a reason" and "unchallenged".
  const tries = {
    noBasis: [run('basis', 'x', 'none', '--why', 'first card in the project'), run('edit', 'x', '--no-basis', 'first card in the project')],
    unchallenged: [run('unchallenged', 'x'), run('edit', 'x', '--unchallenged', 'true')],
  }
  const decide = run('status', 'x', 'decided')
  const shown = project.run(['show', 'x']).stdout
  console.log(JSON.stringify({ seen, tries, decide }, null, 1))
  expect(tries.noBasis.some((r) => r.code === 0)).toBe(true)
  expect(tries.unchallenged.some((r) => r.code === 0)).toBe(true)
  expect(decide.code).toBe(0)
  expect(card('x').status).toBe('decided')
  expect(shown).toContain('first card in the project')
  expect(shown).toMatch(/unchallenged/i)
})

test('03.4 an amend of a decided card cannot remove a required fact', () => {
  project = makeProject()
  const seen = setup('x', { decider: true, basis: true, options: true, kill: true })
  seen.decide = JSON.stringify(run('status', 'x', 'decided'))
  const before = logEvents(project.dir).length
  const tries = [run('edit', 'x', '--kill', ''), run('amend', 'x', '--kill', '')]
  const removed = logEvents(project.dir).length - before
  const shown = project.run(['show', 'x']).stdout
  const body = run('edit', 'x', '--body', 'A new body that keeps every fact')
  console.log(JSON.stringify({ seen, tries, removed, body, cardAfter: card('x') }, null, 1))
  expect(seen.add).toMatch(/^0:/) // kill criteria and decider can be recorded
  expect(tries.some((r) => r.code !== 0 && /--kill|kill/.test(r.out) && !/unknown (option|command)/.test(r.out))).toBe(true)
  expect(removed).toBe(0)
  expect(shown).toMatch(/1 GB/)
  expect(card('x').status).toBe('decided')
  expect(body.code).toBe(0)
  expect(card('x').body).toBe('A new body that keeps every fact')
})

test('03.5 adding a card and setting it open are not checked, but decided is', () => {
  project = makeProject()
  const add = run('add', 'c', '--title', 'A bare card', '--body', 'Only a title and a body')
  expect(add.code).toBe(0)
  const root = JSON.parse(project.run(['show']).stdout)
  expect(root.children.map((c: any) => c.id)).toContain('c')
  const open = run('status', 'c', 'open', '--why', 'still open')
  const statusAfterOpen = card('c').status
  const decide = run('status', 'c', 'decided')
  console.log(JSON.stringify({ add, open, statusAfterOpen, decide, statusAfterDecide: card('c').status }, null, 1))
  expect(open.code).toBe(0)
  expect(statusAfterOpen).toBe('open')
  expect(decide.code).not.toBe(0)
  expect(card('c').status).toBe('open')
})
