// web/diff.js: a proposed body change as ops, verified against the real body, and rendered
// as Markdown. Shared by fold.ts and the browser — see #al-diff-cli.
import { describe, expect, test } from 'bun:test'
import { applyOps, renderInlineDiff, renderOpsMarkdown, splitBlocks, verifyOps } from '../web/diff.js'

describe('splitBlocks', () => {
  test('splits on blank lines, trims the end, keeps leading spaces, drops empties', () => {
    expect(splitBlocks('a\nb \n\n \n\nc  ')).toEqual(['a\nb', 'c'])
    expect(splitBlocks('    code\n    more\n\ntext')).toEqual(['    code\n    more', 'text'])
    expect(splitBlocks(undefined)).toEqual([])
  })
})

describe('verifyOps', () => {
  test('a real quote passes through untouched', () => {
    const ops = [{ tag: 'removed', old: 'b' }]
    expect(verifyOps('a\n\nb', ops)).toEqual({ ops, rejected: [] })
  })
  test('a removed quote that is not there is rejected and kept only as a removed block', () => {
    const { ops, rejected } = verifyOps('a', [{ tag: 'removed', old: 'zz' }])
    expect(ops).toEqual([{ tag: 'removed', old: 'zz' }])
    expect(rejected[0].reason).toBe('quote not found verbatim in the current body')
  })
})

describe('applyOps', () => {
  test('keeps new text in op order and drops removed blocks', () => {
    expect(applyOps([{ tag: 'new', new: 'x' }, { tag: 'removed', old: 'y' }, { tag: 'elaborated', old: 'a', new: 'b' }])).toBe('x\n\nb')
  })
})

describe('renderOpsMarkdown', () => {
  test('a reworded sentence highlights only the changed words', () => {
    expect(renderOpsMarkdown([{ tag: 'elaborated', old: 'the quick brown fox jumps', new: 'the slow brown fox leaps' }])).toBe(
      'the ==~~quick~~slow== brown fox ==~~jumps~~leaps==',
    )
  })

  test('a whole rewrite is one highlight, not word salad', () => {
    expect(renderOpsMarkdown([{ tag: 'elaborated', old: 'alpha beta gamma delta', new: 'totally different words here' }])).toBe(
      '==~~alpha beta gamma delta~~totally different words here==',
    )
  })

  test('a pure deletion or a pure addition at the end', () => {
    expect(renderOpsMarkdown([{ tag: 'elaborated', old: 'keep this. drop', new: 'keep this.' }])).toBe('keep this. ==~~drop~~==')
    expect(renderOpsMarkdown([{ tag: 'elaborated', old: 'keep this.', new: 'keep this. add' }])).toBe('keep this. ==add==')
  })

  test('a list of the same shape is diffed line by line, markers kept', () => {
    expect(renderOpsMarkdown([{ tag: 'elaborated', old: '- one item\n- two item', new: '- one thing\n- two item' }])).toBe(
      '- one ==~~item~~thing==\n- two item',
    )
  })

  test('one added, removed, or reworded item in a list is marked alone, the rest stay plain', () => {
    const list = '- alpha one\n- beta two\n- gamma three'
    expect(renderOpsMarkdown([{ tag: 'elaborated', old: list, new: '- alpha one\n- new item\n- beta two\n- gamma three' }])).toBe(
      '- alpha one\n- ==new item==\n- beta two\n- gamma three',
    )
    expect(renderOpsMarkdown([{ tag: 'elaborated', old: list, new: '- alpha one\n- gamma three' }])).toBe(
      '- alpha one\n- ==~~beta two~~==\n- gamma three',
    )
    expect(
      renderOpsMarkdown([{ tag: 'elaborated', old: list, new: '- alpha one\n- beta two again\n- gamma three\n- delta' }]),
    ).toBe('- alpha one\n- beta two ==again==\n- gamma three\n- ==delta==')
  })

  test('one item out and one in, same line count, marks only those two items', () => {
    expect(renderOpsMarkdown([{ tag: 'elaborated', old: '- a one\n- b two\n- c three', new: '- a one\n- c three\n- d four' }])).toBe(
      '- a one\n- ==~~b two~~==\n- c three\n- ==d four==',
    )
  })

  test('a numbered list keeps renumbered items plain', () => {
    expect(renderOpsMarkdown([{ tag: 'elaborated', old: '1. a\n2. b\n3. c', new: '1. a\n2. c' }])).toBe('1. a\n2. ==~~b~~==\n2. c')
  })

  test('an unrelated item is a removal and an addition, not a word salad', () => {
    expect(renderOpsMarkdown([{ tag: 'elaborated', old: '- keep\n- alpha beta', new: '- keep\n- gamma delta\n- more' }])).toBe(
      '- keep\n- ==~~alpha beta~~==\n- ==gamma delta==\n- ==more==',
    )
  })

  test('a structural block that changes shape renders the old block removed and the new one added', () => {
    expect(renderOpsMarkdown([{ tag: 'elaborated', old: '- a\n- b', new: '# heading' }])).toBe('- ==~~a~~==\n- ==~~b~~==\n\n# ==heading==')
  })

  test('new and removed blocks, prose and structural', () => {
    expect(
      renderOpsMarkdown([
        { tag: 'new', new: 'added' },
        { tag: 'new', new: '- listy' },
        { tag: 'removed', old: 'gone' },
        { tag: 'removed', old: '> quoted' },
      ]),
    ).toBe('==added==\n\n- ==listy==\n\n==~~gone~~==\n\n> ==~~quoted~~==')
  })

  test('an inline diff never lets a mark cross a paragraph break', () => {
    expect(renderInlineDiff('one a\n\ntwo b', 'one c\n\ntwo d')).toBe('one ==~~a~~c==\n\ntwo ==~~b~~d==')
    expect(renderInlineDiff('one', 'x\n\ny')).toBe('==~~one~~==\n\n==x==\n\n==y==')
  })
})
