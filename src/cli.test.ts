// cli.ts behaviours from #werk-test-behaviours-cli. Each runs the real command line as its
// own process against a scratch log, and reads the log back to see what it recorded.
import { describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fold } from './fold.ts'
import { appendMany, readEvents } from './log.ts'
import { cli, launches, scratchDir } from './test/harness.ts'

/** A scratch repository: its own .werk/log.jsonl, its own fake-claude log. */
function repo() {
  const dir = scratchDir('werk-cli-')
  const log = join(dir, '.werk', 'log.jsonl')
  const fake = join(dir, 'fake.jsonl')
  const run = (...args: string[]) => cli(args, { cwd: dir, log, env: { FAKE_CLAUDE_LOG: fake } })
  /** Propose and accept a card, the way Eryk's ✓ would. */
  const card = (id: string, ...flags: string[]) => {
    expect(run('add', id, '--title', id, ...flags).code).toBe(0)
    expect(run('accept', id, '--actor', 'you').code).toBe(0)
    // A quote needs a session for its pointer — #werk-excerpt-event-shape.
    if (!existsSync(join(dir, '.werk', 'session'))) writeFileSync(join(dir, '.werk', 'session'), 'sess-t\n')
  }
  /** Decide a card that needs no basis, so a reopen has something to reopen (#vi-prop-reopen-scope). */
  const decide = (id: string) => {
    expect(run('edit', id, '--who', 'me', '--no-basis', 'a test card has no basis').code).toBe(0)
    expect(run('kill', id, '--form', 'revisit').code).toBe(0)
    expect(run('status', id, 'decided').code).toBe(0)
  }
  return { dir, log, fake, run, card, decide, events: () => readEvents(log), graph: () => fold(readEvents(log)) }
}

describe('cli.ts', () => {
  test('1. add refuses an id that already exists, as a ghost or as a card', () => {
    const r = repo()
    expect(r.run('add', 'a', '--title', 'first').code).toBe(0)
    const again = r.run('add', 'a', '--title', 'second')
    expect(again.code).toBe(1)
    expect(again.stderr).toContain('"a" is already proposed and a ghost is frozen')
    r.run('accept', 'a', '--actor', 'you')
    const real = r.run('add', 'a', '--title', 'third')
    expect(real.code).toBe(1)
    expect(real.stderr).toContain('"a" already exists')
    expect(r.events().filter((e) => e.type === 'node.proposed')).toHaveLength(1)
    expect(r.graph().nodes.get('a')!.title).toBe('first')
  })

  test('1b. add --parent writes one event, and a missing parent records nothing', () => {
    const r = repo()
    r.card('root')
    const before = r.events().length
    expect(r.run('add', 'kid', '--title', 'K', '--parent', 'root').code).toBe(0)
    const written = r.events().slice(before)
    expect(written.map((e) => e.type)).toEqual(['node.proposed'])
    expect(written[0].payload.parent).toBe('root')
    expect(r.graph().ghostEdges).toContainEqual({ from: 'kid', to: 'root', type: 'refines' })

    const n = r.events().length
    expect(r.run('add', 'orphan', '--title', 'O', '--parent', 'typo').code).toBe(1)
    expect(r.events()).toHaveLength(n)
  })

  test('2. add --status decided is refused outright, and records nothing', () => {
    const r = repo()
    const out = r.run('add', 'a', '--title', 'A', '--status', 'decided', '--who', 'me', '--no-basis')
    expect(out.code).toBe(1)
    expect(out.stderr).toContain('add cannot set --status decided directly')
    expect(out.stderr).toContain('werk status a decided')
    expect(r.events()).toEqual([])
  })

  test('3. status decided checks who, a basis, and an option for who:you — and names each fix', () => {
    const r = repo()
    r.card('base')
    r.run('add', 'nowho', '--title', 'x')
    const noWho = r.run('status', 'nowho', 'decided')
    expect(noWho.code).toBe(1)
    expect(noWho.stderr).toContain('who is not set')
    expect(noWho.stderr).toContain('werk edit nowho --who you|me|prototype')
    expect(noWho.stderr).toContain('werk link nowho <parent-id> --type depends_on')

    r.run('add', 'mine', '--title', 'x', '--who', 'me')
    expect(r.run('status', 'mine', 'decided').stderr).toContain('no depends_on edge, and --no-basis is not on record')
    r.run('link', 'mine', 'base', '--type', 'depends_on', '--why', 'test')
    r.run('kill', 'mine', '--form', 'revisit')
    expect(r.run('status', 'mine', 'decided').code).toBe(0)

    r.run('add', 'yours', '--title', 'x', '--who', 'you', '--no-basis')
    const noOption = r.run('status', 'yours', 'decided')
    expect(noOption.code).toBe(1)
    expect(noOption.stderr).toContain('no alternative_to option is linked, and --unchallenged is not on record')
    expect(noOption.stderr).toContain('werk add yours:opt0 --kind option')
    r.run('add', 'yours:opt0', '--kind', 'option', '--title', 'other', '--why_not', 'slower')
    r.run('link', 'yours:opt0', 'yours', '--type', 'alternative_to')
    r.run('kill', 'yours', '--form', 'revisit')
    expect(r.run('status', 'yours', 'decided').code).toBe(0)

    r.run('add', 'stamp', '--title', 'x', '--who', 'you', '--no-basis', '--unchallenged')
    r.run('kill', 'stamp', '--form', 'revisit')
    expect(r.run('status', 'stamp', 'decided').code).toBe(0)

    const decided = r.events().filter((e) => e.type === 'status.set').map((e) => e.payload.id)
    expect(decided).toEqual(['mine', 'yours', 'stamp'])
  })

  test('3b. status decided without a kill criterion fails with the prompt, drafted from the options', () => {
    const r = repo()
    r.card('base')
    r.run('add', 'c', '--title', 'c', '--who', 'you', '--no-basis', '--unchallenged')
    r.run('add', 'c:opt0', '--kind', 'option', '--title', 'the other way', '--why_not', 'slower')
    r.run('link', 'c:opt0', 'c', '--type', 'alternative_to')
    const out = r.run('status', 'c', 'decided')
    expect(out.code).toBe(1)
    expect(out.stderr).toContain('no kill criterion is on record')
    expect(out.stderr).toContain('what must become true to change this decision')
    expect(out.stderr).toContain('werk kill c --form metric')
    expect(out.stderr).toContain('--fallback c:opt0')
    expect(r.events().filter((e) => e.type === 'status.set')).toEqual([])
    // "revisit at any time" is an answer. Only a missing answer fails.
    expect(r.run('kill', 'c', '--form', 'revisit').code).toBe(0)
    expect(r.run('status', 'c', 'decided').code).toBe(0)
  })

  test('3c. kill checks its parts, the fallback, and keeps state in the fold', () => {
    const r = repo()
    r.card('k')
    const noParts = r.run('kill', 'k', '--form', 'metric', '--source', 'posthog')
    expect(noParts.code).toBe(1)
    expect(noParts.stderr).toContain('--form metric also needs --metric --threshold --window')
    expect(r.run('kill', 'k', '--form', 'no-metric', '--reason', 'slow', '--text', 'trust').stderr).toContain('--review-date')
    expect(r.run('kill', 'k', '--form', 'revisit', '--fallback', 'nope').stderr).toContain('is not an option of "k"')
    expect(r.events().filter((e) => e.type === 'kill.added')).toEqual([])

    r.run('add', 'k:opt0', '--kind', 'option', '--title', 'o', '--why_not', 'w')
    r.run('link', 'k:opt0', 'k', '--type', 'alternative_to')
    const ok = r.run('kill', 'k', '--form', 'metric', '--source', 'PostHog', '--metric', 'install time', '--threshold', '> 4 min', '--window', '7d', '--min-sample', '100', '--fallback', 'k:opt0')
    expect(ok.code).toBe(0)
    r.run('kill', 'k', '--form', 'no-metric', '--reason', 'slow', '--text', 'trust is slow', '--review-date', '2026-12-01')
    r.run('kill-state', 'k', '1', 'fired', '--detail', 'median 5.2 min')
    const kill = r.graph().nodes.get('k')!.kill!
    expect(kill.map((c) => [c.form, c.trigger, c.state])).toEqual([['metric', 'metric', 'fired'], ['no-metric', 'date', 'monitored']])
    expect(kill[0]).toMatchObject({ minSample: 100, fallback: 'k:opt0', detail: 'median 5.2 min' })
    r.run('kill', 'k', '--clear')
    expect(r.graph().nodes.get('k')!.kill).toBeUndefined()
  })

  test('4. link and unlink fail when either end does not exist', () => {
    const r = repo()
    r.card('a')
    for (const verb of ['link', 'unlink']) {
      for (const [from, to] of [
        ['a', 'missing'],
        ['missing', 'a'],
      ]) {
        const out = r.run(verb, from, to, '--type', 'depends_on', '--why', 'test')
        expect(out.code).toBe(1)
        expect(out.stderr).toContain('no node with the id "missing"')
      }
    }
    expect(r.events().some((e) => e.type === 'edge.added' || e.type === 'edge.removed')).toBe(false)
  })

  test('5. reopen --reason postponed pauses the closure; any other reason makes it stale', () => {
    const chain = () => {
      const r = repo()
      r.card('a')
      r.decide('a')
      r.card('b')
      r.card('c')
      r.run('link', 'b', 'a', '--type', 'depends_on', '--why', 'test')
      r.run('link', 'c', 'b', '--type', 'depends_on', '--why', 'test')
      return r
    }
    const p = chain()
    expect(p.run('reopen', 'a', '--reason', 'postponed').stdout).toContain('2 card(s) went postponed, not stale')
    expect([[...p.graph().postponed].sort(), [...p.graph().stale]]).toEqual([['b', 'c'], []])

    for (const reason of [undefined, 'invalidated', 'rejected']) {
      const s = chain()
      const out = s.run('reopen', 'a', ...(reason ? ['--reason', reason] : []))
      // A stale mark goes one hop only (#vi-prop).
      expect(out.stdout).toContain('1 card(s) went stale')
      expect([[...s.graph().stale], [...s.graph().postponed]]).toEqual([['b'], []])
    }

    // A card flagged earlier by another reopen is not in this reopen's list.
    const two = chain()
    two.card('d')
    two.decide('d')
    two.run('reopen', 'a', '--reason', 'postponed')
    const out = two.run('reopen', 'd', '--reason', 'postponed').stdout
    expect(out).toContain('0 card(s) went postponed, not stale')
    expect(out).not.toContain('  b')

    const bad = chain().run('reopen', 'a', '--reason', 'later')
    expect(bad.code).toBe(1)
    expect(bad.stderr).toContain('--reason must be postponed, invalidated, or rejected')
  }, 30000) // about 35 CLI processes: 7s alone, over the 5s default

  test('5b. a depends_on link needs --why; linking again sets it; the stale trace shows it per hop', () => {
    const r = repo()
    r.card('a')
    r.decide('a')
    r.card('b')
    r.card('c')
    const bare = r.run('link', 'b', 'a', '--type', 'depends_on')
    expect(bare.code).toBe(2)
    expect(bare.stderr).toContain('a depends_on link needs --why')
    expect(r.run('link', 'b', 'a', '--type', 'refines', '--why', 'x').stderr).toContain('--why is only for depends_on')
    expect(r.events().some((e) => e.type === 'edge.added')).toBe(false)

    r.run('link', 'b', 'a', '--type', 'depends_on', '--why', 'first')
    r.run('link', 'b', 'a', '--type', 'depends_on', '--why', 'b uses a')
    r.run('link', 'c', 'b', '--type', 'depends_on', '--why', 'c uses b')
    const deps = r.graph().edges.filter((e) => e.type === 'depends_on')
    expect(deps).toEqual([
      { from: 'b', to: 'a', type: 'depends_on', why: 'b uses a' },
      { from: 'c', to: 'b', type: 'depends_on', why: 'c uses b' },
    ])

    // A pause goes every distance, so it gives a trace of more than one hop.
    r.run('reopen', 'a', '--reason', 'postponed')
    expect(r.graph().flagWhy.get('c')![0]).toMatchObject({ via: ['b', 'a'], whys: ['c uses b', 'b uses a'] })
    const show = r.run('show', 'c').stdout
    expect(show).toContain('c -> b: c uses b')
    expect(show).toContain('b -> a: b uses a')
  })

  test('5c. a depends_on link to an ancestor or a descendant fails; a move removes one it creates', () => {
    const r = repo()
    r.card('p')
    r.card('k', '--parent', 'p')
    r.card('x')
    for (const [from, to] of [
      ['k', 'p'],
      ['p', 'k'],
    ]) {
      const out = r.run('link', from, to, '--type', 'depends_on', '--why', 'test')
      expect(out.code).toBe(1)
      expect(out.stderr).toContain('#vi-prop-nolineage')
    }
    expect(r.graph().edges.some((e) => e.type === 'depends_on')).toBe(false)

    r.run('link', 'k', 'x', '--type', 'depends_on', '--why', 'k uses x')
    const moved = r.run('move', 'k', '--parent', 'x')
    expect(moved.stdout).toContain('removed k --depends_on--> x')
    expect(r.graph().edges.some((e) => e.type === 'depends_on')).toBe(false)
  })

  test('6. quote records an excerpt only for an exact, single match', () => {
    const r = repo()
    r.card('c')
    mkdirSync(join(r.dir, '.werk'), { recursive: true })
    writeFileSync(join(r.dir, '.werk', 'session'), 'sess-q\n')
    const chat = [
      { at: 't1', from: 'you', text: 'we keep the log append-only' },
      { at: 't2', from: 'agent', text: 'agreed: the map is derived' },
      { at: 't3', from: 'you', text: 'the map is derived, always' },
    ]
    writeFileSync(join(r.dir, '.werk', 'chat.jsonl'), chat.map((m) => JSON.stringify(m)).join('\n') + '\n')

    const none = r.run('quote', 'c', 'main', '--text', 'we keep the log append only')
    expect(none.code).toBe(1)
    expect(none.stderr).toContain('does not appear verbatim')
    const two = r.run('quote', 'c', 'main', '--text', 'the map is derived')
    expect(two.code).toBe(1)
    expect(two.stderr).toContain('appears in 2 messages')
    expect(r.graph().nodes.size).toBe(1)

    const one = r.run('quote', 'c', 'main', '--text', 'log append-only')
    expect(one.code).toBe(0)
    const ex = r.graph().nodes.get('c:ex0')!
    expect([ex.kind, ex.msgIndex, ex.span, ex.speaker, ex.session]).toEqual(['excerpt', 0, [12, 27], 'you', 'sess-q'])
    expect([ex.conversation, ex.saidAt]).toEqual(['main', 't1'])
    // The excerpt and its link are one event — #werk-excerpt-event.
    const last = r.events().at(-1)!
    expect([last.type, last.payload.citedBy]).toEqual(['node.proposed', 'c'])
    expect(r.graph().ghostEdges).toContainEqual({ from: 'c', to: 'c:ex0', type: 'supported_by' })
  })

  test('6a. a quote refuses before it writes when the pointer would lack a part', () => {
    const r = repo()
    r.card('c')
    rmSync(join(r.dir, '.werk', 'session'), { force: true })
    writeFileSync(join(r.dir, '.werk', 'chat.jsonl'), JSON.stringify({ at: 't1', from: 'you', text: 'seats are the unit we bill' }) + '\n')
    const before = r.events().length
    const q = r.run('quote', 'c', 'main', '--text', 'seats are the unit we bill')
    expect(q.code).toBe(1)
    expect(q.stderr).toContain('has no session')
    expect(r.events().length).toBe(before)
  })

  test('6b. an excerpt is never added by hand, and its words never change, before or after the accept', () => {
    const r = repo()
    r.card('c')
    writeFileSync(join(r.dir, '.werk', 'chat.jsonl'), JSON.stringify({ at: 't1', from: 'you', text: 'seats are the unit we bill' }) + '\n')
    const byHand = r.run('add', 'c:ex1', '--kind', 'excerpt', '--title', 'made up')
    expect(byHand.code).toBe(1)
    expect(byHand.stderr).toContain('cannot be added by hand')
    expect(r.run('quote', 'c', 'main', '--text', 'seats are the unit we bill').code).toBe(0)
    expect(r.run('retitle', 'c:ex0', 'we bill per seat').stderr).toContain('is an excerpt')
    r.run('accept', 'c:ex0', '--actor', 'you')
    expect(r.graph().edges).toContainEqual({ from: 'c', to: 'c:ex0', type: 'supported_by' })
    expect(r.run('edit', 'c:ex0', '--text', 'other').stderr).toContain('is an excerpt')
    expect(r.run('retitle', 'c:ex0', 'other').code).toBe(1)
    expect(r.run('say', 'c:ex0', 'a note is fine').code).toBe(0)
    expect(r.graph().nodes.get('c:ex0')!.text).toBe('seats are the unit we bill')
    // A repeat inside one message is refused too — #werk-excerpt-once.
    writeFileSync(join(r.dir, '.werk', 'chat.jsonl'), JSON.stringify({ at: 't1', from: 'you', text: 'the grid wins, and the grid is faster' }) + '\n')
    expect(r.run('quote', 'c', 'main', '--text', 'the grid').stderr).toContain('appears 2 times in one message')
  })

  test('6c. a real card never sits under a ghost, and no card sits under one below it', () => {
    const r = repo()
    r.card('root')
    r.card('x', '--parent', 'root')
    r.card('y', '--parent', 'x')
    r.run('add', 'g', '--title', 'G', '--parent', 'x')
    const n = r.events().length
    const underGhost = r.run('move', 'y', '--parent', 'g')
    expect(underGhost.code).toBe(1)
    expect(underGhost.stderr).toContain('"g" is only proposed')
    expect(r.run('link', 'y', 'g', '--type', 'refines').code).toBe(1)
    const loop = r.run('move', 'x', '--parent', 'y')
    expect(loop.code).toBe(1)
    expect(loop.stderr).toContain('closes a loop')
    expect(r.events()).toHaveLength(n)
    expect(r.run('add', 'g2', '--title', 'G2', '--parent', 'g').code).toBe(0)
    r.run('accept', 'g', '--actor', 'you')
    expect(r.run('move', 'y', '--parent', 'g').code).toBe(0)
    expect(r.run('move', 'y', '--parent', 'x').code).toBe(0)
  })

  test('6d. show prints the words of the options, excerpts and sources', () => {
    const r = repo()
    r.card('price')
    r.run('add', 'price:opt0', '--kind', 'option', '--title', 'We charge per project', '--why_not', 'Projects vary in size too much')
    r.run('link', 'price:opt0', 'price', '--type', 'alternative_to')
    r.run('add', 'src-survey', '--kind', 'source', '--title', 'Buyer survey', '--finding', '8 of 10 buyers budget per seat')
    r.run('link', 'price', 'src-survey', '--type', 'supported_by')
    writeFileSync(join(r.dir, '.werk', 'chat.jsonl'), JSON.stringify({ at: 't1', from: 'you', text: 'Seats are what the buyer counts' }) + '\n')
    r.run('quote', 'price', 'main', '--text', 'Seats are what the buyer counts')
    const out = r.run('show', 'price').stdout
    expect(out).toContain('Options\n  price:opt0  We charge per project  proposed\n    why not: Projects vary in size too much')
    expect(out).toContain('Say\n  price:ex0  you: "Seats are what the buyer counts"  proposed')
    expect(out).toContain('Ev\n  src-survey  Buyer survey  proposed\n    finding: 8 of 10 buyers budget per seat')
    expect(r.run('show', 'src-survey').stdout).not.toContain('Options')
  })

  test('6e. an id stays taken while its card is removed, for add and for quote', () => {
    const r = repo()
    r.card('c')
    writeFileSync(join(r.dir, '.werk', 'chat.jsonl'), JSON.stringify({ at: 't1', from: 'you', text: 'one two three four' }) + '\n')
    r.run('quote', 'c', 'main', '--text', 'one two')
    r.run('accept', 'c:ex0', '--actor', 'you')
    r.run('remove', 'c:ex0', '--actor', 'you')
    const again = r.run('add', 'c:ex0', '--title', 'x')
    expect(again.stderr).toContain('werk restore c:ex0')
    expect(r.run('quote', 'c', 'main', '--text', 'three four').code).toBe(0)
    expect(r.graph().nodes.get('c:ex1')!.text).toBe('three four')
    expect(r.run('quote', 'c', 'main', '--text', 'two three', '--id', 'c:ex0').stderr).toContain('already taken')
  })

  test('7. prototype refuses a fork with fewer than two options', () => {
    const r = repo()
    const file = join(r.dir, 'fork.json')
    writeFileSync(file, JSON.stringify({ field: 'layout', options: [{ label: 'grid', brief: 'build a grid' }] }))
    const out = r.run('prototype', '--fork-file', file)
    expect(out.code).toBe(1)
    expect(out.stderr).toContain('needs at least two options')

    r.card('q')
    r.run('add', 'q:opt0', '--kind', 'option', '--title', 'only one')
    r.run('link', 'q:opt0', 'q', '--type', 'alternative_to')
    expect(r.run('prototype', '--fork', 'q').stderr).toContain('#q needs at least two options')
    expect(launches(r.fake)).toEqual([])
  })

  test('9. rederive --status decided runs the same contract check as status', () => {
    const r = repo()
    r.card('a')
    const bare = r.run('rederive', 'a', '--status', 'decided')
    expect(bare.code).toBe(1)
    expect(bare.stderr).toContain('"a" cannot become decided')
    expect(r.events().some((e) => e.type === 'rederived')).toBe(false)

    r.run('edit', 'a', '--who', 'me', '--no-basis', 'a root')
    r.run('kill', 'a', '--form', 'manual', '--text', 'I try it')
    expect(r.run('rederive', 'a', '--status', 'decided').code).toBe(0)
    expect(r.graph().nodes.get('a')!.status).toBe('decided')
    // Without --status, rederive only clears staleness, so no check runs.
    r.card('b')
    expect(r.run('rederive', 'b').code).toBe(0)
  })

  test('9b. a confirm of a stale card lists every older link it read (#vi-prop-confirm-names)', () => {
    const r = repo()
    for (const id of ['b', 'd', 'c']) r.card(id)
    r.decide('b')
    r.decide('d')
    r.run('link', 'c', 'b', '--type', 'depends_on', '--why', 'c needs the seat count of b')
    r.run('link', 'c', 'd', '--type', 'depends_on', '--why', 'c needs the currency of d')
    expect(r.run('reopen', 'b').code).toBe(0)
    expect(r.graph().stale.has('c')).toBe(true)

    // No list at all, a short list, and an unknown target are each refused and write nothing.
    const none = r.run('rederive', 'c')
    expect(none.code).toBe(1)
    const short = r.run('rederive', 'c', '--confirm', 'b')
    expect(short.code).toBe(1)
    expect(short.stderr).toContain('c -> d: c needs the currency of d')
    expect(short.stderr).toContain('werk rederive c --confirm b,d')
    const unknown = r.run('rederive', 'c', '--confirm', 'b,d,zzz')
    expect(unknown.code).toBe(1)
    expect(unknown.stderr).toContain('has no depends_on link to "zzz"')
    expect(r.events().some((e) => e.type === 'rederived')).toBe(false)

    expect(r.run('rederive', 'c', '--confirm', 'b,d').code).toBe(0)
    expect(r.graph().stale.has('c')).toBe(false)
  })

  test('9c. a link made after the change needs no entry, and an unmarked card writes nothing', () => {
    const r = repo()
    for (const id of ['b', 'd', 'c']) r.card(id)
    r.decide('b')
    r.decide('d')
    r.run('link', 'c', 'b', '--type', 'depends_on', '--why', 'c needs b')
    r.run('reopen', 'b')
    r.run('link', 'c', 'd', '--type', 'depends_on', '--why', 'c needs d')
    expect(r.run('rederive', 'c', '--confirm', 'b').code).toBe(0)
    expect(r.graph().stale.has('c')).toBe(false)

    const before = r.events().length
    const calm = r.run('rederive', 'd')
    expect(calm.code).toBe(0)
    expect(calm.stdout).toContain('has no stale mark')
    expect(r.events()).toHaveLength(before)
  })

  test('10. propose on a ghost is refused: a ghost is frozen', () => {
    const r = repo()
    r.run('add', 'a', '--title', 'first')
    const out = r.run('propose', 'a', '--title', 'second')
    expect(out.code).toBe(1)
    expect(out.stderr).toContain('"a" is proposed and not accepted yet')
    expect(r.events().some((e) => e.type === 'change.proposed')).toBe(false)
  })

  test('11. an agent remove is a proposal; only the accept takes the card out', () => {
    const r = repo()
    r.card('p')
    r.card('k', '--parent', 'p')
    const out = r.run('remove', 'p')
    expect(out.code).toBe(0)
    expect(out.stdout).toContain('removal proposed')
    expect(r.events().some((e) => e.type === 'node.removed')).toBe(false)
    expect(r.graph().nodes.get('p')!.pending?.remove).toBe(true)

    expect(r.run('accept', 'p').code).toBe(1)
    expect(r.run('accept', 'p', '--actor', 'you').code).toBe(0)
    const g = r.graph()
    expect(g.nodes.has('p')).toBe(false)
    expect(g.nodes.has('k')).toBe(false)

    // Eryk's own remove still acts at once.
    r.card('q')
    expect(r.run('remove', 'q', '--actor', 'you').code).toBe(0)
    expect(r.graph().nodes.has('q')).toBe(false)
  })

  test('13. an option links to its card with alternative_to only: no parent, no refines, no depends_on', () => {
    const r = repo()
    r.card('c')
    expect(r.run('add', 'c:opt0', '--kind', 'option', '--title', 'O', '--parent', 'c').code).toBe(1)
    expect(r.run('add', 'c:opt0', '--kind', 'option', '--title', 'O', '--why_not', 'n').code).toBe(0)
    const before = r.events().length
    expect(r.run('link', 'c:opt0', 'c', '--type', 'refines').stderr).toContain('alternative_to only')
    expect(r.run('link', 'c:opt0', 'c', '--type', 'depends_on', '--why', 'x').code).toBe(1)
    expect(r.run('move', 'c:opt0', '--parent', 'c').code).toBe(1)
    expect(r.events()).toHaveLength(before)
    expect(r.run('link', 'c:opt0', 'c', '--type', 'alternative_to').code).toBe(0)
  })

  test('12. an argument that names a card takes "#id" as "id"; text keeps its #', () => {
    const r = repo()
    r.card('root')
    expect(r.run('add', '#kid', '--title', 'K', '--why', 'see #root', '--parent', '#root').code).toBe(0)
    expect(r.run('accept', '#kid', '--actor', 'you').code).toBe(0)
    const g = r.graph()
    expect(g.nodes.has('#kid')).toBe(false)
    expect(g.nodes.get('kid')!.why).toBe('see #root')
    expect(g.edges).toContainEqual({ from: 'kid', to: 'root', type: 'refines' })
    expect(r.run('show', '#kid').stdout).toContain('card kid')
    expect(r.run('say', '#kid', '#root is the parent').code).toBe(0)
    expect(r.events().find((e) => e.type === 'note.added')!.payload).toMatchObject({ node: 'kid', text: '#root is the parent' })
  })

  test('8. sample and prototype clamp n and timeout to their caps', () => {
    const r = repo()
    const brief = join(r.dir, 'brief.md')
    writeFileSync(brief, 'name the behaviours')
    const s = r.run('sample', '--brief-file', brief, '--n', '99', '--timeout', '99999')
    expect(s.stderr).toContain('--n 99 capped to 5')
    expect(s.stderr).toContain('--timeout 99999 capped to 900s')
    expect(s.stderr).toContain('running 5 plan sample(s)')
    expect(s.stderr).toContain('up to 900s each')
    // One launch per sample. findForks' own call, if any, carries --tools instead.
    expect(launches(r.fake).filter((a) => a.includes('--allowedTools'))).toHaveLength(5)

    const file = join(r.dir, 'fork.json')
    writeFileSync(file, JSON.stringify({ field: 'f', options: [{ label: 'a', brief: 'x' }, { label: 'b', brief: 'y' }] }))
    const p = r.run('prototype', '--fork-file', file, '--timeout', '5000')
    expect(p.stderr).toContain('--timeout 5000 capped to 900s')
    expect(p.stderr).toContain('up to 900s each')
  }, 20000)

  test('14. followed closes an open obligation once, and a refused call writes nothing', () => {
    const r = repo()
    r.card('rule', '--who', 'me', '--no-basis')
    r.run('kill', 'rule', '--form', 'revisit')
    expect(r.run('status', 'rule', 'decided').code).toBe(0)
    r.run('add', 'draft', '--title', 'draft')
    appendMany(
      [
        { type: 'obligation.created', payload: { id: 'build-7', ticket: 't/1', cites: ['rule'] } },
        { type: 'obligation.created', payload: { id: 'build-8', ticket: 't/2', cites: [] } },
      ],
      r.log,
    )
    const count = () => r.events().length

    const ok = r.run('followed', 'build-7', '--cards', '#rule')
    expect(ok.code).toBe(0)
    expect(ok.stdout).toContain('build-7 closed: no new decision, follows #rule')
    expect(r.graph().obligations.get('build-7')!.followed).toEqual(['rule'])

    const before = count()
    const refusals: Array<[string[], string]> = [
      [['followed', 'build-7', '--cards', 'rule'], 'build-7 is already closed by a record'],
      [['followed', 'build-8', '--cards', 'draft'], 'draft is not a decided card'],
      [['followed', 'build-8', '--cards', 'rule,nope'], 'nope is not a decided card'],
      [['followed', 'build-8'], '--cards is required'],
      [['followed', 'build-9', '--cards', 'rule'], 'no obligation "build-9"'],
    ]
    for (const [args, message] of refusals) {
      const out = r.run(...args)
      expect(out.code).toBe(1)
      expect(out.stderr).toContain(message)
    }
    expect(count()).toBe(before)

    r.run('add', 'answer', '--title', 'answer', '--obligation', 'build-8')
    expect(r.run('followed', 'build-8', '--cards', 'rule').stderr).toContain('build-8 is already closed by a card: #answer')
  })
})

describe('#werk-hmr-entry-settles: a registered verb runs from a callback', () => {
  test('its lines print, an unknown verb exits 1, and a verb that throws exits 1 with its message', () => {
    const r = repo()
    r.card('rule', '--no-basis')
    const ok = r.run('search', 'rule')
    expect(ok.code).toBe(0)
    expect(ok.stdout).toContain('rule')
    const unknown = r.run('no-such-verb')
    expect(unknown.code).toBe(1)
    expect(unknown.stderr).toContain('unknown command "no-such-verb"')
    const thrown = r.run('search', '--status', 'bogus')
    expect(thrown.code).toBe(1)
    expect(thrown.stderr).toContain('--status must be one of')
  })
})

describe('#werk-contract-amend-scope: a change to a decided card cannot leave it missing a fact', () => {
  /** A decided card: accepted, one kill criterion, then the decide. */
  function decided(r: ReturnType<typeof repo>, id: string, ...flags: string[]) {
    r.card(id, '--no-basis', ...flags)
    expect(r.run('kill', id, '--form', 'no-metric', '--text', 'no metric applies', '--reason', 'cheap').code).toBe(0)
    expect(r.run('status', id, 'decided').code).toBe(0)
  }

  test('changing who to you is refused while no option or waiver backs it, and goes through after one', () => {
    const r = repo()
    decided(r, 'q', '--who', 'me')
    // An edit is refused: a change to who decides is an amend, so a proposal.
    const direct = r.run('edit', 'q', '--who', 'you')
    expect(direct.code).toBe(1)
    expect(direct.stderr).toContain('is an amend')
    expect(r.graph().nodes.get('q')!.who).toBe('me')

    expect(r.run('propose', 'q', '--who', 'you').code).toBe(0)
    expect(r.graph().nodes.get('q')!.who).toBe('me')
    const refused = r.run('accept', 'q', '--actor', 'you')
    expect(refused.code).toBe(1)
    expect(refused.stderr).toContain('would leave the decided card "q" missing a fact')
    expect(r.graph().nodes.get('q')!.who).toBe('me')

    r.run('discard', 'q')
    expect(r.run('propose', 'q', '--who', 'you', '--unchallenged', 'no option was weighed').code).toBe(0)
    expect(r.run('accept', 'q', '--actor', 'you').code).toBe(0)
    const q = r.graph().nodes.get('q')!
    expect(q.who).toBe('you')
    expect(q.pending).toBeUndefined()
  })

  test('the last option cannot be unlinked from a who:you card, and a second one lets the first go', () => {
    const r = repo()
    r.card('q', '--no-basis', '--who', 'you')
    r.run('add', 'q:o1', '--kind', 'option', '--title', 'o1', '--why_not', 'no')
    r.run('add', 'q:o2', '--kind', 'option', '--title', 'o2', '--why_not', 'no')
    for (const o of ['q:o1', 'q:o2']) r.run('accept', o, '--actor', 'you')
    for (const o of ['q:o1', 'q:o2']) r.run('link', o, 'q', '--type', 'alternative_to')
    r.run('kill', 'q', '--form', 'no-metric', '--text', 'none', '--reason', 'cheap')
    expect(r.run('status', 'q', 'decided').code).toBe(0)
    expect(r.run('unlink', 'q:o1', 'q', '--type', 'alternative_to').code).toBe(0)
    const last = r.run('unlink', 'q:o2', 'q', '--type', 'alternative_to')
    expect(last.code).toBe(1)
    expect(last.stderr).toContain('would leave the decided card "q" missing a fact')
  })

  test('a card decided before a kill criterion was required receives a waiver once the criterion is added', () => {
    const r = repo()
    decided(r, 'old', '--who', 'me')
    expect(r.run('kill', 'old', '--clear').code).toBe(0)
    // The amend waits for the kill criterion, which is free to add, and then goes through.
    expect(r.run('propose', 'old', '--no-basis').code).toBe(1)
    expect(r.run('propose', 'old', '--no-basis', 'a root').code).toBe(0)
    expect(r.run('accept', 'old', '--actor', 'you').code).toBe(1)
    expect(r.run('kill', 'old', '--form', 'no-metric', '--text', 'none', '--reason', 'cheap').code).toBe(0)
    expect(r.run('accept', 'old', '--actor', 'you').code).toBe(0)
  })

  test('the last depends_on link of a decided card cannot be unlinked, and the accept of a change needs every fact', () => {
    const r = repo()
    r.card('base', '--no-basis')
    r.card('c', '--who', 'me')
    r.run('link', 'c', 'base', '--type', 'depends_on', '--why', 'takes the base')
    r.run('kill', 'c', '--form', 'no-metric', '--text', 'none', '--reason', 'cheap')
    expect(r.run('status', 'c', 'decided').code).toBe(0)
    const out = r.run('unlink', 'c', 'base', '--type', 'depends_on')
    expect(out.code).toBe(1)
    expect(out.stderr).toContain('would leave the decided card "c" missing a fact')

    // A change to the words waits for the fact a card decided earlier lacks.
    r.run('kill', 'c', '--clear')
    r.run('propose', 'c', '--title', 'c, reworded')
    const accept = r.run('accept', 'c', '--actor', 'you')
    expect(accept.code).toBe(1)
    expect(r.graph().nodes.get('c')!.pending).toBeDefined()
    r.run('kill', 'c', '--form', 'no-metric', '--text', 'none', '--reason', 'cheap')
    expect(r.run('accept', 'c', '--actor', 'you').code).toBe(0)
    expect(r.graph().nodes.get('c')!.title).toBe('c, reworded')
  })
})

describe('#map-frozen: the accept of a change to a decided card is an amend that marks the next hop', () => {
  test('its dependents and children go stale with the trace amended, and the card stays decided', () => {
    const r = repo()
    r.card('y', '--no-basis', '--who', 'me')
    r.run('kill', 'y', '--form', 'no-metric', '--text', 'none', '--reason', 'cheap')
    expect(r.run('status', 'y', 'decided').code).toBe(0)
    r.card('z', '--no-basis')
    r.run('link', 'z', 'y', '--type', 'depends_on', '--why', 'takes the seat count')
    r.card('w', '--no-basis', '--parent', 'y')
    expect(r.graph().stale.size).toBe(0)

    r.run('propose', 'y', '--title', 'y, reworded')
    expect(r.graph().stale.size).toBe(0)
    expect(r.run('accept', 'y', '--actor', 'you').code).toBe(0)
    const g = r.graph()
    expect(g.nodes.get('y')!.status).toBe('decided')
    expect([...g.stale].sort()).toEqual(['w', 'z'])
    expect(g.flagWhy.get('z')![0].reason).toBe('amended')
    expect(g.stale.has('y')).toBe(false)
  })
})

describe('#map-frozen: the words of a decided card change only by a proposal', () => {
  test('edit and retitle refuse a decided card and name the proposal, and an open card still edits', () => {
    const r = repo()
    r.card('d', '--no-basis', '--who', 'me')
    r.run('kill', 'd', '--form', 'no-metric', '--text', 'none', '--reason', 'cheap')
    expect(r.run('status', 'd', 'decided').code).toBe(0)
    for (const args of [['edit', 'd', '--why', 'new'], ['retitle', 'd', 'new title']]) {
      const out = r.run(...args)
      expect(out.code).toBe(1)
      expect(out.stderr).toContain('is an amend')
    }
    expect(r.graph().nodes.get('d')!.title).toBe('d')
    r.card('o', '--no-basis')
    expect(r.run('edit', 'o', '--why', 'new').code).toBe(0)
    expect(r.run('retitle', 'o', 'new title').code).toBe(0)
  })
})
