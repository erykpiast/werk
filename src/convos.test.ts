// convos.ts behaviours from #werk-test-behaviours-convos. The seam is the transcript on disk:
// each test writes chat.jsonl and session files under the scratch .werk the preload set up.
import { beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { ChatMessage } from './agent.ts'
import { findQuote, listConvos, recall, resolveConvo, type Convo } from './convos.ts'
import { paths } from './project.ts'

const WERK = dirname(process.env.WERK_LOG!)
const CONVO_DIR = paths.convos

/** One conversation on disk. `main` is the legacy layout: .werk/session and .werk/chat.jsonl. */
function convo(name: string, session: string | null, messages: Array<Partial<ChatMessage>>) {
  const dir = name === 'main' ? WERK : join(CONVO_DIR, name)
  mkdirSync(dir, { recursive: true })
  if (session) writeFileSync(join(dir, 'session'), session + '\n')
  const lines = messages.map((m, i) => JSON.stringify({ at: `2026-10-0${1 + (i % 9)}T10:00:00.000Z`, from: 'you', text: '', ...m }))
  writeFileSync(join(dir, 'chat.jsonl'), lines.join('\n') + '\n')
}

beforeEach(() => {
  rmSync(CONVO_DIR, { recursive: true, force: true })
  rmSync(join(WERK, 'session'), { force: true })
  rmSync(join(WERK, 'chat.jsonl'), { force: true })
})

const names = (list: Convo[]) => list.map((c) => c.name).sort()

describe('convos.ts', () => {
  test('1a. a session-id prefix that matches two conversations is ambiguous, never auto-picked', () => {
    convo('one', 'abc111', [{ text: 'x' }])
    convo('two', 'abc222', [{ text: 'y' }])
    const found = resolveConvo('abc')
    expect(found && 'ambiguous' in found && names(found.ambiguous)).toEqual(['one', 'two'])
    expect(resolveConvo('abc1')).toMatchObject({ convo: { name: 'one' } })
  })

  test('1b. a card id two conversations sit on is ambiguous, never auto-picked', () => {
    convo('one', 's1', [{ text: 'x', card: 'werk-test' }])
    convo('two', 's2', [{ text: 'y', card: 'other' }, { text: 'z', card: 'werk-test' }])
    const found = resolveConvo('#werk-test')
    expect(found && 'ambiguous' in found && names(found.ambiguous)).toEqual(['one', 'two'])
    expect(resolveConvo('#other')).toMatchObject({ convo: { name: 'two' } })
    expect(resolveConvo('nothing-matches')).toBeNull()
  })

  test('2. findQuote reports ambiguous when the needle is in more than one message', () => {
    convo('q', 's', [
      { from: 'you', text: 'we pick the grid' },
      { from: 'agent', text: 'yes, we pick the grid layout' },
    ])
    const [c] = listConvos()
    expect(findQuote(c, 'we pick the grid')).toEqual({ ambiguous: 2 })
    expect(findQuote(c, 'grid layout')).toMatchObject({ msgIndex: 1, speaker: 'agent', span: [17, 28] })
    expect(findQuote(c, 'never said')).toBeNull()
  })

  test('2b. findQuote fails on a repeat inside one message, and names the number of matches', () => {
    convo('q', 's', [
      { from: 'you', text: 'We pick a grid.' },
      { from: 'agent', text: 'the grid wins, and the grid is faster.' },
    ])
    const [c] = listConvos()
    expect(findQuote(c, 'pick a grid')).toMatchObject({ msgIndex: 0, span: [3, 14] })
    expect(findQuote(c, 'grid')).toEqual({ ambiguous: 2 })
    expect(findQuote(c, 'the grid')).toEqual({ repeated: 2 })
    expect(findQuote(c, 'the grid is faster')).toMatchObject({ msgIndex: 1, span: [19, 37] })
  })

  test('3. findQuote searches only you/agent messages, never tool or result echoes', () => {
    convo('q', 's', [
      { from: 'tool', text: 'node src/cli.ts quote x q --text "the exact words"' },
      { from: 'agent', text: 'I said the exact words once.' },
      { from: 'result', text: 'recall dump: the exact words' },
      { from: 'thinking', text: 'the exact words' },
    ])
    const [c] = listConvos()
    expect(findQuote(c, 'the exact words')).toMatchObject({ msgIndex: 1, speaker: 'agent' })
  })

  test('4. recall --grep keeps only messages matching every term', () => {
    convo('g', 's', [
      { text: 'alpha only' },
      { text: 'beta only' },
      { text: 'Alpha and BETA together' },
      { text: 'neither' },
    ])
    const [c] = listConvos()
    const out = recall(c, { grep: ['alpha', 'beta'], context: 0 })
    expect(out).toHaveLength(1)
    expect(out[0]).toContain('Alpha and BETA together')
  })

  test('5. recall hides tool, result and thinking messages unless asked', () => {
    convo('h', 's', [
      { from: 'you', text: 'question' },
      { from: 'thinking', text: 'hmm' },
      { from: 'tool', text: 'Bash ls' },
      { from: 'result', text: 'file.txt' },
      { from: 'system', text: 'New session' },
      { from: 'agent', text: 'answer' },
    ])
    const [c] = listConvos()
    const plain = recall(c).join('\n')
    for (const hidden of ['hmm', 'Bash ls', 'file.txt', 'New session']) expect(plain).not.toContain(hidden)
    expect(plain).toContain('question')
    expect(plain).toContain('answer')
    const all = recall(c, { tools: true, thinking: true }).join('\n')
    for (const shown of ['hmm', 'Bash ls', 'file.txt']) expect(all).toContain(shown)
  })

  test('6. listConvos lists the legacy main layout alongside every conversations/ directory', () => {
    convo('main', 'legacy-session', [{ text: 'before multichat', card: 'home-card' }])
    convo('fork-a', 'sa', [{ text: 'a' }])
    convo('fork-b', null, [{ text: 'b' }])
    // A stray file in conversations/ and an empty directory are not conversations.
    writeFileSync(join(CONVO_DIR, 'stray.txt'), 'x')
    mkdirSync(join(CONVO_DIR, 'empty'))
    const all = listConvos()
    expect(names(all)).toEqual(['fork-a', 'fork-b', 'main'])
    expect(all.find((c) => c.name === 'main')).toMatchObject({ sessionId: 'legacy-session', home: 'home-card', turns: 1 })
    expect(resolveConvo('main')).toMatchObject({ convo: { name: 'main' } })
  })
})
