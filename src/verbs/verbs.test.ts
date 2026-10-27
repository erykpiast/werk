// The two behaviours of #werk-verb-registry and #werk-ticket-check-verb, run through the
// real command line.
import { describe, expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { cli, scratchDir } from '../test/harness.ts'
import { findVerb, loadVerbs, registeredVerbs, registerVerb } from '../verbs.ts'

const GOOD = `title: Do the thing
cites: card-a
blocked_by:
stories: 1
touches: merge queue

## What to build

The thing works from the user's side.

## Acceptance criteria

- [ ] A person can see the thing work

## Checks

- \`make test\`
`

function run(...args: string[]) {
  const dir = scratchDir('werk-verbs-')
  return { dir, ...cli(args.map((a) => a.replace('$DIR', dir)), { cwd: dir, log: join(dir, 'log.jsonl') }) }
}

describe('verb registry', () => {
  test('1. loading the verbs folder registers each verb, ticket and ticket-check among them', async () => {
    await loadVerbs()
    expect(findVerb('ticket')).toBeDefined()
    expect(findVerb('ticket-check')).toBeDefined()
    expect(registeredVerbs().map((v) => v.name)).toEqual(registeredVerbs().map((v) => v.name).sort())
  })

  test('2. a second registration of a name replaces the first', async () => {
    await loadVerbs()
    const original = findVerb('ticket')!
    registerVerb({ name: 'ticket', summary: 'x', run: () => [] })
    expect(findVerb('ticket')!.summary).toBe('x')
    registerVerb(original)
  })

  test('3. help prints the registered verbs', () => {
    const out = run('help')
    expect(out.stdout).toContain('werk ticket-check')
    expect(out.stdout).toContain('werk ticket list|move')
  })

  test('4. an unknown verb is refused', () => {
    const out = run('no-such-verb')
    expect(out.code).toBe(1)
    expect(out.stderr).toContain('unknown command "no-such-verb"')
  })
})

describe('ticket-check', () => {
  function folder(files: Record<string, string>) {
    const dir = scratchDir('werk-tcheck-')
    const tickets = join(dir, 'tickets')
    mkdirSync(tickets)
    for (const [name, text] of Object.entries(files)) writeFileSync(join(tickets, name), text)
    const check = (...args: string[]) => cli(['ticket-check', tickets, ...args], { cwd: dir, log: join(dir, 'log.jsonl') })
    return { dir, tickets, check }
  }

  test('1. a good folder passes', () => {
    const f = folder({ '01.md': GOOD })
    const r = f.check()
    expect(r.code).toBe(0)
    expect(r.stdout).toContain('all pass')
  })

  test('2. a bad ticket is named with its file and check', () => {
    const f = folder({ '01.md': GOOD, '02.md': GOOD.replace('## Acceptance criteria', '## Nope') })
    const r = f.check()
    expect(r.code).toBe(1)
    expect(r.stderr).toContain('02.md')
  })

  test('3. a card that no ticket cites fails the set check', () => {
    const f = folder({ '01.md': GOOD })
    const r = f.check('--cards', 'card-a,card-b')
    expect(r.code).toBe(1)
    expect(r.stderr).toContain('cards-cited')
    expect(r.stderr).toContain('card-b')
  })

  test('4. a spec story that no ticket delivers fails the set check', () => {
    const f = folder({ '01.md': GOOD })
    const spec = join(f.dir, 'spec.md')
    writeFileSync(spec, '## User Stories\n\n1. As a user, a\n2. As a user, b\n')
    const r = f.check('--spec', spec)
    expect(r.code).toBe(1)
    expect(r.stderr).toContain('stories')
    expect(r.stderr).toContain('2')
  })

  test('5. a missing folder is refused', () => {
    const r = run('ticket-check', '$DIR/nope')
    expect(r.code).toBe(1)
    expect(r.stderr).toContain('is not a folder')
  })
})
