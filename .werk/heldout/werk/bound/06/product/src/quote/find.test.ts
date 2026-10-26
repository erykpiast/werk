import { describe, expect, test } from 'bun:test'
import { describeFailure, findQuote, messageOf, transcriptLines } from './find.ts'

const user = (content: unknown, extra: object = {}) => JSON.stringify({ type: 'user', message: { role: 'user', content }, ...extra })
const assistant = (...blocks: object[]) => JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: blocks } })
const text = (t: string) => ({ type: 'text', text: t })

/** A transcript as Claude Code writes it: a summary, a meta line, tool traffic and real messages. */
const transcript = [
  JSON.stringify({ type: 'summary', summary: 'a restart kills my session' }),
  user('a restart kills my session every time I save'),
  user('<local-command-caveat>a restart</local-command-caveat>', { isMeta: true }),
  assistant({ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'echo "keep the child alive"' } }),
  user([{ type: 'tool_result', tool_use_id: 't1', content: 'keep the child alive' }]),
  assistant(text('The hot reload must keep the child alive.'), text('Then the session survives.')),
  'not json',
  user('a server edit reloads, and a client edit reloads too'),
].join('\n') + '\n'

describe('messageOf', () => {
  test('reads a user line with string content and an assistant line with text blocks joined by a newline', () => {
    const lines = transcriptLines(transcript)
    expect(messageOf(lines[1]!)).toEqual({ speaker: 'user', text: 'a restart kills my session every time I save', joins: [] })
    expect(messageOf(lines[5]!)).toEqual({ speaker: 'assistant', text: 'The hot reload must keep the child alive.\nThen the session survives.', joins: [41] })
  })

  test('a summary, a meta line, tool traffic, bad JSON and an empty message are not messages', () => {
    const lines = transcriptLines(transcript)
    for (const i of [0, 2, 3, 4, 6]) expect({ i, message: messageOf(lines[i]!) }).toEqual({ i, message: undefined })
    expect(messageOf('null')).toBeUndefined()
    expect(messageOf(user(''))).toBeUndefined()
    expect(messageOf(JSON.stringify({ type: 'user' }))).toBeUndefined()
  })
})

describe('findQuote', () => {
  test('one occurrence in one message is a pointer: the line index, the span and the speaker', () => {
    expect(findQuote(transcript, 'kills my session every')).toEqual({ ok: true, msgIndex: 1, span: [10, 32], speaker: 'user' })
    expect(findQuote(transcript, 'Then the session')).toEqual({ ok: true, msgIndex: 5, span: [42, 58], speaker: 'assistant' })
  })

  test('the span selects the quoted text in the message exactly', () => {
    for (const quote of ['a restart kills my session every time I save', 'Then the session', 'client edit']) {
      const result = findQuote(transcript, quote)
      if (!result.ok) throw new Error(`no match for ${quote}`)
      const message = messageOf(transcriptLines(transcript)[result.msgIndex]!)!
      expect(message.text.slice(...result.span)).toBe(quote)
    }
  })

  test('one changed character is no match', () => {
    expect(findQuote(transcript, 'a restart kills my sessiom')).toEqual({ ok: false, reason: 'no-match' })
    expect(findQuote(transcript, 'A restart kills my session')).toEqual({ ok: false, reason: 'no-match' })
  })

  test('a quote across two text blocks of one line is no match: the newline between them is not in the file', () => {
    expect(findQuote(transcript, 'alive.\nThen')).toEqual({ ok: false, reason: 'no-match' })
    expect(findQuote(transcript, '\n')).toEqual({ ok: false, reason: 'no-match' })
    expect(findQuote(transcript, 'alive.')).toMatchObject({ ok: true, msgIndex: 5, span: [35, 41] })
  })

  test('text found only in a summary, a meta line or tool traffic is no match', () => {
    expect(findQuote(transcript, 'keep the child alive"')).toEqual({ ok: false, reason: 'no-match' })
    expect(findQuote(transcript, 'local-command-caveat')).toEqual({ ok: false, reason: 'no-match' })
  })

  test('text in two messages is ambiguous and names the messages', () => {
    expect(findQuote(transcript, 'session')).toEqual({ ok: false, reason: 'ambiguous', messages: [1, 5] })
  })

  test('text twice in one message is ambiguous too, overlaps included', () => {
    expect(findQuote(transcript, 'edit reloads')).toEqual({ ok: false, reason: 'repeated', msgIndex: 7, count: 2 })
    expect(findQuote(user('aaa'), 'aa')).toEqual({ ok: false, reason: 'repeated', msgIndex: 0, count: 2 })
  })

  test('an empty quote fails', () => {
    expect(findQuote(transcript, '')).toEqual({ ok: false, reason: 'empty' })
  })
})

describe('describeFailure', () => {
  test('names the case: no exact match, or ambiguous with where', () => {
    expect(describeFailure({ ok: false, reason: 'no-match' }, 's1')).toContain('no exact match in session s1')
    expect(describeFailure({ ok: false, reason: 'ambiguous', messages: [1, 5] }, 's1')).toContain('ambiguous. The text occurs in 2 messages of session s1 (message 1, 5)')
    expect(describeFailure({ ok: false, reason: 'repeated', msgIndex: 7, count: 2 }, 's1')).toContain('ambiguous. The text occurs 2 times in message 7')
    expect(describeFailure({ ok: false, reason: 'empty' }, 's1')).toBe('quote: the text is empty')
  })
})
