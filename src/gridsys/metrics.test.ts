// Text widths from the checked-in font table, and the word wrap built on them. Pure: a wrong
// width wraps a title at the wrong word and nothing fails — see #werk-test-scope-src0-pure-scope.
import { describe, expect, test } from 'bun:test'
import { measureText, wrapText, type FontSize } from './metrics.ts'

describe('measureText', () => {
  test('a longer string is wider, bold is wider than regular, a bigger size is wider', () => {
    expect(measureText('abcd', 10, 400)).toBeGreaterThan(measureText('ab', 10, 400))
    expect(measureText('abcd', 10, 700)).toBeGreaterThan(measureText('abcd', 10, 400))
    expect(measureText('abcd', 12.5, 400)).toBeGreaterThan(measureText('abcd', 9.5, 400))
  })

  test('the width of a string is the sum of its characters', () => {
    expect(measureText('ab', 11, 400)).toBeCloseTo(measureText('a', 11, 400) + measureText('b', 11, 400))
    expect(measureText('', 11, 400)).toBe(0)
  })

  test('a character outside the table counts as a space', () => {
    expect(measureText('é', 10, 400)).toBe(measureText(' ', 10, 400))
  })

  test('a size with no table refuses, and names the missing size', () => {
    expect(() => measureText('a', 13 as FontSize, 400)).toThrow('no metrics for 400:13')
  })
})

describe('wrapText', () => {
  test('keeps every word and stays inside the width', () => {
    const lines = wrapText('one two three four five six seven', 60, 10, 400)
    expect(lines.join(' ')).toBe('one two three four five six seven')
    expect(lines.length).toBeGreaterThan(1)
    for (const l of lines) expect(measureText(l, 10, 400)).toBeLessThanOrEqual(60)
  })

  test('text that fits is one line, with runs of whitespace collapsed', () => {
    expect(wrapText('  one   two ', 500, 10, 400)).toEqual(['one two'])
  })

  test('a word wider than the width gets its own line, never split', () => {
    expect(wrapText('a extraordinarily b', 20, 10, 400)).toEqual(['a', 'extraordinarily', 'b'])
  })

  test('empty text is no lines', () => {
    expect(wrapText('   ', 100, 10, 400)).toEqual([])
  })
})
