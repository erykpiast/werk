import { expect, test } from 'bun:test'
import { sseEvent } from './sse.ts'

test('an event is a named block of data lines, closed by a blank line', () => {
  expect(sseEvent('hello', { a: 1 })).toBe('event: hello\ndata: {"a":1}\n\n')
})

test('a value with a newline still fits on data lines', () => {
  const text = sseEvent('note', 'two\nlines')
  expect(text).toBe('event: note\ndata: "two\\nlines"\n\n')
})
