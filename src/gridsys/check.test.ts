// The tile grammar. Pure: a rule that wrongly lets a grid through draws a diagram that still
// looks like a diagram, so it sits under the 90% gate — see #werk-test-scope-src0-pure-scope.
import { describe, expect, test } from 'bun:test'
import { check, indexCells } from './check.ts'
import { parseGrid } from './parse.ts'

// Four cards and two edges. a->b carries a label, c->d does not.
const CONTENT = `content
  flowchart TD
    subgraph top [TOP]
      a["A | first card"]
      b["B"]
    end
    c["C"]
    d["D"]
    a -->|go| b
    c --> d
grid
`
const grid = (...rows: string[]) => CONTENT + rows.map((r) => `  "${r}"`).join('\n')
const checkRows = (...rows: string[]) => check(parseGrid(grid(...rows)))
const errorsOf = (...rows: string[]) => checkRows(...rows).errors

describe('check: a valid grid', () => {
  test('a straight grid has no errors, and the index knows where every token sits', () => {
    const { errors, index } = checkRows('a a->b b ~ c c->d d')
    expect(errors).toEqual([])
    expect(index.rows).toBe(1)
    expect(index.cols).toBe(7)
    expect(index.cardCells.get('a')).toEqual([{ r: 0, c: 0 }])
    expect(index.pathCells.get('c->d')).toEqual([{ r: 0, c: 5 }])
    expect(index.cardAt.get('0,6')).toBe('d')
    expect(index.pathAt.get('0,1')).toBe('a->b')
    expect(index.spacers).toEqual([{ r: 0, c: 3 }])
    expect(index.junctions).toEqual([])
    expect(index.bridgedEdges.size).toBe(0)
  })

  test('a multi-cell card that fills its rectangle passes R1', () => {
    expect(errorsOf('a a c c', 'a a c c', 'a->b . c->d .', 'b . d .')).toEqual([])
  })

  test('a label that splits its path in two marks the edge as bridged', () => {
    const { errors, index } = checkRows('a . c', 'a->b . c->d', '@a->b . d', 'a->b . .', 'b . .')
    expect(errors).toEqual([])
    expect([...index.bridgedEdges]).toEqual(['a->b'])
    expect(index.labelCells.get('a->b')).toEqual([{ r: 2, c: 0 }])
  })

  test('a crossing at a junction is in both edges\' paths and in the junction list', () => {
    const { errors, index } = checkRows('. . a . .', '. . a->b . .', 'c c->d a->b+c->d c->d d', '. . a->b . .', '. . b . .')
    expect(errors).toEqual([])
    expect(index.junctions).toEqual([{ r: 2, c: 2, ids: ['a->b', 'c->d'] }])
    expect(index.pathCells.get('a->b')).toContainEqual({ r: 2, c: 2 })
    expect(index.pathCells.get('c->d')).toContainEqual({ r: 2, c: 2 })
  })

  test('a one-cell path between two stacked cards is valid', () => {
    expect(errorsOf('a c', 'a->b c->d', 'b d')).toEqual([])
  })

  test('indexCells counts columns from the widest row of a ragged grid', () => {
    expect(indexCells(parseGrid(grid('a', 'a a->b b c c->d d'))).cols).toBe(6)
  })

  test('an empty grid has no rows and nothing to check against R5', () => {
    const { errors, index } = check(parseGrid('content\n  x --> y\n'))
    expect(index.rows).toBe(0)
    expect(errors).toEqual(['R2: edge "x->y" has no path cell in the grid'])
  })
})

describe('check: the tile grammar refuses a broken grid, and names the rule', () => {
  const cases: Array<[string, string[], string]> = [
    ['a ragged row', ['a a->b b c c->d d', 'a'], 'R5: row 1 has 1 tokens, row 0 has 6'],
    ['an unknown id', ['a a->b b c c->d d zz'], 'unknown id at (0,6): "zz"'],
    ['a card with no cell', ['a a->b b . . .'], 'R1: card "c" has no cell in the grid'],
    ['a card that is not a rectangle', ['a a->b b a c c->d d'], 'R1: card "a" is not a filled rectangle'],
    ['an L-shaped card names the missing cell', ['a a c c->d d', 'a . . . .', 'a->b . . . .', 'b . . . .'], 'but 1 cell(s) inside that box are not its own: (1,1)'],
    ['an edge with no path', ['a . b c c->d d'], 'R2: edge "a->b" has no path cell in the grid'],
    ['a one-cell path that misses a card', ['a a->b . b c c->d d'], 'R3: edge "a->b"\'s single path cell (0,1) must touch both'],
    ['a label on a one-cell path', ['a a->b b @a->b c c->d d'], 'R4: label of edge "a->b" has only one path cell'],
    ['a branch', ['. a . c', 'a->b a->b a->b c->d', '. a->b . d', '. b . .'], 'R2: edge "a->b" branches at (1,1)'],
    ['a closed loop', ['a a->b a->b c', '. a->b a->b c->d', 'b . . d'], 'R2: edge "a->b" has 0 path end(s)'],
    ['a label beside the line', ['a a->b @a->b c', '. a->b . c->d', '. b . d'], 'R4: label of edge "a->b" sits beside'],
    ['a label that touches nothing', ['a . @a->b c', 'a->b . . c->d', 'a->b . . d', 'b . . .'], 'touches no cell of that edge\'s path'],
    ['a cut path', ['a a->b . c', '. . . c->d', '. a->b . d', '. b . .'], 'R2: edge "a->b" is in 2 disconnected piece(s)'],
    ['a cut path with an isolated cell', ['a a->b . c', '. . . c->d', '. a->b . d', '. b . .'], 'R2: edge "a->b" has isolated path cell(s)'],
    ['ends on the wrong cards', ['a . c', 'a->b . c->d', 'a->b . d', '. . b'], 'R3: edge "a->b" ends at (1,0) and (2,0)'],
    ['a label that is not a rectangle', ['a . c', 'a->b . c->d', '@a->b @a->b d', 'a->b . .', 'b @a->b .'], 'R4: label of edge "a->b" is not a filled rectangle'],
    ['a branch at the label', ['. a . c', 'a->b a->b a->b c->d', '. @a->b . d', '. a->b . .', '. b . .'], 'R2: edge "a->b" branches at its inline label'],
    ['three ends around a label', ['a . c', 'a->b . c->d', '@a->b a->b d', 'a->b . .', 'b . .'], 'R2: edge "a->b" has 3 path end(s)'],
    ['a bridged path on the wrong cards', ['a . c', 'a->b . c->d', '@a->b . d', 'a->b . .', '. . b'], 'R3: edge "a->b" ends at (1,0) and (3,0)'],
    ['a junction that turns', ['. a c', 'c->d a->b+c->d d', '. a->b .', '. b .'], 'R6: junction at (1,1) — edge "c->d" does not pass straight through'],
    ['a junction on one axis', ['a . c', 'a->b+c->d . .', 'a->b+c->d . .', 'a->b+c->d . .', 'b . d'], 'both run vertical, not a crossing'],
  ]
  for (const [name, rows, expected] of cases) {
    test(name, () => {
      expect(errorsOf(...rows).join('\n')).toContain(expected)
    })
  }

  test('a broken grid is not marked bridged', () => {
    const { index } = checkRows('a . c', 'a->b . c->d', '@a->b a->b d', 'a->b . .', 'b . .')
    expect(index.bridgedEdges.size).toBe(0)
  })
})
