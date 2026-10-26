// resolveGrid is pure: a checked grid in, boxes and points out. A wrong track width or path
// walk draws a diagram that still looks like a diagram, so it sits under the 90% gate — see
// #werk-test-scope-src0-pure-scope.
import { describe, expect, test } from 'bun:test'
import { check } from './check.ts'
import { parseGrid } from './parse.ts'
import { resolveGrid } from './resolve.ts'

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

const resolveText = (text: string) => {
  const doc = parseGrid(text)
  const { errors, index } = check(doc)
  expect(errors).toEqual([])
  return resolveGrid(doc, index)
}
const resolveRows = (...rows: string[]) => resolveText(grid(...rows))
// For a grid the checker refuses: the resolver must still draw what it can.
const resolveUnchecked = (...rows: string[]) => {
  const doc = parseGrid(grid(...rows))
  return resolveGrid(doc, check(doc).index)
}

describe('resolveGrid: sizes and boxes', () => {
  test('without an index, it checks the grid itself', () => {
    const r = resolveGrid(parseGrid(grid('a a->b b c c->d d')))
    expect(r.cards.map((c) => c.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  test('a card box holds its title and description, and cards on one row line up', () => {
    const r = resolveRows('a a->b b c c->d d')
    const a = r.cards.find((c) => c.id === 'a')!
    expect(a.titleLines).toEqual(['A'])
    expect(a.descLines).toEqual(['first card'])
    expect(a.box.h).toBeGreaterThanOrEqual(a.contentH)
    expect(r.cards.find((c) => c.id === 'b')!.box.y).toBe(a.box.y)
    expect(r.width).toBeGreaterThan(0)
    expect(r.height).toBeGreaterThan(0)
  })

  test('a long title wraps and makes its card taller', () => {
    const long = CONTENT.replace('c["C"]', 'c["a very long title that cannot fit on one line of the card"]')
    const r = resolveText(long + '  "a a->b b c c->d d"')
    const c = r.cards.find((x) => x.id === 'c')!
    expect(c.titleLines.length).toBeGreaterThan(1)
    expect(c.contentH).toBeGreaterThan(r.cards.find((x) => x.id === 'd')!.contentH)
  })

  test('a card spanning two columns shares its width between them', () => {
    const r = resolveRows('a a . . .', 'a->b . c c->d d', 'b . . . .')
    const a = r.cards.find((c) => c.id === 'a')!
    expect(a.box.x).toBe(r.colX[0])
    expect(a.box.w).toBe(r.colX[1] + r.colW[1] - r.colX[0])
  })

  test('a label cell is wide enough for its text, and the label lines come out', () => {
    const r = resolveRows('a . c', 'a->b . c->d', '@a->b . d', 'a->b . .', 'b . .')
    const e = r.edges.find((x) => x.id === 'a->b')!
    expect(e.labelLines).toEqual(['go'])
    expect(e.labelBox).not.toBeNull()
    expect(e.labelBox!.w).toBeGreaterThan(18)
    expect(e.label).toBe('go')
  })

  test('a spacer cell keeps a column open that an empty one would collapse', () => {
    const plain = resolveRows('a a->b b . c c->d d')
    const spaced = resolveRows('a a->b b ~ c c->d d')
    expect(plain.colW[3]).toBe(0)
    expect(spaced.colW[3]).toBeGreaterThanOrEqual(26)
    expect(spaced.width).toBeGreaterThan(plain.width)
  })

  test('a card with no cell is left out, and the drawing starts at the margin', () => {
    const r = resolveUnchecked('a a->b b . . .')
    expect(r.cards.map((c) => c.id)).toEqual(['a', 'b'])
    const minX = Math.min(...r.cards.map((c) => c.box.x), ...r.groups.map((g) => g.box.x))
    expect(minX).toBe(30)
  })
})

describe('resolveGrid: groups', () => {
  test('a group frame holds its members', () => {
    const r = resolveRows('a a->b b c c->d d')
    const g = r.groups.find((x) => x.id === 'top')!
    for (const id of ['a', 'b']) {
      const b = r.cards.find((c) => c.id === id)!.box
      expect(g.box.x).toBeLessThan(b.x)
      expect(g.box.y).toBeLessThan(b.y)
      expect(g.box.x + g.box.w).toBeGreaterThan(b.x + b.w)
    }
  })

  test('a group frame contains the frame of a group nested in it', () => {
    const nested = CONTENT.replace('    subgraph top [TOP]\n', '    subgraph outer [OUTER]\n      c["C"]\n      subgraph top [TOP]\n').replace(
      '    end\n    c["C"]\n',
      '      end\n    end\n'
    )
    const r = resolveText(nested + '  "a a->b b c c->d d"')
    const outer = r.groups.find((g) => g.id === 'outer')!.box
    const inner = r.groups.find((g) => g.id === 'top')!.box
    expect(r.groups.map((g) => g.id)).toEqual(['outer', 'top'])
    expect(outer.x).toBeLessThan(inner.x)
    expect(outer.y).toBeLessThan(inner.y)
    expect(outer.x + outer.w).toBeGreaterThanOrEqual(inner.x + inner.w)
    expect(outer.y + outer.h).toBeGreaterThan(inner.y + inner.h)
  })

  test('a group with no card in the grid has no frame', () => {
    const r = resolveUnchecked('c c->d d')
    expect(r.groups).toEqual([])
  })
})

describe('resolveGrid: paths', () => {
  test('an unlabelled bent path is walked from its source card to its target', () => {
    const r = resolveRows('a a->b . c', '. a->b a->b c->d', '. . a->b d', '. . b .')
    const edge = r.edges.find((e) => e.id === 'a->b')!
    expect(edge.points.length).toBeGreaterThan(2)
    const a = r.cards.find((c) => c.id === 'a')!.box
    const b = r.cards.find((c) => c.id === 'b')!.box
    expect(edge.points[0].y).toBeLessThan(edge.points[edge.points.length - 1].y)
    expect(edge.points[0].x).toBeGreaterThanOrEqual(a.x)
    expect(edge.points[edge.points.length - 1].y).toBeLessThanOrEqual(b.y + b.h)
  })

  test('a path drawn from the target end still runs source to target', () => {
    const r = resolveRows('b a->b . c', '. a->b a->b c->d', '. . a->b d', '. . a .')
    const edge = r.edges.find((e) => e.id === 'a->b')!
    expect(edge.points[0].y).toBeGreaterThan(edge.points[edge.points.length - 1].y)
  })

  test('a path starts and ends on the card borders on each side', () => {
    const r = resolveRows('a a->b b c c->d d')
    const edge = r.edges.find((e) => e.id === 'a->b')!
    const a = r.cards.find((c) => c.id === 'a')!.box
    const b = r.cards.find((c) => c.id === 'b')!.box
    expect(edge.points[0].x).toBe(a.x + a.w)
    expect(edge.points[edge.points.length - 1].x).toBe(b.x)
    // The same on a path that runs right to left and one that runs top to bottom.
    const rl = resolveRows('b a->b a c c->d d').edges.find((e) => e.id === 'a->b')!
    const [ra, rb] = ['a', 'b'].map((id) => resolveRows('b a->b a c c->d d').cards.find((c) => c.id === id)!.box)
    expect(rl.points[0].x).toBe(ra.x)
    expect(rl.points[rl.points.length - 1].x).toBe(rb.x + rb.w)
  })

  test('a one-cell path between stacked cards runs from the lower border of one to the upper of the other', () => {
    const r = resolveRows('a c', 'a->b c->d', 'b d')
    const e = r.edges.find((x) => x.id === 'a->b')!
    const a = r.cards.find((c) => c.id === 'a')!.box
    const b = r.cards.find((c) => c.id === 'b')!.box
    expect(e.points[0].y).toBe(a.y + a.h)
    expect(e.points[e.points.length - 1].y).toBe(b.y)
  })

  test('a path drawn upward runs from the top border of its source', () => {
    const r = resolveRows('b c', 'a->b c->d', 'a d')
    const e = r.edges.find((x) => x.id === 'a->b')!
    const a = r.cards.find((c) => c.id === 'a')!.box
    expect(e.points[0].y).toBe(a.y)
  })

  test('an inline label splits the path, and the line runs through the label centre', () => {
    const r = resolveRows('a . c', 'a->b . c->d', '@a->b . d', 'a->b . .', 'b . .')
    const e = r.edges.find((x) => x.id === 'a->b')!
    expect(e.labelInline).toBe(true)
    const lb = e.labelBox!
    expect(e.points).toContainEqual({ x: lb.x + lb.w / 2, y: lb.y + lb.h / 2 })
    const a = r.cards.find((c) => c.id === 'a')!.box
    const b = r.cards.find((c) => c.id === 'b')!.box
    expect(e.points[0].y).toBe(a.y + a.h)
    expect(e.points[e.points.length - 1].y).toBe(b.y)
  })

  test('a bridged path drawn from the target end still runs source to target', () => {
    const r = resolveRows('b . c', 'a->b . c->d', '@a->b . d', 'a->b . .', 'a . .')
    const e = r.edges.find((x) => x.id === 'a->b')!
    expect(e.points[0].y).toBeGreaterThan(e.points[e.points.length - 1].y)
  })

  test('an edge whose label sits beside the lane is not inline', () => {
    const r = resolveRows('a a->b b c c->d d')
    expect(r.edges.find((x) => x.id === 'a->b')!.labelInline).toBe(false)
    expect(r.edges.find((x) => x.id === 'a->b')!.labelLines).toEqual([])
    expect(r.edges.find((x) => x.id === 'a->b')!.labelBox).toBeNull()
  })

  test('an edge keeps its class and citations', () => {
    const text = CONTENT.replace('a -->|go| b', 'a -->|go| b @card-1,card-2') + '  "a a->b b c c->d d"'
    const e = resolveText(text).edges.find((x) => x.id === 'a->b')!
    expect(e.cards).toEqual(['card-1', 'card-2'])
    expect(e.cls).toBe('read')
  })

  test('an edge with no path cell is not drawn', () => {
    const doc = parseGrid(grid('a . b c c->d d'))
    const r = resolveGrid(doc, check(doc).index)
    expect(r.edges.map((e) => e.id)).toEqual(['c->d'])
  })
})

describe('resolveGrid: crossings', () => {
  const crossing = () => resolveRows('. . a . .', '. . a->b . .', 'c c->d a->b+c->d c->d d', '. . a->b . .', '. . b . .')

  test('the horizontal edge carries the hop, at the junction cell centre', () => {
    const r = crossing()
    const horizontal = r.edges.find((e) => e.id === 'c->d')!
    const vertical = r.edges.find((e) => e.id === 'a->b')!
    expect(vertical.hops).toEqual([])
    expect(horizontal.hops).toHaveLength(1)
    // The hop point is a vertex of the horizontal path.
    expect(horizontal.points).toContainEqual(horizontal.hops[0])
  })

  test('the hopping edge is painted after the edge it hops', () => {
    expect(crossing().edges.map((e) => e.id)).toEqual(['a->b', 'c->d'])
  })

  test('with the hopping edge first in the document, it still lands last', () => {
    const swapped = CONTENT.replace('    a -->|go| b\n    c --> d\n', '    c --> d\n    a -->|go| b\n')
    const r = resolveText(swapped + '  ". . a . ."\n  ". . a->b . ."\n  "c c->d a->b+c->d c->d d"\n  ". . a->b . ."\n  ". . b . ."')
    expect(r.edges.map((e) => e.id)).toEqual(['a->b', 'c->d'])
  })

})

describe('resolveGrid: warnings', () => {
  test('a clean grid has none', () => {
    expect(resolveRows('a a->b b c c->d d').warnings).toEqual([])
  })

  test('warns when the only edge on a wide card leaves it off the middle', () => {
    const off = resolveRows('a a . c c->d d', '. a->b . . . .', '. b . . . .')
    expect(off.warnings.join('\n')).toContain('edge "a->b" touches the bottom of "a"')
    expect(off.warnings.join('\n')).toContain('off its middle')
    const middle = resolveRows('a a a c c->d d', '. a->b . . . .', '. b . . . .')
    expect(middle.warnings.join('\n')).not.toContain('off its middle')
  })

  test('warns when a group frame holds a card that is not a member', () => {
    const r = resolveRows('a a . .', 'a->b c c->d d', 'b b . .')
    expect(r.warnings.join('\n')).toContain('group "top" frames 1 card(s) that are not its members: c')
    expect(resolveRows('a a->b b c c->d d').warnings.join('\n')).not.toContain('not its members')
  })

  test('a U-shaped detour is drawn, with a warning', () => {
    const r = resolveRows('a . b c', 'a->b a->b a->b c->d', '. . . d')
    expect(r.warnings.join('\n')).toContain('turns back on itself')
  })
})
