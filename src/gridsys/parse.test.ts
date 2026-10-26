// parseGrid is pure: a .wgrid text in, cards, groups, edges and typed grid tokens out. A wrong
// rule reads a grid that still looks like a grid, so it sits under the 90% gate — see
// #werk-test-scope-src0-pure-scope.
import { describe, expect, test } from 'bun:test'
import { parseGrid } from './parse.ts'

// Four cards and two edges. a->b carries a label, c->d does not.
const CONTENT = `# a comment line
content
  flowchart TD
    subgraph top [TOP]
      a["A | first card"] @werk-test,werk-test-visual
      b["B"]
    end
    c["C"]
    d["D"]
    a -->|go| b @werk-test
    c --> d
    class a,b state
grid
`
const grid = (...rows: string[]) => CONTENT + rows.map((r) => `  "${r}"`).join('\n')

describe('parseGrid', () => {
  test('reads cards, groups, edges, citations and classes', () => {
    const doc = parseGrid(grid('a a->b b c c->d d'))
    expect(doc.cardById.get('a')).toEqual({ id: 'a', title: 'A', desc: 'first card', cls: 'state', cards: ['werk-test', 'werk-test-visual'] })
    expect(doc.cardById.get('c')).toEqual({ id: 'c', title: 'C', desc: '', cls: '', cards: [] })
    expect(doc.groups).toEqual([{ id: 'top', title: 'TOP', members: ['a', 'b'], subgroups: [] }])
    expect(doc.edgeById.get('a->b')).toEqual({ id: 'a->b', from: 'a', to: 'b', label: 'go', cls: 'state', cards: ['werk-test'] })
    // An edge with no class of its own inherits its source card's, else read.
    expect(doc.edgeById.get('c->d')).toEqual({ id: 'c->d', from: 'c', to: 'd', label: '', cls: 'read', cards: [] })
  })

  test('a class statement can name an edge, and it beats the source card class', () => {
    const doc = parseGrid(CONTENT.replace('grid\n', '    class c->d,a->b agent\ngrid\n'))
    expect(doc.edgeById.get('c->d')!.cls).toBe('agent')
    expect(doc.edgeById.get('a->b')!.cls).toBe('agent')
  })

  test('a description keeps every pipe after the first, and a citation keeps an option colon', () => {
    const doc = parseGrid('content\n  x["X | one | two"] @card:opt0,other\n')
    expect(doc.cardById.get('x')).toMatchObject({ title: 'X', desc: 'one | two', cards: ['card:opt0', 'other'] })
  })

  test('a long arrow and a `graph` header both read', () => {
    const doc = parseGrid('content\n  graph LR\n  p["P"]\n  q["Q"]\n  p ---> q\n')
    expect(doc.edges.map((e) => e.id)).toEqual(['p->q'])
  })

  test('a subgraph inside a subgraph is a subgroup, and `end` closes only the inner one', () => {
    const doc = parseGrid(
      'content\n  subgraph outer [OUTER]\n    subgraph inner [ INNER ]\n      x["X"]\n    end\n    y["Y"]\n  end\n  z["Z"]\n'
    )
    expect(doc.groups).toEqual([
      { id: 'outer', title: 'OUTER', members: ['y'], subgroups: ['inner'] },
      { id: 'inner', title: 'INNER', members: ['x'], subgroups: [] },
    ])
  })

  test('a section header opens only at zero indentation', () => {
    // An indented `grid` inside content is a content line, and content cannot read it.
    expect(() => parseGrid('content\n  grid\n')).toThrow('line 2: cannot parse content line: grid')
  })

  test('blank lines and comment lines are skipped anywhere', () => {
    const doc = parseGrid('\n# top\ncontent\n\n  # inside\n  x["X"]\ngrid\n\n  # row comment\n  "x"\n')
    expect(doc.rows).toEqual([[{ kind: 'card', id: 'x' }]])
  })

  test('types every grid token, and keeps an unknown one as unknown', () => {
    const doc = parseGrid(grid('. ~ a a->b @a->b @nope a->b+c->d a->b+a->b a->b+zz a+b+c zz'))
    expect(doc.rows[0]).toEqual([
      { kind: 'empty' },
      { kind: 'spacer' },
      { kind: 'card', id: 'a' },
      { kind: 'path', id: 'a->b' },
      { kind: 'label', id: 'a->b' },
      { kind: 'unknown', raw: '@nope' },
      { kind: 'junction', ids: ['a->b', 'c->d'] },
      { kind: 'unknown', raw: 'a->b+a->b' },
      { kind: 'unknown', raw: 'a->b+zz' },
      { kind: 'unknown', raw: 'a+b+c' },
      { kind: 'unknown', raw: 'zz' },
    ])
  })

  test('a ragged grid stays ragged: the parser does not pad a short row', () => {
    const doc = parseGrid(grid('a a->b b', 'c'))
    expect(doc.rows.map((r) => r.length)).toEqual([3, 1])
  })

  test('refuses a content line it cannot read, a bare grid row, and text before a section', () => {
    expect(() => parseGrid('content\n  what is this')).toThrow('line 2: cannot parse content line')
    expect(() => parseGrid('grid\n  a b')).toThrow('line 2: a grid row must be one quoted string')
    expect(() => parseGrid('stray')).toThrow('line 1: content before any section header')
  })
})
