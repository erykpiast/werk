import { expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Checks, decidedRoot, logText, mustRun, project, showCard, type TempProject } from './lib.ts'

const report = (c: Checks, id: string) => {
  console.log(`\n=== ${id}\n${c.report()}`)
  expect(c.misses).toEqual([])
}

const SESSION = '0f3c1e2a-6b7d-4c1e-9a2b-5d4e3f2a1b0c'

/** A Claude Code session transcript: one JSON message per line. */
function transcript(p: TempProject, messages: { role: 'user' | 'assistant'; text: string }[]) {
  const lines = messages.map((m, i) => JSON.stringify({ type: m.role, sessionId: SESSION, uuid: `m${i}`, message: { role: m.role, content: m.role === 'user' ? m.text : [{ type: 'text', text: m.text }] } }))
  for (const dir of [join(p.dir, '.werk', 'conversations'), join(p.dir, '.werk', 'sessions')]) {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, `${SESSION}.jsonl`), lines.join('\n') + '\n')
  }
}

/** The nearest command to "quote this text from that session for that card": every verb the usage could hold. */
function quote(p: TempProject, card: string, text: string) {
  const help = p.run(['help']).stdout
  const verb = ['quote', 'excerpt', 'cite'].find((v) => new RegExp(`^\\s+${v}\\b`, 'm').test(help)) ?? 'quote'
  return { verb, help, ...p.run([verb, card, text, '--session', SESSION]) }
}

const setup = (messages: { role: 'user' | 'assistant'; text: string }[]) => {
  const p = project()
  decidedRoot(p, 'log', 'Use an append-only log')
  transcript(p, messages)
  return p
}

test('06.1 an exact quote becomes a ghost excerpt that cites its source', () => {
  const c = new Checks()
  const p = setup([{ role: 'assistant', text: 'What is the map?' }, { role: 'user', text: 'I think the map is a view of the log, nothing more.' }])
  const before = logText(p.dir)
  const r = quote(p, 'log', 'the map is a view of the log')
  c.note(`usage has a quote verb: ${/^\s+(quote|excerpt|cite)\b/m.test(r.help)}; werk ${r.verb} -> ${r.code}: ${r.stderr.split('\n')[0]}`)
  c.ok(r.code === 0, 'the quote command succeeds')
  c.ok(logText(p.dir) !== before, 'a new excerpt event is in the log')
  const page = showCard(p, 'log')
  c.ok((page?.evidence ?? []).length > 0, `the card is linked supported_by an excerpt: ${JSON.stringify(page?.evidence)}`)
  report(c, '06.1')
})

test('06.2 the excerpt span selects the quoted text exactly', () => {
  const c = new Checks()
  const p = setup([{ role: 'user', text: 'How do writes work?' }, { role: 'assistant', text: 'Nothing is rewritten. Every change is a new event in the log. The map is folded from it.' }])
  const r = quote(p, 'log', 'Every change is a new event in the log.')
  c.note(`werk ${r.verb} -> ${r.code}: ${r.stderr.split('\n')[0]}`)
  c.ok(r.code === 0, 'the quote command succeeds and records a message index and span')
  report(c, '06.2')
})

test('06.3 a quote with one changed character fails and writes nothing', () => {
  const c = new Checks()
  const p = setup([{ role: 'assistant', text: 'No view edits a drawn card in place.' }])
  const before = logText(p.dir)
  const r = quote(p, 'log', 'No view edits a drawn card in places.')
  c.note(`werk ${r.verb} -> ${r.code}: ${r.stderr.split('\n')[0]}`)
  c.ok(r.code !== 0, 'the quote fails')
  c.ok(/no exact match|not found|does not match/i.test(r.stderr) && /transcript|session/i.test(r.stderr), 'the message says the text has no exact match in the transcript')
  c.ok(logText(p.dir) === before, 'no new event in the log')
  c.ok((showCard(p, 'log')?.evidence ?? []).length === 0, 'no new excerpt or supported_by link on the card')
  report(c, '06.3')
})

test('06.4 a quote that occurs in two messages fails and names the ambiguity', () => {
  const c = new Checks()
  const p = setup([{ role: 'user', text: 'Remember: the tool never guesses.' }, { role: 'assistant', text: 'Yes, the tool never guesses a fact.' }])
  const before = logText(p.dir)
  const r = quote(p, 'log', 'the tool never guesses')
  c.note(`werk ${r.verb} -> ${r.code}: ${r.stderr.split('\n')[0]}`)
  c.ok(r.code !== 0, 'the quote fails')
  c.ok(/more than one|ambiguous|two messages|matches \d+ messages/i.test(r.stderr), 'the message says the text matches more than one message')
  c.ok(logText(p.dir) === before, 'no new event in the log')
  c.ok((showCard(p, 'log')?.evidence ?? []).length === 0, 'no new excerpt on the card')
  report(c, '06.4')
})

test('06.5 an accepted excerpt shows in the card view with speaker and session', () => {
  const c = new Checks()
  const p = setup([{ role: 'user', text: 'the map is a view of the log' }])
  const r = quote(p, 'log', 'the map is a view of the log')
  c.note(`werk ${r.verb} -> ${r.code}: ${r.stderr.split('\n')[0]}`)
  c.ok(r.code === 0, 'the agent quotes the sentence (Given)')
  const a = p.run(['accept', 'log', '--actor', 'you'])
  c.note(`werk accept -> ${a.code}: ${a.stderr.split('\n')[0]}`)
  c.ok(a.code === 0, 'the person gives the excerpt the ✓')
  report(c, '06.5')
})
