import { describe, expect, test } from 'bun:test'
import { acceptClosure, ancestorsOf, childrenOf, discardClosure, parentOf, planRemoval, removalSet } from './stage.ts'
import type { Edge, Graph, GraphNode } from './types.ts'

/** A hand-built graph. `live` and `held` are [from, to, type] triples; ids listed in
 *  `ghosts` are proposed. Kinds default to card; write `id:option`, `id:source` or
 *  `id:excerpt` for the others. */
function graph(spec: { nodes: string[]; live?: string[][]; held?: string[][]; ghosts?: string[] }): Graph {
  const nodes = new Map<string, GraphNode>()
  for (const s of spec.nodes) {
    const m = s.match(/^(.*):(option|source|excerpt)$/)
    const [id, kind] = m ? [m[1], m[2]] : [s, 'card']
    nodes.set(id, { id, kind, title: id } as GraphNode)
  }
  const toEdge = ([from, to, type = 'refines']: string[]) => ({ from, to, type }) as Edge
  return {
    nodes,
    edges: (spec.live ?? []).map(toEdge),
    ghostEdges: (spec.held ?? []).map(toEdge),
    proposed: new Set(spec.ghosts ?? []),
  } as unknown as Graph
}

describe('acceptClosure', () => {
  test('a lone ghost accepts only itself', () => {
    const g = graph({ nodes: ['root', 'kid'], held: [['kid', 'root']], ghosts: ['kid'] })
    expect(acceptClosure(g, 'kid')).toEqual(['kid'])
  })

  test('ghost refines ancestors come first, top-down', () => {
    const g = graph({
      nodes: ['root', 'a', 'b', 'c'],
      held: [['a', 'root'], ['b', 'a'], ['c', 'b']],
      ghosts: ['a', 'b', 'c'],
    })
    expect(acceptClosure(g, 'c')).toEqual(['a', 'b', 'c'])
  })

  test('the ancestor walk stops at a real parent', () => {
    const g = graph({ nodes: ['root', 'a', 'b'], live: [['a', 'root']], held: [['b', 'a']], ghosts: ['b'] })
    expect(acceptClosure(g, 'b')).toEqual(['b'])
  })

  test('a refines cycle among ghosts does not loop forever', () => {
    const g = graph({ nodes: ['a', 'b'], held: [['a', 'b'], ['b', 'a']], ghosts: ['a', 'b'] })
    expect(acceptClosure(g, 'a')).toEqual(['b', 'a'])
  })

  test('ghost options and evidence ride along, also on a ghost ancestor', () => {
    const g = graph({
      nodes: ['root', 'p', 'c', 'p:opt0:option', 'c:opt0:option', 'src:source'],
      held: [
        ['p', 'root'],
        ['c', 'p'],
        ['p:opt0', 'p', 'alternative_to'],
        ['c:opt0', 'c', 'alternative_to'],
        ['c', 'src', 'supported_by'],
      ],
      ghosts: ['p', 'c', 'p:opt0', 'c:opt0', 'src'],
    })
    expect(acceptClosure(g, 'c')).toEqual(['p', 'c', 'p:opt0', 'c:opt0', 'src'])
  })

  test('a depends_on target and a card citing the same source stay behind', () => {
    const g = graph({
      nodes: ['root', 'c', 'dep', 'other', 'src:source'],
      held: [
        ['c', 'root'],
        ['c', 'dep', 'depends_on'],
        ['c', 'src', 'supported_by'],
        ['other', 'src', 'supported_by'],
      ],
      ghosts: ['c', 'dep', 'other', 'src'],
    })
    expect(acceptClosure(g, 'c')).toEqual(['c', 'src'])
  })

  test('an option on a card does not pull a card that is its alternative', () => {
    const g = graph({ nodes: ['a', 'b'], held: [['b', 'a', 'alternative_to']], ghosts: ['a', 'b'] })
    expect(acceptClosure(g, 'a')).toEqual(['a'])
  })

  test('accepting an option takes no attachments of its own', () => {
    const g = graph({ nodes: ['c', 'o:option', 's:source'], held: [['o', 'c', 'alternative_to'], ['o', 's', 'supported_by']], ghosts: ['o', 's'] })
    expect(acceptClosure(g, 'o')).toEqual(['o'])
  })

  test('a real node accepts nothing', () => {
    const g = graph({ nodes: ['root'] })
    expect(acceptClosure(g, 'root')).toEqual([])
  })
})

describe('discardClosure', () => {
  test('takes ghost children, grandchildren and their options', () => {
    const g = graph({
      nodes: ['root', 'a', 'b', 'c', 'o:option'],
      held: [['a', 'root'], ['b', 'a'], ['c', 'b'], ['o', 'b', 'alternative_to']],
      ghosts: ['a', 'b', 'c', 'o'],
    })
    expect(discardClosure(g, 'a')).toEqual(['a', 'b', 'c', 'o'])
  })

  test('leaves a real child and a depends_on dependent', () => {
    const g = graph({
      nodes: ['root', 'a', 'dep', 'real'],
      held: [['a', 'root'], ['dep', 'a', 'depends_on'], ['real', 'a']],
      ghosts: ['a', 'dep'],
    })
    expect(discardClosure(g, 'a')).toEqual(['a'])
  })

  test('takes ghost evidence only this closure cites', () => {
    const g = graph({
      nodes: ['a', 'b', 'only:source', 'shared:source', 'real:source', 'cardsrc'],
      held: [
        ['a', 'only', 'supported_by'],
        ['a', 'shared', 'supported_by'],
        ['b', 'shared', 'supported_by'],
        ['a', 'real', 'supported_by'],
        ['a', 'cardsrc', 'supported_by'],
      ],
      ghosts: ['a', 'b', 'only', 'shared', 'cardsrc'],
    })
    expect(discardClosure(g, 'a')).toEqual(['a', 'only'])
  })

  test('discarding an option takes only the option', () => {
    const g = graph({ nodes: ['c', 'o:option'], held: [['o', 'c', 'alternative_to']], ghosts: ['o'] })
    expect(discardClosure(g, 'o')).toEqual(['o'])
  })
})

describe('removalSet', () => {
  const tree = () =>
    graph({
      nodes: ['root', 'a', 'b', 'c', 'o:option', 'mine:source', 'shared:source', 'loose:source', 'x'],
      live: [
        ['a', 'root'],
        ['b', 'a'],
        ['c', 'b'],
        ['x', 'root'],
        ['o', 'b', 'alternative_to'],
        ['b', 'mine', 'supported_by'],
        ['b', 'shared', 'supported_by'],
        ['x', 'shared', 'supported_by'],
      ],
    })

  test('takes the live refines subtree and its attachments', () => {
    expect(removalSet(tree(), 'a')).toEqual(['a', 'b', 'c', 'o', 'mine'])
  })

  test('without the subtree, takes only the card and its own attachments', () => {
    expect(removalSet(tree(), 'b', false)).toEqual(['b', 'o', 'mine'])
  })

  test('a leaf with no attachments is removed alone; a node with no edges is not dragged along', () => {
    expect(removalSet(tree(), 'c')).toEqual(['c'])
  })
})

describe('planRemoval', () => {
  test('refuses the root', () => {
    expect(() => planRemoval(graph({ nodes: ['root'] }), 'root')).toThrow('root card cannot be removed')
  })

  test('without reparent, removes the subtree and moves nothing', () => {
    const g = graph({ nodes: ['root', 'a', 'b'], live: [['a', 'root'], ['b', 'a']] })
    expect(planRemoval(g, 'a')).toEqual({ moves: [], ids: ['a', 'b'] })
  })

  test('with reparent, lifts the children to the grandparent and removes the card alone', () => {
    const g = graph({ nodes: ['root', 'a', 'b', 'c'], live: [['a', 'root'], ['b', 'a'], ['c', 'a']] })
    expect(planRemoval(g, 'a', true)).toEqual({
      moves: [
        { id: 'b', parent: 'root' },
        { id: 'c', parent: 'root' },
      ],
      ids: ['a'],
    })
  })

  test('with reparent, a card with children and no parent throws', () => {
    const g = graph({ nodes: ['top', 'b'], live: [['b', 'top']] })
    expect(() => planRemoval(g, 'top', true)).toThrow('"top" has 1 child card(s) and no parent')
  })

  test('with reparent, a parentless leaf is removed with no moves', () => {
    const g = graph({ nodes: ['lone'] })
    expect(planRemoval(g, 'lone', true)).toEqual({ moves: [], ids: ['lone'] })
  })
})

describe('tree lookups', () => {
  const g = graph({
    nodes: ['root', 'a', 'b', 'c', 'ghost'],
    live: [['a', 'root'], ['b', 'a'], ['c', 'a']],
    held: [['ghost', 'b']],
    ghosts: ['ghost'],
  })

  test('childrenOf gives live refines children only', () => {
    expect(childrenOf(g, 'a')).toEqual(['b', 'c'])
    expect(childrenOf(g, 'b')).toEqual([])
  })

  test('parentOf reads a live or a held refines edge', () => {
    expect(parentOf(g, 'b')).toBe('a')
    expect(parentOf(g, 'ghost')).toBe('b')
    expect(parentOf(g, 'root')).toBeUndefined()
  })

  test('ancestorsOf lists nearest first and leaves out the root', () => {
    expect(ancestorsOf(g, 'ghost')).toEqual(['b', 'a'])
    expect(ancestorsOf(g, 'a')).toEqual([])
  })

  test('ancestorsOf stops at a cycle', () => {
    const cyc = graph({ nodes: ['x', 'y', 'z'], live: [['x', 'y'], ['y', 'z'], ['z', 'y']] })
    expect(ancestorsOf(cyc, 'x')).toEqual(['y', 'z'])
    const self = graph({ nodes: ['x', 'y'], live: [['x', 'y'], ['y', 'x']] })
    expect(ancestorsOf(self, 'x')).toEqual(['y'])
  })
})
